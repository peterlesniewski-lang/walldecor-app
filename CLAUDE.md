# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**WallDecor App** is a financial and HR management dashboard for a small business with multiple locations. It's a **Next.js 16 + TypeScript** application running on **Coolify** (OVH VPS) at `app.walldecor.pl`.

**Current Status:** M1 Bootstrap (Complete)
- ✅ User authentication with NextAuth v4
- ✅ Prisma + SQLite database with seed data
- ✅ Role-based access control (ADMIN, MANAGER, EMPLOYEE)
- ✅ Responsive UI with dark sidebar + beige accents
- ✅ Docker containerization and Coolify deployment

**Next Milestones:** M2–M9 (Budget planning, KPI dashboard, HR, payment alerts)

---

## Quick Start

### Prerequisites
- Node.js 20+ (Alpine LTS)
- npm 10.8+
- SQLite3 (embedded)

### Installation & Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with NEXTAUTH_SECRET and ADMIN_PASSWORD

# Initialize database and seed data
npx prisma migrate dev
npx prisma db seed

# Start development server
npm run dev
# Open http://localhost:3000
```

### Key Commands

```bash
# Development
npm run dev              # Start Next.js dev server (HMR enabled)
npm run build           # Build for production
npm run start           # Run production server

# Database
npx prisma db push     # Sync schema changes to SQLite
npx prisma db seed     # Seed with initial data (admin account, cost centers, categories)
npx prisma studio     # Open Prisma Studio GUI at localhost:5555

# Testing & Linting
npm run lint            # Run ESLint (config: eslint.config.mjs)
npm test                # Run Vitest (in-memory tests)
npm run test:watch      # Watch mode
npm test:e2e            # Run Playwright end-to-end tests

# Docker
docker build -t walldecor-app .
docker run -p 3000:3000 -v walldecor_db:/data walldecor-app
```

### Database Reset (Development)

```bash
# Remove SQLite file and reseed
rm prisma/dev.db
npx prisma migrate dev
npx prisma db seed
```

---

## Project Architecture

### Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Next.js 16 App Router, React 19.2, TypeScript 5 | Client & server components |
| **Styling** | Tailwind CSS 4 + shadcn/ui | Dark sidebar theme (#1E1E1E), beige accents (#E4DCD1) |
| **Database** | Prisma 5.22 + SQLite | File-based, `/data/walldecor.db` in production |
| **Auth** | NextAuth v4 + bcryptjs | JWT sessions, role-based middleware |
| **Validation** | Zod | Schema validation for forms & API routes |
| **Testing** | Vitest + Playwright | Unit & E2E testing |
| **Deployment** | Docker + Coolify | Multi-stage build, OVH VPS |

### Directory Structure

```
walldecor-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Auth pages group (grouped layout)
│   │   │   ├── login/
│   │   │   └── ...auth routes
│   │   ├── (dashboard)/       # Protected dashboard group
│   │   │   ├── layout.tsx      # Main layout: sidebar + header
│   │   │   ├── page.tsx        # Dashboard home
│   │   │   └── ...feature routes (M2–M9)
│   │   ├── api/
│   │   │   ├── auth/          # NextAuth endpoints
│   │   │   └── health/        # Healthcheck for Coolify
│   │   ├── globals.css        # Tailwind imports + theme variables
│   │   └── layout.tsx         # Root layout, SessionProvider
│   │
│   ├── components/
│   │   ├── shared/            # Reusable components
│   │   │   ├── session-provider.tsx
│   │   │   └── ...auth/theme wrappers
│   │   └── ui/                # shadcn/ui components (auto-generated)
│   │
│   ├── lib/
│   │   ├── auth.ts            # NextAuth configuration
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── utils.ts           # Helper functions
│   │   └── validations/       # Zod schemas for forms & API
│   │
│   ├── types/                 # TypeScript type definitions
│   ├── generated/
│   │   └── prisma/            # @prisma/client output (gitignore)
│   └── proxy.ts               # Fetch proxy for external APIs (future)
│
├── prisma/
│   ├── schema.prisma          # Database schema (models: User, CostCenter, Budget, etc.)
│   ├── seed.ts                # Database seeding script
│   └── migrations/            # Prisma migration history
│
├── public/                    # Static assets (favicon, images)
├── Dockerfile                 # Multi-stage Docker build
├── docker-compose.yml         # Local dev (optional)
├── docker-entrypoint.sh       # Initialize DB, run migrations, start server
├── COOLIFY_DEPLOYMENT.md      # Deployment guide for OVH VPS
├── package.json               # Dependencies, scripts
├── tsconfig.json              # TypeScript configuration
├── tailwind.config.js         # Tailwind theming
├── next.config.ts             # Next.js configuration
└── .env.example               # Environment variables template
```

### Core Models (Prisma Schema)

**M1 Bootstrap (Complete):**
- **User** — Authentication with bcrypt, role (ADMIN/MANAGER/EMPLOYEE)
- **CostCenter** — Business locations: JAG (Salon Jagiellońska), PUL (Salon Puławska + eCommerce), GLOBAL (shared costs)
- **AccountCategory** — Budget categories (9 total: Customer Acquisition, Cost of Service, Office, etc.)
- **SubCategory** — 66 detailed budget line items (SEO, Google Ads, Salaries, Rent, etc.)

**Future Models (M2–M9):**
- **BudgetEntry** — Annual budget planning (year, month, amount per subcategory per cost center)
- **ActualEntry** — Real expenses tracking (vs. budget)
- **Revenue** — Monthly revenue (SALON + ECOMMERCE per location)
- **Employee, PaymentReminder, LeaveRequest** — HR & payroll (M6–M8)

**Key Constraints:**
- SQLite uses STRING for enums (native enums not supported)
- Unique constraint: `[year, month, costCenterId, subCategoryId]` for budget/actuals
- User.role default: "EMPLOYEE"; Prisma 5.22 (not 7.x which requires adapter for SQLite)

---

## Authentication & Authorization

### NextAuth Configuration (src/lib/auth.ts)

- **Provider:** Credentials-based (email + bcrypt password)
- **Session:** JWT (expires 24h)
- **Middleware:** Route protection via `middleware.ts` (if exists) or page-level `auth()` calls
- **Roles:**
  - `ADMIN` — Full access (budget, HR, all users)
  - `MANAGER` — Own location only, employee management
  - `EMPLOYEE` — Own data, assigned categories only

### Default Admin Account

```
Email:    piotr.lesniewski@walldecor.pl
Password: Wiosna1984$
Role:     ADMIN
```

Seeded via `prisma/seed.ts` on `npm run dev` or `npm run build`.

### Session Usage

```typescript
// In server components / API routes
import { auth } from '@/lib/auth'

const session = await auth()
if (!session || session.user.role !== 'ADMIN') {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

// In client components
'use client'
import { useSession } from 'next-auth/react'

export function AdminOnly() {
  const { data: session } = useSession()
  if (session?.user?.role !== 'ADMIN') return <div>Access denied</div>
}
```

---

## Development Workflow

### Adding a New Page

1. **Create route file:**
   ```
   src/app/(dashboard)/budgets/page.tsx
   ```

2. **Protect with auth:**
   ```typescript
   import { auth } from '@/lib/auth'
   import { redirect } from 'next/navigation'

   export default async function BudgetsPage() {
     const session = await auth()
     if (!session || session.user.role !== 'ADMIN') {
       redirect('/login')
     }

     return <div>Budget Dashboard</div>
   }
   ```

3. **Use Prisma for data:**
   ```typescript
   import { prisma } from '@/lib/prisma'

   const budgets = await prisma.budgetEntry.findMany({
     where: { costCenterId: 'JAG' },
     include: { subCategory: true }
   })
   ```

### Adding an API Route

```typescript
// src/app/api/budgets/route.ts
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BudgetSchema } from '@/lib/validations'

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const budgets = await prisma.budgetEntry.findMany()
  return Response.json(budgets)
}

export async function POST(req: Request) {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const validated = BudgetSchema.parse(body) // Zod validation

  const budget = await prisma.budgetEntry.create({ data: validated })
  return Response.json(budget, { status: 201 })
}
```

### Database Migrations

When schema changes:
```bash
# Add new field to User model
npx prisma migrate dev --name add_phone_to_user

# Review migration in prisma/migrations/[timestamp]_add_phone_to_user/
# Commit and push
```

---

## Deployment (Coolify on OVH VPS)

### Environment (Production)

- **Host:** OVH VPS (vps-2212bbc0.vps.ovh.net, 51.83.197.9)
- **Domain:** app.walldecor.pl (DNS configured, SSL auto-generated)
- **Database:** `/data/walldecor.db` (Docker volume persistence)
- **Runtime:** Docker container, Node.js 20-alpine

### Environment Variables

Set in Coolify UI or `.env`:

```
DATABASE_URL=file:/data/walldecor.db
NEXTAUTH_URL=https://app.walldecor.pl
NEXTAUTH_SECRET=sXuuOxwSXLrlq0GYSGqj7zMzUTHJyd2nyQMdf7cJkms=  # Generate with: openssl rand -base64 32
ADMIN_EMAIL=piotr.lesniewski@walldecor.pl
ADMIN_PASSWORD=Wiosna1984$
NODE_ENV=production
```

### Coolify Deployment Steps

1. **In Coolify Dashboard:**
   - New Application → GitHub: `peterlesniewski-lang/walldecor-app`
   - Branch: `main`
   - Build Pack: `Dockerfile`
   - Domain: `app.walldecor.pl`
   - Port: `3000`

2. **Add Environment Variables (in Coolify UI)**

3. **Deploy** → Coolify builds, pushes Docker image, starts container

4. **Verify:**
   ```bash
   curl https://app.walldecor.pl/api/health  # Should return 200
   # Login at https://app.walldecor.pl
   ```

### Docker Build Notes

- **Multi-stage build:** dependencies → builder (TypeScript compile) → runner (optimized)
- **DevDependencies:** Installed in builder stage (includes TypeScript for next.config.ts)
- **Build args:** `NEXTAUTH_SECRET` is a placeholder during Docker build
- **Health check:** `/api/health` endpoint, 30s interval, 60s start grace period
- **User:** Container runs as `nextjs` (UID 1001) for security

See `COOLIFY_DEPLOYMENT.md` for detailed instructions.

---

## Common Tasks

### Database Inspection

```bash
# Open Prisma Studio (localhost:5555)
npx prisma studio

# Query with prisma client
npx ts-node -e "
  const { PrismaClient } = require('@prisma/client')
  const p = new PrismaClient()
  p.user.findMany().then(u => console.log(u))
"
```

### Reset Entire Database (Development)

```bash
# Delete SQLite file
rm prisma/dev.db

# Recreate and seed
npx prisma migrate dev
npx prisma db seed
```

### Add New Seed Data

Edit `prisma/seed.ts` and add models, then:
```bash
npx prisma db seed
```

### Run Tests Locally

```bash
# Unit tests (Vitest)
npm test

# Watch mode
npm test:watch

# E2E tests (Playwright)
npm run test:e2e

# E2E UI (visual test runner)
npm run test:e2e:ui
```

### Check Production Logs

```bash
ssh ubuntu@51.83.197.9

# View container logs
docker logs -f [container-id]

# Or through Coolify UI dashboard
```

---

## Design System & Styling

### Theme Colors

```css
/* src/app/globals.css */
:root {
  --sidebar-bg: #1E1E1E;     /* Dark sidebar */
  --accent: #E4DCD1;          /* Warm beige accent */
  --text-primary: #FFFFFF;    /* Light text on dark */
  --text-muted: #999999;      /* Muted gray */
}
```

### Component Library

- **shadcn/ui** for headless components (Button, Card, Input, Select, etc.)
- **Tailwind CSS 4** for utility styling
- Custom components in `src/components/`

### Adding shadcn/ui Components

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
```

---

## Troubleshooting

### "Cannot find module 'typescript'" in Docker build

✅ **Fixed:** Builder stage now runs `npm ci && npm install -D typescript`

### Database doesn't initialize on first run

```bash
# Manually push schema and seed
npx prisma migrate deploy
npx prisma db seed
```

### NEXTAUTH_SECRET missing

```bash
# Generate new secret
openssl rand -base64 32

# Update .env.local and re-deploy
```

### Port 3000 already in use

```bash
# Find and kill process
lsof -i :3000 | grep node | awk '{print $2}' | xargs kill -9

# Or use different port
npm run dev -- -p 3001
```

---

## Resources & Documentation

- **Next.js App Router:** https://nextjs.org/docs/app
- **Prisma ORM:** https://www.prisma.io/docs
- **NextAuth v4:** https://next-auth.js.org
- **Tailwind CSS:** https://tailwindcss.com/docs
- **shadcn/ui:** https://ui.shadcn.com
- **Zod (Validation):** https://zod.dev
- **Playwright (E2E):** https://playwright.dev

---

## Project Milestones

**M1 ✅ Project Bootstrap**
- Auth, basic UI, seed data complete

**M2–M9 (In Queue)**
- M2: Budget planning interface
- M3: Budget execution & revenue tracking
- M4: KPI dashboard with traffic-light alerts
- M5: Payment reminders
- M6: HR employee management
- M7: Leave & absence requests
- M8: Time tracking & overtime
- M9: Historical data import

See `project_status.md` for detailed specifications.

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/m2-budget-planning

# Commit with co-author
git commit -m "Add budget grid UI

- Implemented month×category×location grid
- Zod validation for amounts
- API endpoint: POST /api/budgets

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

# Push and create PR
git push origin feature/m2-budget-planning
# → GitHub: Create Pull Request
# → Merge & delete branch
# → SSH to VPS: git pull origin main
```

---

## Notes for Future Development

- **SQLite Limitations:** No native enum support; use STRING fields. Consider PostgreSQL for M6+ if performance becomes an issue.
- **Prisma 5 (not 7):** Chosen to avoid SQLite adapter complexity; upgrade after migration if needed.
- **Authentication:** NextAuth v4 selected for simplicity; upgrade to v5 after M2 stabilizes.
- **Environment Variables:** Always use Coolify UI or `.env.local`; never commit secrets.
- **Database Backups:** Volume `/data` persists across deployments; implement automated backups after M3.

