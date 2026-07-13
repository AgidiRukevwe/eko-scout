/**
 * Network Carrier Scoring Module
 * ================================
 * Exports `scoreCarrier()` — a pure function that computes a carrier's
 * infrastructure score, coverage label, and plain-text explanation for
 * a given property location.
 *
 * Design principles:
 *   - No database writes. This is a pure calculation function.
 *   - H3 aggregated table  → fast, coarse context (per-hex tower counts).
 *   - opencellid_raw table → precise, per-tower distance weighting.
 *   - The database never stores labels or scores — this module calculates them live.
 *
 * Tower lookup (property-level):
 *   1. Convert property lat/lng to H3 R9 cell.
 *   2. Generate k=2 gridDisk (19 cells) around that cell.
 *   3. Query opencellid_raw WHERE h3_r9 = ANY(ring_cells).
 *   4. Filter by technology-specific max radius (haversine):
 *        5G (NR) / LTE : 2 km
 *        3G (UMTS) / GSM: 5 km
 *   5. Pass filtered towers into scoreCarrier().
 *
 * Technology weights (user-specified):
 *   5G (NR)  = 5
 *   LTE      = 3
 *   3G/UMTS  = 1
 *   GSM      = 0.25
 *
 * Distance multipliers (user-specified):
 *   0–250 m      = 1.0
 *   250–500 m    = 0.8
 *   500 m–1 km   = 0.6
 *   1–2 km       = 0.3
 *   > 2 km       = 0.1
 */

import * as h3lib from 'h3-js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A row from h3_network_features — one per H3 R9 cell. */
export interface H3NetworkFeatures {
  h3_index: string;

  mtn_gsm_count: number;
  mtn_3g_count: number;
  mtn_lte_count: number;
  mtn_5g_count: number;

  airtel_gsm_count: number;
  airtel_3g_count: number;
  airtel_lte_count: number;
  airtel_5g_count: number;

  glo_gsm_count: number;
  glo_3g_count: number;
  glo_lte_count: number;
  glo_5g_count: number;

  nine_mobile_gsm_count: number;
  nine_mobile_3g_count: number;
  nine_mobile_lte_count: number;
  nine_mobile_5g_count: number;

  total_gsm: number;
  total_3g: number;
  total_lte: number;
  total_5g: number;

  tower_count: number;
  confidence_score: number;
  last_updated: string;
}

/** A row from opencellid_raw — one per cell tower observation. */
export interface RawTower {
  carrier_name: 'MTN' | 'Airtel' | 'Glo' | '9mobile';
  radio: 'GSM' | 'UMTS' | 'LTE' | 'NR';
  latitude: number;
  longitude: number;
  samples: number;
}

export type Carrier = 'MTN' | 'Airtel' | 'Glo' | '9mobile';

export interface CarrierScore {
  /** Weighted infrastructure score (not bounded — higher is better). */
  score: number;
  /** Human-readable coverage label derived from the score. */
  label: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'No data';
  /** Plain-text explanation of how the score was derived. */
  explanation: string;
  /** H3 R9 cell of the queried property. */
  h3_r9: string;
  /** Number of raw nearby towers that contributed to the score. */
  nearby_tower_count: number;
}

// ─── Constants (user-specified) ───────────────────────────────────────────────

/**
 * Technology weights — user-specified, do not change without product sign-off.
 * These reflect infrastructure generation value, not signal quality.
 */
const TECH_WEIGHTS: Record<string, number> = {
  NR:   5,     // 5G New Radio
  LTE:  3,     // 4G LTE
  UMTS: 1,     // 3G UMTS / WCDMA
  GSM:  0.25,  // 2G GSM
};

/**
 * Distance multipliers — user-specified.
 * Towers closer to the property contribute more to the score.
 * Boundaries are in metres.
 */
const DISTANCE_MULTIPLIERS: Array<{ maxMetres: number; multiplier: number }> = [
  { maxMetres:   250, multiplier: 1.0 },
  { maxMetres:   500, multiplier: 0.8 },
  { maxMetres:  1000, multiplier: 0.6 },
  { maxMetres:  2000, multiplier: 0.3 },
  { maxMetres: Infinity, multiplier: 0.1 },
];

/**
 * Coverage label thresholds.
 * Applied to the final weighted score.
 */
const LABEL_THRESHOLDS: Array<{ minScore: number; label: CarrierScore['label'] }> = [
  { minScore: 4.0, label: 'Excellent' },
  { minScore: 2.5, label: 'Good' },
  { minScore: 1.0, label: 'Fair' },
  { minScore: 0,   label: 'Poor' },
];

// ─── H3 k-ring size used for nearby tower lookup ──────────────────────────────

/**
 * k=2 gives a disk of 19 cells.
 * This ensures towers that are geographically close but fall in an adjacent
 * H3 cell are not missed.
 */
const KRING_K = 2;

/**
 * Technology-specific maximum search radius in metres.
 * Towers beyond this range for a given technology are excluded
 * before distance-weighted scoring.
 *
 * 5G / LTE : 2 km  (high-frequency, shorter propagation)
 * 3G / GSM : 5 km  (lower-frequency, longer propagation)
 */
export const TECH_MAX_RADIUS_M: Record<string, number> = {
  NR:   2000,  // 5G New Radio
  LTE:  2000,  // 4G LTE
  UMTS: 5000,  // 3G UMTS / WCDMA
  GSM:  5000,  // 2G GSM
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lng points, in metres.
 */
function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Map a distance in metres to the appropriate multiplier.
 */
function distanceMultiplier(distanceMetres: number): number {
  for (const band of DISTANCE_MULTIPLIERS) {
    if (distanceMetres <= band.maxMetres) {
      return band.multiplier;
    }
  }
  return DISTANCE_MULTIPLIERS[DISTANCE_MULTIPLIERS.length - 1].multiplier;
}

/**
 * Assign a coverage label from a numeric score.
 */
function scoreToLabel(score: number): CarrierScore['label'] {
  for (const t of LABEL_THRESHOLDS) {
    if (score >= t.minScore) return t.label;
  }
  return 'Poor';
}

/**
 * Get the H3 R9 gridDisk of radius k around a lat/lng point.
 * Default k=2 (19 cells) ensures geographically close towers in adjacent
 * cells are captured, not just the property's own cell.
 * Returns H3 index strings to pass as `WHERE h3_r9 = ANY($cells)` in SQL.
 */
export function getKRingCells(lat: number, lng: number, k = KRING_K): string[] {
  const centre = h3lib.latLngToCell(lat, lng, 9);
  return h3lib.gridDisk(centre, k);
}

/**
 * Filter a set of raw towers by the technology-specific maximum search radius.
 * Call this AFTER fetching towers from the k-ring, BEFORE passing to scoreCarrier().
 *
 * @param towers      - Candidate towers from opencellid_raw (k-ring query result)
 * @param propertyLat - Property latitude
 * @param propertyLng - Property longitude
 */
export function filterTowersByRadius(
  towers: RawTower[],
  propertyLat: number,
  propertyLng: number,
): RawTower[] {
  return towers.filter((t) => {
    const maxRadius = TECH_MAX_RADIUS_M[t.radio];
    if (maxRadius === undefined) return false; // unknown tech — exclude
    const distM = haversineMetres(propertyLat, propertyLng, t.latitude, t.longitude);
    return distM <= maxRadius;
  });
}

// ─── Key lookup helpers per carrier ───────────────────────────────────────────

const CARRIER_KEY_PREFIX: Record<Carrier, string> = {
  MTN:      'mtn',
  Airtel:   'airtel',
  Glo:      'glo',
  '9mobile': 'nine_mobile',
};

function getCarrierH3Counts(
  carrier: Carrier,
  features: H3NetworkFeatures,
): { gsm: number; umts: number; lte: number; nr: number } {
  const p = CARRIER_KEY_PREFIX[carrier];
  return {
    gsm:  (features as any)[`${p}_gsm_count`]  ?? 0,
    umts: (features as any)[`${p}_3g_count`]   ?? 0,
    lte:  (features as any)[`${p}_lte_count`]  ?? 0,
    nr:   (features as any)[`${p}_5g_count`]   ?? 0,
  };
}

// ─── scoreCarrier ─────────────────────────────────────────────────────────────

/**
 * Calculate an infrastructure score for a single carrier at a property location.
 *
 * @param carrier       - One of: 'MTN' | 'Airtel' | 'Glo' | '9mobile'
 * @param features      - Aggregated H3 network features for the property's cell
 * @param nearbyTowers  - Raw towers from opencellid_raw within the k-ring of the property.
 *                        Query these with `WHERE h3_r9 = ANY($kRingCells)
 *                        AND carrier_name = $carrier`.
 * @param propertyLat   - Property latitude
 * @param propertyLng   - Property longitude
 */
export function scoreCarrier(
  carrier: Carrier,
  features: H3NetworkFeatures | null,
  nearbyTowers: RawTower[],
  propertyLat: number,
  propertyLng: number,
): CarrierScore {
  const h3_r9 = h3lib.latLngToCell(propertyLat, propertyLng, 9);

  // ── No data at all ────────────────────────────────────────────────────────
  if (!features && nearbyTowers.length === 0) {
    return {
      score: 0,
      label: 'No data',
      explanation: `No ${carrier} tower data is available for this location.`,
      h3_r9,
      nearby_tower_count: 0,
    };
  }

  // ── Raw nearby tower score (distance-weighted) ────────────────────────────
  // This is the primary signal: each tower contributes its technology weight
  // multiplied by how close it is to the property.
  let rawScore = 0;
  const techBreakdown: Record<string, number> = {};

  for (const tower of nearbyTowers) {
    if (tower.carrier_name !== carrier) continue;

    const techWeight = TECH_WEIGHTS[tower.radio] ?? 0;
    if (techWeight === 0) continue;

    const distM = haversineMetres(
      propertyLat, propertyLng,
      tower.latitude, tower.longitude,
    );
    const multiplier = distanceMultiplier(distM);
    const contribution = techWeight * multiplier;

    rawScore += contribution;

    const label = tower.radio === 'NR'   ? '5G'
                : tower.radio === 'LTE'  ? 'LTE'
                : tower.radio === 'UMTS' ? '3G'
                : 'GSM';
    techBreakdown[label] = (techBreakdown[label] ?? 0) + 1;
  }

  // ── H3 context bonus ──────────────────────────────────────────────────────
  // If the aggregated table shows carriers in this hex, add a small context
  // bonus even if the raw towers happen to fall just outside the k-ring.
  // This prevents hexes at the boundary from scoring 0 unfairly.
  let contextBonus = 0;
  if (features) {
    const counts = getCarrierH3Counts(carrier, features);
    // Each technology type present in the hex adds a fractional bonus.
    // Weights are the same as tower weights but divided by 10 (secondary signal).
    if (counts.nr   > 0) contextBonus += TECH_WEIGHTS.NR   * counts.nr   / 10;
    if (counts.lte  > 0) contextBonus += TECH_WEIGHTS.LTE  * counts.lte  / 10;
    if (counts.umts > 0) contextBonus += TECH_WEIGHTS.UMTS * counts.umts / 10;
    if (counts.gsm  > 0) contextBonus += TECH_WEIGHTS.GSM  * counts.gsm  / 10;
  }

  const totalScore = rawScore + contextBonus;
  const label = scoreToLabel(totalScore);

  // ── Explanation ──────────────────────────────────────────────────────────
  const carrierTowers = nearbyTowers.filter((t) => t.carrier_name === carrier);
  const techSummaryParts = Object.entries(techBreakdown)
    .sort(([a], [b]) => {
      const order = ['5G', 'LTE', '3G', 'GSM'];
      return order.indexOf(a) - order.indexOf(b);
    })
    .map(([tech, count]) => `${count} ${tech}`);

  let explanation: string;

  if (carrierTowers.length === 0) {
    explanation = `No ${carrier} towers were found within the nearby search radius. `;
    if (features) {
      const counts = getCarrierH3Counts(carrier, features);
      const hex_total = counts.gsm + counts.umts + counts.lte + counts.nr;
      explanation += hex_total > 0
        ? `The H3 cell has ${hex_total} ${carrier} tower(s) recorded overall, but none are close enough to score well.`
        : `No ${carrier} towers are recorded in this H3 cell.`;
    }
  } else {
    const distList = carrierTowers
      .map((t) => Math.round(haversineMetres(propertyLat, propertyLng, t.latitude, t.longitude)))
      .sort((a, b) => a - b);
    const closestM = distList[0];

    explanation =
      `${carrier}: ${carrierTowers.length} tower(s) within range` +
      (techSummaryParts.length > 0 ? ` (${techSummaryParts.join(', ')})` : '') +
      `. Closest tower is ~${closestM} m away.`;

    if (contextBonus > 0 && features) {
      const counts = getCarrierH3Counts(carrier, features);
      const hex_total = counts.gsm + counts.umts + counts.lte + counts.nr;
      explanation += ` H3 cell context: ${hex_total} ${carrier} tower(s) in this hex.`;
    }
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    label,
    explanation,
    h3_r9,
    nearby_tower_count: carrierTowers.length,
  };
}

/**
 * Score all four carriers for a location and return the full network picture.
 *
 * @param features      - H3 aggregated row for the property cell (may be null)
 * @param nearbyTowers  - All raw towers from the k-ring (all carriers)
 * @param propertyLat   - Property latitude
 * @param propertyLng   - Property longitude
 */
export function scoreAllCarriers(
  features: H3NetworkFeatures | null,
  nearbyTowers: RawTower[],
  propertyLat: number,
  propertyLng: number,
): {
  mtn: CarrierScore;
  airtel: CarrierScore;
  glo: CarrierScore;
  nine_mobile: CarrierScore;
  best_carrier: Carrier | null;
  confidence_score: number;
} {
  const carriers: Carrier[] = ['MTN', 'Airtel', 'Glo', '9mobile'];
  const scores = Object.fromEntries(
    carriers.map((c) => [c, scoreCarrier(c, features, nearbyTowers, propertyLat, propertyLng)])
  ) as Record<Carrier, CarrierScore>;

  const best = carriers.reduce<Carrier | null>((best, c) => {
    if (!best) return c;
    return scores[c].score > scores[best].score ? c : best;
  }, null);

  return {
    mtn:         scores['MTN'],
    airtel:      scores['Airtel'],
    glo:         scores['Glo'],
    nine_mobile: scores['9mobile'],
    best_carrier: best,
    confidence_score: features?.confidence_score ?? 0,
  };
}
