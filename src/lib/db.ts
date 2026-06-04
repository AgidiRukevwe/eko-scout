import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || process.env.DB_URL;

export const isDbConfigured = !!databaseUrl;

// Return a query function that handles queries if the DB is configured,
// or throws a helpful error otherwise.
export const sql = databaseUrl
  ? neon(databaseUrl)
  : (() => {
      throw new Error("DATABASE_URL environment variable is not configured.");
    }) as any;

/**
 * Execute a query safely, returning null if DB is not configured or fails.
 */
export async function safeQuery<T = any>(
  queryText: string,
  params: any[] = []
): Promise<T[] | null> {
  if (!isDbConfigured) {
    console.warn("Database query skipped: DATABASE_URL is not set.");
    return null;
  }
  try {
    const timeoutMs = 8000; // 8 seconds
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database query timeout")), timeoutMs)
    );
    const result = await Promise.race([sql.query(queryText, params), timeoutPromise]);
    return result as T[];
  } catch (error) {
    console.error("Database query failed:", error);
    return null;
  }
}
