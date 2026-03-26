#!/bin/sh
set -e

echo "WallDecor — starting..."

echo "Running database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "Running database seed..."
./node_modules/.bin/tsx prisma/seed.ts || true

echo "Starting Next.js server..."
exec node server.js
