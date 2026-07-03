#!/bin/sh
set -e

echo "WallDecor — starting..."

if [ -n "$DATABASE_URL" ]; then
  DB_PATH="${DATABASE_URL#file:}"
  if [ -f "$DB_PATH" ]; then
    BACKUP_DIR="$(dirname "$DB_PATH")/backups"
    BACKUP_FILE="$BACKUP_DIR/walldecor-$(date +%Y%m%d-%H%M%S).db"
    echo "Creating SQLite backup: $BACKUP_FILE"
    mkdir -p "$BACKUP_DIR"
    cp "$DB_PATH" "$BACKUP_FILE"
  fi
fi

echo "Running database migrations (db push)..."
node ./node_modules/prisma/build/index.js db push --skip-generate

echo "Running database seed..."
if ! ./node_modules/.bin/tsx prisma/seed.ts; then
  if [ "$RESET_ADMIN_PASSWORD_ON_SEED" = "true" ]; then
    echo "Database seed failed while admin password reset is requested."
    exit 1
  fi

  echo "Database seed failed; continuing without seed."
fi

echo "Starting Next.js server..."
exec node .next/standalone/server.js
