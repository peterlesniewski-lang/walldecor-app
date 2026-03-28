#!/bin/sh
set -e

echo "WallDecor — starting..."

echo "Running database migrations (db push)..."
node ./node_modules/prisma/build/index.js db push --accept-data-loss

echo "Running database seed..."
./node_modules/.bin/tsx prisma/seed.ts || true

echo "Starting Next.js server..."
exec node .next/standalone/server.js
