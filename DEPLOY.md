# Deployment Lessons & Best Practices

**Document Purpose:** Share critical lessons learned during walldecor-app deployment to Coolify. Use this guide to **avoid common pitfalls** in future Next.js + Prisma + Docker projects.

---

## Critical Issues & Fixes

### 1. ❌ Docker Build: Missing devDependencies in Builder Stage

**Problem:**
```dockerfile
RUN npm install  # ← Ambiguous! Doesn't explicitly install devDependencies
```

**Why it failed:**
- Next.js requires TypeScript to load `next.config.ts` (or `vitest.config.ts`, `playwright.config.ts`)
- `npm install` or `npm ci` without explicit flags may skip devDependencies in Docker's multi-stage builds
- Docker layer caching was preventing proper reinstallation
- Error: `Cannot find module 'typescript'`

**✅ CORRECT Solution:**
```dockerfile
# Stage 2: Build
FROM base AS builder
COPY package.json package-lock.json ./

# CRITICAL: --include=dev ensures TypeScript and all build tools are available
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate
RUN npm run build
```

**Why this works:**
- `npm ci --include=dev` = **clean install + include devDependencies** (deterministic from lock file)
- Explicit flag prevents ambiguity
- Works consistently across Docker, CI/CD, and local environments

---

### 2. ❌ Package Lock File Out of Sync

**Problem:**
```
npm error `npm ci` can only install packages when your package.json and
package-lock.json are in sync. Missing: class-variance-authority, clsx, tailwind-merge
```

**Why it happened:**
- `package.json` was updated but `package-lock.json` wasn't regenerated locally
- Committing out-of-sync lock files causes build failures in Docker

**✅ CORRECT Solution:**
```bash
# Always keep lock file in sync
npm install  # This updates package-lock.json
git add package-lock.json
git commit -m "Update dependencies"
```

**Prevention:**
- Add Git pre-commit hook to verify lock file sync
- Use `npm ci` locally for reproducible installs (not `npm install`)
- Commit `package-lock.json` every time dependencies change

---

### 3. ❌ Environment Variables Not Set in Coolify

**Problem:**
- Application deployed but failed to start: missing `NEXTAUTH_SECRET`, `DATABASE_URL`, `ADMIN_EMAIL`, etc.
- Error: "NEXTAUTH_SECRET is undefined"

**Why it happened:**
- Environment variables were configured in Coolify UI but not saved/applied to deployment
- Or variables were set but not redeployed

**✅ CORRECT Solution:**

**In Coolify UI:**
1. Application → Settings → Environment
2. Add EACH variable with "Available at Buildtime" + "Available at Runtime" ✅
3. Save
4. Click **Redeploy** (not just "Deploy")

**Variables Required:**
```
DATABASE_URL=file:/data/walldecor.db
NEXTAUTH_URL=https://app.walldecor.pl
NEXTAUTH_SECRET=<generated-secret>
ADMIN_EMAIL=user@example.com
ADMIN_PASSWORD=<secure-password>
NODE_ENV=production
```

**Prevention:**
- Always verify env vars BEFORE deployment
- Use `.env.example` in repo as checklist
- Screenshot Coolify env vars settings before deploying

---

### 4. ❌ TypeScript Configuration File Breaks Build

**Problem:**
```
⚠ Installing TypeScript as it was not found while loading "next.config.ts"
Error: Cannot find module 'typescript'
```

**Why it happened:**
- `next.config.ts` (TypeScript) requires TypeScript compiler to load
- Only `.js` config files load without TypeScript
- Missing devDependencies in Docker build

**✅ CORRECT Solution Options:**

**Option A:** Ensure devDependencies installed (recommended)
```dockerfile
RUN npm ci --include=dev
```

**Option B:** Rename to JavaScript config (fallback)
```bash
# Rename next.config.ts → next.config.js
# Rewrite in plain JS (no TypeScript syntax)
```

**Prevention:**
- Keep `next.config.ts`, `vitest.config.ts`, `playwright.config.ts` as `.ts` files
- Ensure builder stage explicitly installs devDependencies
- Test Docker build locally before pushing:
  ```bash
  docker build -t walldecor-app .
  ```

---

## Docker Multi-Stage Build: Best Practices

### Structure: deps → builder → runner

```dockerfile
# Stage 1: deps (MINIMAL)
FROM node:20-alpine AS deps
COPY package.json package-lock.json ./
RUN npm ci  # ← Production-only (optional, for caching)

# Stage 2: builder (FULL)
FROM node:20-alpine AS builder
COPY package.json package-lock.json ./
RUN npm ci --include=dev  # ← CRITICAL: include devDependencies
COPY . .
RUN npx prisma generate
RUN npm run build  # ← Requires TypeScript, other dev tools

# Stage 3: runner (MINIMAL)
FROM node:20-alpine AS runner
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
RUN npm prune --production  # ← Only production deps
```

### Key Rules

| Stage | Purpose | What to Install | Notes |
|-------|---------|-----------------|-------|
| **deps** | Caching | `npm ci` (production) | Optional; not used in this setup |
| **builder** | Build app | `npm ci --include=dev` | ⚠️ MUST include devDeps for TypeScript |
| **runner** | Runtime | Production deps only | Smaller image, faster startup |

### Layer Caching Gotchas

**Problem:** Docker caches layers too aggressively
```dockerfile
RUN npm ci --include=dev  # ← CACHED from previous build
COPY . .  # ← Source files changed, but npm still cached
```

**Solution:** Invalidate cache when needed
- In Coolify: "Build with no cache" option (if available)
- Or: Change a dummy comment in Dockerfile to break cache
- Or: Use `--build-arg` with timestamp to force rebuild

---

## Next.js + Prisma Deployment Tips

### Database Initialization

**Issue:** Database not seeded on first deployment
```bash
# Docker container starts but database has no data
```

**Solution:** Use `docker-entrypoint.sh` to auto-seed
```bash
#!/bin/bash
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Seeding database..."
npx prisma db seed

echo "Starting application..."
exec node server.js
```

### Build-Time Environment Variables

**Problem:** Build requires env vars (e.g., `DATABASE_URL` for Prisma generation)
```dockerfile
ENV DATABASE_URL="dummy-value-for-build"  # ← Placeholder during build
```

**Solution:** Use placeholder values for build, real values at runtime
```dockerfile
# Build stage: use dummy values
ENV DATABASE_URL="file:/tmp/build.db"
RUN npx prisma generate

# Runtime: inject real values
ENV DATABASE_URL="file:/data/walldecor.db"
```

### Prisma SQLite Paths

**Critical:** Paths must be consistent across stages
```dockerfile
# In .env or env vars:
DATABASE_URL=file:/data/walldecor.db  # ← Absolute path in Docker volume

# Ensure /data directory exists with correct permissions
RUN mkdir -p /data && chown -R nextjs:nodejs /data

# Docker volume mapping:
docker run -v walldecor_db:/data ...
```

---

## Coolify-Specific Issues

### 1. Domain Configuration

**Issue:** Deployed but app unreachable at custom domain
**Solution:**
1. Coolify → Application → Domains: Add `app.walldecor.pl`
2. Ensure DNS points to VPS IP: `51.83.197.9`
3. SSL auto-generated via Let's Encrypt (Traefik)
4. Wait 2-5 minutes for propagation

### 2. Healthcheck Endpoint

**Issue:** Container doesn't start or constantly restarts
```yaml
HEALTHCHECK --interval=30s --timeout=10s --retries=3
  CMD wget -qO- http://localhost:3000/api/health || exit 1
```

**Solution:** Ensure `/api/health` endpoint exists
```typescript
// src/app/api/health/route.ts
export async function GET() {
  return Response.json({ status: 'ok' })
}
```

### 3. Port Exposure

**Issue:** Port 3000 accessible internally but not externally
**Solution:**
1. Dockerfile: `EXPOSE 3000`
2. Coolify UI: Network → Ports Exposes: `3000`
3. Coolify handles Traefik reverse proxy automatically

---

## Git & CI/CD Best Practices

### Commit Lock Files After Dependency Changes

**Bad:**
```bash
npm install some-package
git add -A
git commit -m "Add some-package"  # ← Forgot package-lock.json
```

**Good:**
```bash
npm install some-package
git add package.json package-lock.json
git commit -m "Add some-package

- Updates package.json with new dependency
- Regenerates package-lock.json for consistency"
```

### Environment Variables: Never Commit Secrets

**Bad:**
```bash
echo "NEXTAUTH_SECRET=abc123xyz" >> .env
git add .env
git commit -m "Add secrets"
```

**Good:**
```bash
# .env.example (template for Coolify or devs)
NEXTAUTH_SECRET="your-generated-secret-here"

# .gitignore
.env
.env.local
.env.*.local
```

### Deployment Checklist

Before pushing to production:
- [ ] Dependencies synced: `npm install`, commit `package-lock.json`
- [ ] Environment variables defined in `.env.example`
- [ ] TypeScript config files present (`.ts` files)
- [ ] Prisma schema valid: `npx prisma validate`
- [ ] Database migration tested locally
- [ ] Docker build tested locally: `docker build -t app .`
- [ ] Healthcheck endpoint working
- [ ] No hardcoded secrets in code

---

## Prevention: Automated Checks

### Pre-Commit Hook

Create `.git/hooks/pre-commit`:
```bash
#!/bin/bash
set -e

# Ensure lock file is in sync
if git diff --cached --name-only | grep -q "package.json"; then
  if ! git diff --cached --name-only | grep -q "package-lock.json"; then
    echo "ERROR: package.json changed but package-lock.json not staged"
    echo "Run: npm install"
    exit 1
  fi
fi

# Check for secrets
if git diff --cached | grep -q "NEXTAUTH_SECRET\|DATABASE_URL" | grep -v ".example"; then
  echo "ERROR: Secrets detected in commit"
  exit 1
fi
```

### GitHub Actions (CI/CD)

```yaml
# .github/workflows/deploy.yml
name: Deploy to Coolify

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build
      - run: npm run lint
      - run: npm test

      # Webhook to Coolify to trigger deployment
      - run: |
          curl -X POST https://coolify-webhook-url \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_TOKEN }}"
```

---

## Troubleshooting Checklist

### Build Fails with "Cannot find module X"

```bash
# 1. Check package-lock.json sync
npm install  # Regenerate lock file

# 2. Check devDependencies
grep "\"X\":" package.json

# 3. Test Docker build locally
docker build -t test-app . --no-cache

# 4. Check Dockerfile for --include=dev
grep "npm ci" Dockerfile
```

### App Starts but Crashes

```bash
# 1. Check Coolify logs
docker logs <container-id>

# 2. Verify environment variables set
echo $NEXTAUTH_SECRET
echo $DATABASE_URL

# 3. Check database exists
ls -la /data/walldecor.db

# 4. Check permissions
docker exec <container-id> ls -la /data
```

### Port/Domain Not Accessible

```bash
# 1. Verify Coolify domain configured
# 2. Check DNS propagation
nslookup app.walldecor.pl

# 3. Check Traefik routing
docker logs traefik | grep app.walldecor.pl

# 4. Verify healthcheck
curl https://app.walldecor.pl/api/health
```

---

## Summary: Rules for Next.js + Prisma + Docker + Coolify

| Rule | Why | Example |
|------|-----|---------|
| **Always `npm ci --include=dev` in builder** | TypeScript & build tools needed | `RUN npm ci --include=dev` |
| **Keep `package-lock.json` in sync** | Reproducible builds | `git add package-lock.json` |
| **Use `.env.example` for templates** | Document required variables | `NEXTAUTH_SECRET=...` |
| **Test Docker build locally** | Catch issues before Coolify | `docker build -t app .` |
| **Never commit `.env` secrets** | Security risk | `.gitignore: .env` |
| **Include healthcheck endpoint** | Container monitoring | `/api/health → 200 OK` |
| **Use placeholder env for build** | Decouple build from runtime | `DATABASE_URL=file:/tmp/build.db` |
| **Verify Coolify env vars saved** | Common deployment mistake | Redeploy after setting vars |

---

## Future: Apply to New Projects

When starting a new **Next.js + Prisma + Docker + Coolify** project:

1. **Scaffold with correct Dockerfile** from day one
   ```dockerfile
   RUN npm ci --include=dev  # ← Don't forget this!
   ```

2. **Create `.env.example` immediately**
   ```bash
   cp .env.local .env.example
   git add .env.example
   ```

3. **Test Docker build before committing**
   ```bash
   docker build -t test .
   docker run -p 3000:3000 test
   ```

4. **Document deployment in README or DEPLOY.md**
   - Which env vars are required?
   - How to deploy to Coolify?
   - Troubleshooting steps?

5. **Add pre-commit hooks**
   - Validate `package-lock.json` sync
   - Detect secrets before commit
   - Run `npm run build` to catch errors early

---

## References

- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Prisma Docker](https://www.prisma.io/docs/orm/overview/databases/databases-docker)
- [Coolify Documentation](https://coolify.io/docs)
- [npm ci vs npm install](https://docs.npmjs.com/cli/v8/commands/npm-ci)
