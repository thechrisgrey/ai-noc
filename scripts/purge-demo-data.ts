// One-off cleanup for environments that were seeded with demo fixtures.
// Run with: npx tsx scripts/purge-demo-data.ts
import { Pool } from "pg";

function buildConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.DB_USERNAME || "postgres";
  const pass = process.env.DB_PASSWORD || "";
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "ainoc";
  return `postgresql://${user}:${pass}@${host}:${port}/${name}?sslmode=no-verify`;
}

const isAws = !!(process.env.DB_HOST || process.env.DATABASE_URL?.includes("rds.amazonaws.com"));

async function purgeDemoData(): Promise<void> {
  const pool = new Pool({
    connectionString: buildConnectionString(),
    connectionTimeoutMillis: 15000,
    ssl: isAws ? { rejectUnauthorized: false } : false,
  });

  try {
    const bookmarkResult = await pool.query(
      `DELETE FROM bookmarks
       WHERE feed_item_id IN (SELECT id FROM feed_items WHERE guid LIKE 'demo-%')`,
    );
    const itemResult = await pool.query(
      `DELETE FROM feed_items WHERE guid LIKE 'demo-%'`,
    );
    console.log(
      `[PurgeDemo] Deleted ${bookmarkResult.rowCount ?? 0} bookmarks and ${itemResult.rowCount ?? 0} demo feed items`,
    );
  } finally {
    await pool.end();
  }
}

purgeDemoData().catch((err) => {
  console.error("[PurgeDemo] Failed:", err?.message ?? err);
  process.exit(1);
});
