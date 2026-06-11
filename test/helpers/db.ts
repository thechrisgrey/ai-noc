import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseStorage } from "../../server/storage";

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

/**
 * Create a fresh in-memory PGlite instance, apply every migration in journal
 * order, and return a DatabaseStorage wired to it. Each call is isolated.
 */
export async function createTestStorage() {
  const client = new PGlite();
  await client.waitReady;

  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8"),
  ) as { entries: { tag: string }[] };

  for (const entry of journal.entries) {
    const migrationSql = readFileSync(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      "utf-8",
    );

    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }
  }

  const db = drizzle(client);
  const storage = new DatabaseStorage(db, async () => {
    await client.close();
  });

  return { storage, client, db };
}

export async function resetTestStorage(client: PGlite): Promise<void> {
  await client.query(
    `TRUNCATE TABLE bookmarks, feed_items, watchlists, briefings RESTART IDENTITY CASCADE;`,
  );
}
