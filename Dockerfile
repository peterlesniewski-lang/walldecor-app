FROM node:20-alpine AS base

# Stage 1: Install dependencies (including devDependencies for build)
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM base AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./

# Install all dependencies (production + devDependencies for build)
# CRITICAL: --include=dev ensures TypeScript and other build tools are available
RUN npm ci --include=dev

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (dummy env values for build time)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV DATABASE_URL="file:/tmp/build.db"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV NEXTAUTH_SECRET="build-secret-placeholder-32-chars-xx"

RUN npm run build

# Stage 3: Runner
FROM base AS runner
RUN apk add --no-cache libc6-compat openssl sqlite wget
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /data /app/src/lib/finance /app/src/lib/accounts /app/src/lib/hr && chown -R nextjs:nodejs /data

# Copy standalone build
COPY --from=builder /app/.next/standalone ./.next/standalone
COPY --from=builder /app/.next/static ./.next/standalone/.next/static
COPY --from=builder /app/public ./.next/standalone/public

# Copy Prisma files
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/scripts/run-installation-calendar-worker.ts ./scripts/run-installation-calendar-worker.ts
COPY --from=builder /app/src/lib/prisma.ts ./src/lib/prisma.ts
COPY --from=builder /app/src/lib/installations ./src/lib/installations
COPY --from=builder /app/src/lib/finance/cost-tags.ts ./src/lib/finance/cost-tags.ts
COPY --from=builder /app/src/lib/accounts/seed-admin.ts ./src/lib/accounts/seed-admin.ts
COPY --from=builder /app/src/lib/hr/leave-type-catalog.ts ./src/lib/hr/leave-type-catalog.ts

# Copy knowledge base for Wikipedia seed
COPY --from=builder /app/ceo-module ./ceo-module

# Copy entire node_modules from builder (includes all devDeps needed for seed: tsx, esbuild, etc.)
COPY --from=builder /app/node_modules ./node_modules

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
