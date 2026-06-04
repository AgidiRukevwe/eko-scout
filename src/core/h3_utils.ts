import * as h3 from 'h3-js';

/**
 * Convert latitude/longitude to H3 indexes at resolutions 9 and 10.
 * Returns an object with `h3_r9` and `h3_r10` strings.
 */
export function enrich_with_h3(lat: number, lng: number) {
  // h3-js expects (lat, lng, resolution)
  const h3_r9 = h3.latLngToCell(lat, lng, 9);
  const h3_r10 = h3.latLngToCell(lat, lng, 10);
  return { h3_r9, h3_r10 };
}
