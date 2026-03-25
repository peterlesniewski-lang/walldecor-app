#!/bin/sh
set -e

echo "WallDecor — starting..."

echo "Running database migrations..."
node ./node_modules/prisma/dist/bin.js migrate deploy

echo "Running database seed..."
node ./node_modules/prisma/dist/bin.js db seed

echo "Starting Next.js server..."
exec node server.js
