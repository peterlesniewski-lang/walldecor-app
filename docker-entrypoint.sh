#!/bin/sh
set -eu

echo "WallDecor — starting..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required." >&2
  exit 1
fi

case "$DATABASE_URL" in
  file:*)
    DB_PATH="${DATABASE_URL#file:}"
    DB_PATH="${DB_PATH%%\?*}"
    ;;
  *)
    echo "ERROR: Production startup requires a SQLite DATABASE_URL beginning with file:." >&2
    exit 1
    ;;
esac

case "$DB_PATH" in
  /*) ;;
  *) DB_PATH="$(pwd)/prisma/$DB_PATH" ;;
esac

if [ -f "$DB_PATH" ]; then
  BACKUP_DIR="$(dirname "$DB_PATH")/backups"
  BACKUP_FILE="$BACKUP_DIR/walldecor-$(date +%Y%m%d-%H%M%S)-$$.db"
  echo "Creating SQLite backup: $BACKUP_FILE"
  mkdir -p "$BACKUP_DIR"
  sqlite3 "$DB_PATH" ".backup \"$BACKUP_FILE\""

  USER_TABLE_COUNT="$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations';")"
  MIGRATION_TABLE_COUNT="$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations';")"

  if [ "$USER_TABLE_COUNT" -gt 0 ] && [ "$MIGRATION_TABLE_COUNT" -eq 0 ]; then
    echo "ERROR: Existing SQLite database '$DB_PATH' has no Prisma migration history." >&2
    echo "Refusing to run migrate deploy against a schema previously managed by db push." >&2
    echo "Create and verify a one-time Prisma baseline before redeploying." >&2
    exit 1
  fi

  if [ "$MIGRATION_TABLE_COUNT" -gt 0 ]; then
    SUCCESSFUL_MIGRATION_COUNT="$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE \"finished_at\" IS NOT NULL AND \"rolled_back_at\" IS NULL;")"
    FAILED_MIGRATION_COUNT="$(sqlite3 "$DB_PATH" \
      "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE \"finished_at\" IS NULL AND \"rolled_back_at\" IS NULL;")"

    if [ "$USER_TABLE_COUNT" -gt 0 ] && [ "$SUCCESSFUL_MIGRATION_COUNT" -eq 0 ]; then
      echo "ERROR: Existing SQLite database '$DB_PATH' has no successful Prisma migration history." >&2
      echo "Verify or baseline this database before redeploying." >&2
      exit 1
    fi

    if [ "$FAILED_MIGRATION_COUNT" -gt 0 ]; then
      echo "ERROR: Existing SQLite database '$DB_PATH' contains a failed Prisma migration." >&2
      echo "Resolve the failed migration before redeploying." >&2
      exit 1
    fi
  fi

fi

echo "Running database migrations (migrate deploy)..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "Running database seed..."
./node_modules/.bin/tsx prisma/seed.ts

echo "Starting Next.js server..."
exec node .next/standalone/server.js
