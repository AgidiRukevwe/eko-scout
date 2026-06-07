export interface ResolvedLocation {
  name: string;
  parentArea?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  isGooglePlace?: boolean;
  // Additional optional fields for mock data
  scores?: Record<string, number>;
  details?: Record<string, any>;
}

/**
 * Resolve a location from a user message.
 * Currently a stub implementation that always returns null.
 * In the future, this could call an external geocoding service.
 */
export async function resolveLocation(_message: string): Promise<ResolvedLocation | null> {
  // TODO: integrate real location resolution logic.
  return null;
}
