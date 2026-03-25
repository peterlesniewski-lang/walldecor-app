#!/bin/sh
set -e

echo "WallDecor — starting..."

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Running database seed..."
./node_modules/.bin/prisma db seed

echo "Starting Next.js server..."
exec node server.js
