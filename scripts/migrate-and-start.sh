#!/bin/sh
set -e

# Construct DATABASE_URL from ECS-injected env vars if not set directly
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=no-verify"
fi

echo "Applying database schema..."
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(\`
      CREATE TABLE IF NOT EXISTS feed_items (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        url TEXT,
        source TEXT NOT NULL,
        source_label TEXT NOT NULL,
        category TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        guid TEXT NOT NULL UNIQUE,
        is_breaking BOOLEAN DEFAULT FALSE,
        image_url TEXT,
        cluster_id TEXT,
        priority INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id SERIAL PRIMARY KEY,
        feed_item_id INTEGER NOT NULL REFERENCES feed_items(id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_published_at ON feed_items(published_at);
      CREATE INDEX IF NOT EXISTS idx_category_published ON feed_items(category, published_at);
      CREATE INDEX IF NOT EXISTS idx_source_published ON feed_items(source, published_at);
      CREATE INDEX IF NOT EXISTS idx_is_breaking ON feed_items(is_breaking);
      CREATE INDEX IF NOT EXISTS idx_cluster_id ON feed_items(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_priority ON feed_items(priority);

      CREATE TABLE IF NOT EXISTS watchlists (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        source TEXT,
        search TEXT,
        sort TEXT,
        created_at TEXT NOT NULL
      );
    \`);
    console.log('Schema applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
"

echo "Starting application..."
exec node dist/index.cjs
