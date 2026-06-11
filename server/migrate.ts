import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { existsSync } from "node:fs";

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

function resolveDefaultMigrationsFolder(): string {
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "dist", "migrations"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }
  return candidates[0];
}

export async function runMigrations(migrationsFolder?: string): Promise<void> {
  const pool = new Pool({
    connectionString: buildConnectionString(),
    connectionTimeoutMillis: 15000,
    ssl: isAws ? { rejectUnauthorized: false } : false,
  });

  const folder = migrationsFolder ?? resolveDefaultMigrationsFolder();

  try {
    console.log(`[Migrate] Applying migrations from ${folder}`);
    // Advisory lock serializes concurrent migrators (e.g. two tasks starting
    // during a rolling deploy); must run on a dedicated client so the lock is
    // held by the same session that releases it.
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(727274001)");
      await migrate(drizzle(client), { migrationsFolder: folder });
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(727274001)");
      } catch {
        // Session-scoped lock dies with the connection; swallowing keeps the
        // unlock failure from masking the migration error or leaking the client.
      }
      client.release();
    }
    console.log("[Migrate] Migrations applied successfully");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("[Migrate] Migration failed:", err?.message ?? err);
  process.exit(1);
});
