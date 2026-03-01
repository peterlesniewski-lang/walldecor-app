#!/bin/sh
set -e

echo "WallDecor — starting..."

echo "Running database migrations..."
npx prisma migrate deploy

echo "Running database seed..."
npx prisma db seed

echo "Starting Next.js server..."
exec node server.js
