#!/bin/sh
set -e

# Construct DATABASE_URL from ECS-injected env vars if not set directly
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=no-verify"
fi

echo "Running Drizzle migrations..."
node dist/migrate.cjs

echo "Starting application..."
exec node dist/index.cjs
