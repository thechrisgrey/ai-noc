// Backfill Titan embeddings for feed items whose embedding is NULL.
// Run with: npx tsx scripts/backfill-embeddings.ts
import { Pool } from "pg";
import { embedMany } from "../server/embeddings";

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

const BATCH_SIZE = 50;

function embedInput(row: { title: string; description: string | null }): string {
  return row.title + (row.description ? ": " + row.description : "");
}

function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

async function backfillEmbeddings(): Promise<void> {
  const pool = new Pool({
    connectionString: buildConnectionString(),
    connectionTimeoutMillis: 15000,
    ssl: isAws ? { rejectUnauthorized: false } : false,
  });

  let totalEmbedded = 0;
  try {
    while (true) {
      const { rows } = await pool.query<{ id: number; title: string; description: string | null }>(
        `SELECT id, title, description
         FROM feed_items
         WHERE embedding IS NULL
         ORDER BY id DESC
         LIMIT ${BATCH_SIZE}`,
      );
      if (rows.length === 0) break;

      const vectors = await embedMany(rows.map(embedInput));
      let embeddedInBatch = 0;
      for (let i = 0; i < rows.length; i++) {
        const vec = vectors[i];
        if (!vec) continue;
        await pool.query(
          `UPDATE feed_items SET embedding = $1::vector WHERE id = $2`,
          [toVectorLiteral(vec), rows[i].id],
        );
        embeddedInBatch++;
      }
      totalEmbedded += embeddedInBatch;
      console.log(
        `[Backfill] Batch of ${rows.length}: embedded ${embeddedInBatch} (total ${totalEmbedded})`,
      );

      // Every item in this batch failed to embed — bail rather than spin.
      if (embeddedInBatch === 0) {
        console.error("[Backfill] Whole batch failed to embed; stopping.");
        break;
      }
    }
    console.log(`[Backfill] Done. Embedded ${totalEmbedded} items.`);
  } finally {
    await pool.end();
  }
}

backfillEmbeddings().catch((err) => {
  console.error("[Backfill] Failed:", err?.message ?? err);
  process.exit(1);
});
