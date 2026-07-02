# Cost Control And Break-Even Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Excel-style cost assumption center with event-based cost control: KSeF invoices, paid/unpaid status, dimensional tags, allocations, cost events, and salon break-even for Jagiellońska and Puławska.

**Architecture:** Add a new cost-control domain beside the existing `BudgetEntry`/`ActualEntry` tables so historical data remains intact. KSeF invoices stay the operational inbox, approval creates event-based cost records, and reporting reads approved cost events with explicit warnings for unclassified or blocked costs. Keep high-risk logic in pure TypeScript helpers with focused tests before wiring API routes and UI.

**Tech Stack:** Next.js App Router, TypeScript strict, Prisma 5 + SQLite, Zod, Vitest, React Testing Library, Tailwind CSS, lucide-react.

---

## Scope

This plan implements the first working vertical slice of the approved design:

- ADMIN-only KSeF operational inbox and payment control.
- Paid/unpaid toggle, due dates, unpaid totals, and aging buckets.
- Rule conflict detection and supplier-rule priority.
- Dimensional tags, invoice parts, and allocation validation.
- Approved cost events as the new reporting source.
- Basic approved-cost ledger and break-even views.
- Contribution-margin inputs and finance period closing.
- Foreign-currency invoices can be manually converted to PLN by ADMIN and then approved.
- Correcting invoices are linked to their original KSeF invoice when the original can be identified.

This plan does not remove legacy `BudgetEntry` or `ActualEntry`. Existing budget/actual pages can continue to work while the new cost-control views become the preferred source.
Production migration of legacy categories/subcategories into tags is intentionally deferred to a separate migration task after this vertical slice is validated. This plan seeds the new tag structure and preserves old data, but does not bulk-convert production classifications.

## File Structure

- Modify: `prisma/schema.prisma` - extend `KsefInvoice` and `KsefSupplierRule`; add cost tags, cost events, parts, allocations, audit logs, finance period closes, and contribution margin settings.
- Modify: `prisma/seed.ts` - seed tag groups, starter tags, and cost-center display names.
- Create: `src/lib/finance/cost-control.ts` - pure helpers for aging buckets, allocation validation, rule conflict decisions, correction split suggestions, and contribution margin.
- Create: `src/lib/finance/cost-events.ts` - helpers for creating approved cost events from KSeF invoices and manual events.
- Create: `src/lib/finance/cost-reporting.ts` - approved-cost filtering, warning totals, supplier spend, and break-even aggregation.
- Create: `src/lib/finance/finance-access.ts` - role guards for ADMIN-only operational finance and report read access.
- Create: `src/lib/validations/cost-control.ts` - Zod schemas for tags, invoice parts, allocations, payments, period closes, and contribution settings.
- Modify: `src/lib/validations/ksef-inbox.ts` - add query filters and payment/document/rule fields.
- Modify: `src/lib/finance/ksef-inbox.ts` - replace single-rule matching with a decision object that can report conflicts.
- Modify: `src/lib/finance/ksef-rule-application.ts` - apply only conflict-free rules; mark conflicts explicitly.
- Modify: `src/lib/finance/ksef-client.ts` - preserve foreign-currency metadata and correction/cancellation metadata where available.
- Modify: `src/lib/finance/ksef-invoice-preview.ts` - extract payment due date from XML when present.
- Modify: `src/app/api/finance/ksef/invoices/route.ts` - ADMIN-only list/create with payment, document, rule, tag, and allocation filters.
- Modify: `src/app/api/finance/ksef/invoices/[id]/route.ts` - ADMIN-only classification update with audit logging.
- Modify: `src/app/api/finance/ksef/invoices/[id]/approve/route.ts` - approve into `CostEvent` instead of treating `ActualEntry` as the source of truth.
- Create: `src/app/api/finance/ksef/invoices/[id]/payment/route.ts` - paid/unpaid and due-date updates.
- Create: `src/app/api/finance/ksef/invoices/[id]/currency-conversion/route.ts` - ADMIN enters PLN reporting amounts for foreign-currency invoices.
- Create: `src/app/api/finance/ksef/invoices/[id]/parts/route.ts` - create/update invoice split parts and allocations.
- Modify: `src/app/api/finance/ksef/rules/route.ts` - ADMIN-only rules with priority and rule conflict handling.
- Create: `src/app/api/finance/ksef/rules/reclassification-preview/route.ts` - ADMIN-only diff preview for approved invoice reclassification.
- Create: `src/app/api/finance/cost-events/route.ts` - approved ledger list and manual event creation.
- Create: `src/app/api/finance/cost-tags/route.ts` - tag group and tag list for classification UI.
- Create: `src/app/api/finance/period-closes/route.ts` - ADMIN period close list/create.
- Create: `src/app/api/finance/break-even/route.ts` - report endpoint for salon break-even and warning totals.
- Modify: `src/app/(dashboard)/finance/ksef/page.tsx` - enforce ADMIN access and pass new filter metadata.
- Create: `src/app/(dashboard)/finance/cost-events/page.tsx` - approved cost ledger page.
- Create: `src/app/(dashboard)/finance/break-even/page.tsx` - break-even page.
- Modify: `src/app/(dashboard)/finance/page.tsx` - show cost-control warning and link to new views.
- Modify: `src/components/shared/ksef-inbox-view.tsx` - wire new filters, payment summary, paid toggle, rule conflicts, parts modal, and ADMIN-only operational UI.
- Create: `src/components/shared/ksef-payment-summary.tsx` - invoice total, unpaid total, and aging bucket summary.
- Create: `src/components/shared/ksef-invoice-parts-editor.tsx` - invoice split and allocation editor.
- Create: `src/components/shared/cost-events-view.tsx` - approved ledger UI with manual cost event form.
- Create: `src/components/shared/break-even-view.tsx` - salon break-even UI.
- Create: `__tests__/unit/finance/cost-control.test.ts` - pure domain tests.
- Modify: `__tests__/unit/finance/ksef-inbox.test.ts` - rule decision, schema, and query tests.
- Modify: `__tests__/unit/finance/ksef-inbox-view.test.tsx` - payment, filter, and rule-conflict UI tests.
- Create: `__tests__/unit/finance/cost-events.test.ts` - approval and cost-event creation tests.
- Create: `__tests__/unit/finance/cost-reporting.test.ts` - ledger and break-even reporting tests.

## Task 1: Pure Cost-Control Domain Helpers

**Files:**
- Create: `src/lib/finance/cost-control.ts`
- Create: `__tests__/unit/finance/cost-control.test.ts`

- [ ] **Step 1: Write failing tests for payment aging, splits, allocation, rule conflicts, and contribution margin**

Create `__tests__/unit/finance/cost-control.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  calculatePaymentAgingBucket,
  calculateHistoricalContributionMargin,
  resolveSupplierRuleDecision,
  suggestCorrectionPartsFromOriginal,
  validateCostParts,
  validateResolvedAllocation,
} from '@/lib/finance/cost-control'

describe('calculatePaymentAgingBucket', () => {
  const now = new Date('2026-07-01T10:00:00.000Z')

  it('counts due today as 0-7 days and yesterday as overdue using Europe/Warsaw business dates', () => {
    expect(calculatePaymentAgingBucket(new Date('2026-07-01T00:00:00.000Z'), now)).toBe('DUE_0_7')
    expect(calculatePaymentAgingBucket(new Date('2026-06-30T00:00:00.000Z'), now)).toBe('OVERDUE')
  })

  it('returns missing due date bucket when due date is null', () => {
    expect(calculatePaymentAgingBucket(null, now)).toBe('MISSING_DUE_DATE')
  })
})

describe('validateCostParts', () => {
  it('requires part amounts to equal the invoice gross amount', () => {
    const result = validateCostParts(1000, [
      { id: 'p1', grossAmount: 700, allocations: [{ costCenterId: 'JAG', percent: 100 }] },
      { id: 'p2', grossAmount: 200, allocations: [{ costCenterId: 'PUL', percent: 100 }] },
    ])

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Suma części faktury musi być równa kwocie brutto faktury.')
  })
})

describe('validateResolvedAllocation', () => {
  it('accepts GLOBAL as a full central allocation', () => {
    expect(validateResolvedAllocation([{ costCenterId: 'GLOBAL', percent: 100 }])).toEqual({ ok: true })
  })

  it('rejects allocation totals below 100 percent', () => {
    expect(validateResolvedAllocation([
      { costCenterId: 'JAG', percent: 80 },
      { costCenterId: 'PUL', percent: 10 },
    ])).toEqual({ ok: false, error: 'Suma alokacji musi wynosić 100%.' })
  })
})

describe('resolveSupplierRuleDecision', () => {
  it('prefers exact NIP over name pattern', () => {
    const decision = resolveSupplierRuleDecision(
      { supplierName: 'Google Ireland', supplierNip: '525-000-71-33' },
      [
        { id: 'name', active: true, priority: 100, supplierNamePattern: 'google', supplierNip: null },
        { id: 'nip', active: true, priority: 100, supplierNamePattern: null, supplierNip: '5250007133' },
      ]
    )

    expect(decision).toEqual({ status: 'MATCHED', ruleId: 'nip' })
  })

  it('returns rule conflict for equally specific rules with the same priority', () => {
    const decision = resolveSupplierRuleDecision(
      { supplierName: 'REMI Spółka Jawna', supplierNip: null },
      [
        { id: 'a', active: true, priority: 100, supplierNamePattern: 'remi', supplierNip: null },
        { id: 'b', active: true, priority: 100, supplierNamePattern: 'remi spółka', supplierNip: null },
      ]
    )

    expect(decision.status).toBe('CONFLICT')
    expect(decision.conflictingRuleIds).toEqual(['a', 'b'])
  })
})

describe('suggestCorrectionPartsFromOriginal', () => {
  it('suggests correction parts using original split proportions', () => {
    expect(suggestCorrectionPartsFromOriginal(-100, [
      { label: 'Towar', grossAmount: 700 },
      { label: 'Transport', grossAmount: 300 },
    ])).toEqual([
      { label: 'Towar', grossAmount: -70 },
      { label: 'Transport', grossAmount: -30 },
    ])
  })
})

describe('calculateHistoricalContributionMargin', () => {
  it('uses revenue minus COGS and variable costs over closed months', () => {
    const margin = calculateHistoricalContributionMargin([
      { revenue: 10000, cogs: 4000, variableCosts: 1000 },
      { revenue: 12000, cogs: 4800, variableCosts: 1200 },
      { revenue: 8000, cogs: 3200, variableCosts: 800 },
    ])

    expect(margin).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- __tests__/unit/finance/cost-control.test.ts
```

Expected: FAIL because `src/lib/finance/cost-control.ts` does not exist.

- [ ] **Step 3: Implement the pure helper module**

Create `src/lib/finance/cost-control.ts`:

```ts
import { normalizeSupplierNip, roundMoney } from '@/lib/finance/ksef-inbox'

export type PaymentAgingBucket =
  | 'OVERDUE'
  | 'DUE_0_7'
  | 'DUE_8_14'
  | 'DUE_15_30'
  | 'LATER'
  | 'MISSING_DUE_DATE'

export type FinanceCostCenterId = 'JAG' | 'PUL' | 'GLOBAL'

export interface ResolvedAllocation {
  costCenterId: FinanceCostCenterId
  percent: number
}

export interface CostPartValidationInput {
  id?: string
  grossAmount: number
  allocations: ResolvedAllocation[]
}

export interface SupplierRuleDecisionRule {
  id: string
  active: boolean
  priority: number
  supplierNamePattern?: string | null
  supplierNip?: string | null
}

export type SupplierRuleDecision =
  | { status: 'NO_MATCH' }
  | { status: 'MATCHED'; ruleId: string }
  | { status: 'CONFLICT'; conflictingRuleIds: string[] }

export function calculatePaymentAgingBucket(dueDate: Date | null, now = new Date()): PaymentAgingBucket {
  if (!dueDate) return 'MISSING_DUE_DATE'

  const today = businessDateKey(now)
  const due = businessDateKey(dueDate)
  const diffDays = Math.floor((Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000)

  if (diffDays < 0) return 'OVERDUE'
  if (diffDays <= 7) return 'DUE_0_7'
  if (diffDays <= 14) return 'DUE_8_14'
  if (diffDays <= 30) return 'DUE_15_30'
  return 'LATER'
}

function businessDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function validateResolvedAllocation(allocations: ResolvedAllocation[]) {
  if (allocations.length === 0) return { ok: false as const, error: 'Wymagana jest alokacja kosztu.' }
  const total = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.percent, 0))
  if (total !== 100) return { ok: false as const, error: 'Suma alokacji musi wynosić 100%.' }
  return { ok: true as const }
}

export function validateCostParts(invoiceGrossAmount: number, parts: CostPartValidationInput[]) {
  const partsTotal = roundMoney(parts.reduce((sum, part) => sum + part.grossAmount, 0))
  if (partsTotal !== roundMoney(invoiceGrossAmount)) {
    return { ok: false as const, error: 'Suma części faktury musi być równa kwocie brutto faktury.' }
  }

  for (const part of parts) {
    const allocation = validateResolvedAllocation(part.allocations)
    if (!allocation.ok) return allocation
  }

  return { ok: true as const }
}

export function resolveSupplierRuleDecision(
  invoice: { supplierName: string; supplierNip?: string | null },
  rules: SupplierRuleDecisionRule[]
): SupplierRuleDecision {
  const activeRules = rules.filter((rule) => rule.active)
  const supplierNip = normalizeSupplierNip(invoice.supplierNip)
  const supplierName = invoice.supplierName.trim().toLowerCase()

  const nipMatches = supplierNip
    ? activeRules.filter((rule) => normalizeSupplierNip(rule.supplierNip) === supplierNip)
    : []
  if (nipMatches.length > 0) return bestRuleDecision(nipMatches)

  const nameMatches = activeRules.filter((rule) => {
    const pattern = rule.supplierNamePattern?.trim().toLowerCase()
    return pattern ? supplierName.includes(pattern) : false
  })
  return bestRuleDecision(nameMatches)
}

function bestRuleDecision(matches: SupplierRuleDecisionRule[]): SupplierRuleDecision {
  if (matches.length === 0) return { status: 'NO_MATCH' }
  const bestPriority = Math.min(...matches.map((rule) => rule.priority))
  const best = matches.filter((rule) => rule.priority === bestPriority)
  if (best.length === 1) return { status: 'MATCHED', ruleId: best[0].id }
  return { status: 'CONFLICT', conflictingRuleIds: best.map((rule) => rule.id).sort() }
}

export function suggestCorrectionPartsFromOriginal(
  correctionGrossAmount: number,
  originalParts: Array<{ label: string; grossAmount: number }>
) {
  const originalTotal = originalParts.reduce((sum, part) => sum + part.grossAmount, 0)
  if (originalTotal === 0) return []

  let allocated = 0
  return originalParts.map((part, index) => {
    const isLast = index === originalParts.length - 1
    const amount = isLast
      ? roundMoney(correctionGrossAmount - allocated)
      : roundMoney(correctionGrossAmount * (part.grossAmount / originalTotal))
    allocated = roundMoney(allocated + amount)
    return { label: part.label, grossAmount: amount }
  })
}

export function calculateHistoricalContributionMargin(
  months: Array<{ revenue: number; cogs: number; variableCosts: number }>
) {
  const revenue = months.reduce((sum, month) => sum + month.revenue, 0)
  if (revenue <= 0) return null
  const contribution = months.reduce((sum, month) => sum + month.revenue - month.cogs - month.variableCosts, 0)
  return roundMoney(contribution / revenue)
}
```

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npm test -- __tests__/unit/finance/cost-control.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/cost-control.ts __tests__/unit/finance/cost-control.test.ts
git commit -m "Add cost control domain helpers"
```

## Task 2: Prisma Cost-Control Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add schema fields and models**

Modify `prisma/schema.prisma` with these model changes. Keep existing fields; add the new fields shown here.

```prisma
model KsefInvoice {
  id            String   @id @default(cuid())
  source        String   @default("MANUAL")
  externalId    String?  @unique
  supplierName  String
  supplierNip   String?
  invoiceNumber String
  issueDate     DateTime
  grossAmount   Float
  netAmount     Float?
  vatAmount     Float?
  currency      String   @default("PLN")
  reportingGrossAmount Float?
  reportingNetAmount   Float?
  reportingVatAmount   Float?
  originalCurrency     String?
  originalGrossAmount  Float?
  originalNetAmount    Float?
  originalVatAmount    Float?
  currencyConversionNote String?
  convertedById String?
  convertedAt   DateTime?
  status        String   @default("NEW")
  paymentStatus String   @default("UNPAID")
  paidAt        DateTime?
  dueDate       DateTime?
  documentStatus String  @default("ACTIVE")
  ruleMatchStatus String @default("NO_RULE")
  correctsInvoiceId String?
  correctsInvoice   KsefInvoice? @relation("KsefCorrection", fields: [correctsInvoiceId], references: [id])
  corrections       KsefInvoice[] @relation("KsefCorrection")
  notes         String?
  actualEntryId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  costCenterId String?
  costCenter   CostCenter? @relation(fields: [costCenterId], references: [id])
  subCategoryId String?
  subCategory   SubCategory? @relation(fields: [subCategoryId], references: [id])
  supplierRuleId String?
  supplierRule   KsefSupplierRule? @relation(fields: [supplierRuleId], references: [id])

  costEvent CostEvent?
  parts     KsefInvoicePart[]
  auditLogs CostAuditLog[]

  @@index([status])
  @@index([paymentStatus])
  @@index([documentStatus])
  @@index([ruleMatchStatus])
  @@index([correctsInvoiceId])
  @@index([dueDate])
  @@index([issueDate])
  @@index([supplierNip])
  @@unique([supplierNip, invoiceNumber, issueDate])
}

model KsefSupplierRule {
  id                  String   @id @default(cuid())
  supplierNamePattern String?
  supplierNip         String?
  priority            Int      @default(100)
  active              Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  costCenterId  String
  costCenter    CostCenter  @relation(fields: [costCenterId], references: [id])
  subCategoryId String
  subCategory   SubCategory @relation(fields: [subCategoryId], references: [id])
  invoices      KsefInvoice[]
  tags          KsefSupplierRuleTag[]

  @@index([active])
  @@index([supplierNip])
  @@index([priority])
}

model CostTagGroup {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique
  order     Int       @default(0)
  tags      CostTag[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model CostTag {
  id        String       @id @default(cuid())
  groupId   String
  group     CostTagGroup @relation(fields: [groupId], references: [id])
  name      String
  slug      String       @unique
  active    Boolean      @default(true)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  invoiceParts KsefInvoicePartTag[]
  eventParts   CostEventPartTag[]
  supplierRules KsefSupplierRuleTag[]
}

model KsefSupplierRuleTag {
  id     String @id @default(cuid())
  ruleId String
  rule   KsefSupplierRule @relation(fields: [ruleId], references: [id])
  tagId  String
  tag    CostTag @relation(fields: [tagId], references: [id])

  @@unique([ruleId, tagId])
}

model KsefInvoicePart {
  id          String   @id @default(cuid())
  invoiceId   String
  invoice     KsefInvoice @relation(fields: [invoiceId], references: [id])
  label       String
  grossAmount Float
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tags        KsefInvoicePartTag[]
  allocations KsefInvoicePartAllocation[]
}

model KsefInvoicePartTag {
  id     String @id @default(cuid())
  partId String
  part   KsefInvoicePart @relation(fields: [partId], references: [id])
  tagId  String
  tag    CostTag @relation(fields: [tagId], references: [id])

  @@unique([partId, tagId])
}

model KsefInvoicePartAllocation {
  id           String @id @default(cuid())
  partId       String
  part         KsefInvoicePart @relation(fields: [partId], references: [id])
  costCenterId String
  costCenter   CostCenter @relation(fields: [costCenterId], references: [id])
  percent      Float

  @@unique([partId, costCenterId])
}

model CostEvent {
  id            String   @id @default(cuid())
  source        String
  sourceInvoiceId String? @unique
  sourceInvoice   KsefInvoice? @relation(fields: [sourceInvoiceId], references: [id])
  eventDate     DateTime
  supplierName  String?
  supplierNip   String?
  reference     String?
  grossAmount   Float
  netAmount     Float?
  vatAmount     Float?
  currency      String   @default("PLN")
  status        String   @default("APPROVED")
  documentStatus String  @default("ACTIVE")
  isConfidential Boolean @default(false)
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  parts     CostEventPart[]
  auditLogs CostAuditLog[]

  @@index([eventDate])
  @@index([status])
  @@index([supplierNip])
  @@index([isConfidential])
}

model CostEventPart {
  id          String   @id @default(cuid())
  eventId     String
  event       CostEvent @relation(fields: [eventId], references: [id])
  label       String
  grossAmount Float
  order       Int      @default(0)

  tags        CostEventPartTag[]
  allocations CostEventPartAllocation[]
}

model CostEventPartTag {
  id     String @id @default(cuid())
  partId String
  part   CostEventPart @relation(fields: [partId], references: [id])
  tagId  String
  tag    CostTag @relation(fields: [tagId], references: [id])

  @@unique([partId, tagId])
}

model CostEventPartAllocation {
  id           String @id @default(cuid())
  partId       String
  part         CostEventPart @relation(fields: [partId], references: [id])
  costCenterId String
  costCenter   CostCenter @relation(fields: [costCenterId], references: [id])
  percent      Float
  fallbackUsed Boolean @default(false)

  @@unique([partId, costCenterId])
}

model CostAuditLog {
  id          String   @id @default(cuid())
  invoiceId   String?
  invoice     KsefInvoice? @relation(fields: [invoiceId], references: [id])
  costEventId String?
  costEvent   CostEvent? @relation(fields: [costEventId], references: [id])
  action      String
  actorId     String?
  beforeJson  String?
  afterJson   String?
  createdAt   DateTime @default(now())

  @@index([invoiceId])
  @@index([costEventId])
  @@index([createdAt])
}

model FinancePeriodClose {
  id        String   @id @default(cuid())
  year      Int
  month     Int
  source    String   @default("MANUAL")
  closedById String?
  closedAt  DateTime @default(now())
  note      String?

  @@unique([year, month])
}

model ContributionMarginSetting {
  id           String   @id @default(cuid())
  costCenterId String
  costCenter   CostCenter @relation(fields: [costCenterId], references: [id])
  margin        Float
  effectiveFrom DateTime
  note          String?
  createdById   String?
  createdAt     DateTime @default(now())

  @@index([costCenterId, effectiveFrom])
}
```

Add the missing relation arrays to `CostCenter`:

```prisma
  ksefInvoicePartAllocations KsefInvoicePartAllocation[]
  costEventPartAllocations   CostEventPartAllocation[]
  contributionMarginSettings ContributionMarginSetting[]
```

- [ ] **Step 2: Seed controlled tag groups and starter tags**

Modify `prisma/seed.ts` so the seed upserts:

```ts
const tagSeed = [
  { group: { slug: 'behavior', name: 'Charakter kosztu', order: 10 }, tags: ['fixed', 'variable', 'COGS', 'one-off'] },
  { group: { slug: 'area', name: 'Obszar', order: 20 }, tags: ['wallpapers', 'stucco', 'rugs', 'installation', 'administration'] },
  { group: { slug: 'role', name: 'Rola', order: 30 }, tags: ['contractors', 'goods', 'marketing', 'rent', 'transport', 'payroll', 'confidential'] },
  { group: { slug: 'supplier-group', name: 'Grupa dostawców', order: 40 }, tags: ['strategic-supplier', 'new-supplier'] },
]
```

Use `upsert` by group slug and tag slug so repeated seeds are safe.

- [ ] **Step 3: Run Prisma checks**

Run:

```bash
npx prisma generate
npm test -- __tests__/unit/finance/cost-control.test.ts
```

Expected: Prisma client generates successfully; focused domain test remains PASS.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts src/generated/prisma
git commit -m "Add cost control data model"
```

## Task 3: ADMIN-Only Finance Access Guards

**Files:**
- Create: `src/lib/finance/finance-access.ts`
- Modify: all KSeF API routes under `src/app/api/finance/ksef/**`
- Modify: `src/app/(dashboard)/finance/ksef/page.tsx`

- [ ] **Step 1: Create finance access helper**

Create `src/lib/finance/finance-access.ts`:

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export type FinanceRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

export async function requireFinanceAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

export async function requireFinanceReportAccess() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

export function canViewConfidentialCosts(role: string | undefined) {
  return role === 'ADMIN'
}
```

- [ ] **Step 2: Replace KSeF operational route guards**

In these files, remove local `requireFinanceAccess` and call `requireFinanceAdmin()`:

- `src/app/api/finance/ksef/invoices/route.ts`
- `src/app/api/finance/ksef/invoices/[id]/route.ts`
- `src/app/api/finance/ksef/invoices/[id]/approve/route.ts`
- `src/app/api/finance/ksef/invoices/[id]/content/route.ts`
- `src/app/api/finance/ksef/rules/route.ts`
- `src/app/api/finance/ksef/sync/route.ts`

Pattern:

```ts
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

const auth = await requireFinanceAdmin()
if (auth.error) return auth.error
```

- [ ] **Step 3: Enforce ADMIN on KSeF page**

Modify `src/app/(dashboard)/finance/ksef/page.tsx` after the session check:

```ts
if (session.user.role !== 'ADMIN') redirect('/finance')
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- __tests__/unit/finance/ksef-inbox.test.ts __tests__/unit/finance/ksef-inbox-view.test.tsx
npm run build
```

Expected: focused tests PASS; build PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/finance-access.ts src/app/api/finance/ksef 'src/app/(dashboard)/finance/ksef/page.tsx'
git commit -m "Restrict KSeF operations to admin"
```

## Task 4: KSeF Payment Status, Due Dates, Aging Filters, And Summary

**Files:**
- Modify: `src/lib/validations/ksef-inbox.ts`
- Modify: `src/app/api/finance/ksef/invoices/route.ts`
- Create: `src/app/api/finance/ksef/invoices/[id]/payment/route.ts`
- Create: `src/app/api/finance/ksef/invoices/[id]/currency-conversion/route.ts`
- Create: `src/components/shared/ksef-payment-summary.tsx`
- Modify: `src/components/shared/ksef-inbox-view.tsx`
- Modify: `__tests__/unit/finance/ksef-inbox.test.ts`
- Modify: `__tests__/unit/finance/ksef-inbox-view.test.tsx`

- [ ] **Step 1: Extend query and payment schemas with failing tests**

Add tests to `__tests__/unit/finance/ksef-inbox.test.ts`:

```ts
it('accepts payment and payment deadline filters', () => {
  expect(KsefInvoiceQuerySchema.parse({
    paymentStatus: 'UNPAID',
    paymentDeadline: 'DUE_0_7',
    pageSize: '100',
  })).toMatchObject({
    paymentStatus: 'UNPAID',
    paymentDeadline: 'DUE_0_7',
    pageSize: 100,
  })
})
```

Run:

```bash
npm test -- __tests__/unit/finance/ksef-inbox.test.ts
```

Expected: FAIL because schema fields are missing.

- [ ] **Step 2: Update Zod schemas**

Modify `src/lib/validations/ksef-inbox.ts`:

```ts
export const VALID_PAYMENT_STATUSES = ['UNPAID', 'PAID'] as const
export const VALID_PAYMENT_DEADLINES = ['OVERDUE', 'DUE_0_7', 'DUE_8_14', 'DUE_15_30', 'LATER', 'MISSING_DUE_DATE'] as const
export const VALID_DOCUMENT_STATUSES = ['ACTIVE', 'CORRECTED', 'CORRECTION', 'CANCELLED'] as const
export const VALID_RULE_MATCH_STATUSES = ['NO_RULE', 'MATCHED', 'CONFLICT'] as const

export const KsefInvoicePaymentSchema = z.object({
  paymentStatus: z.enum(VALID_PAYMENT_STATUSES),
  paidAt: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
})

export const KsefInvoiceCurrencyConversionSchema = z.object({
  reportingGrossAmount: z.coerce.number().positive('Kwota brutto PLN musi być większa od zera'),
  reportingNetAmount: z.coerce.number().nonnegative('Kwota netto PLN nie może być ujemna').optional().nullable(),
  reportingVatAmount: z.coerce.number().nonnegative('VAT PLN nie może być ujemny').optional().nullable(),
  currencyConversionNote: z.string().trim().min(3, 'Dodaj krótką notatkę kursową'),
})
```

Extend `KsefInvoiceQuerySchema` with:

```ts
  paymentStatus: z.enum(VALID_PAYMENT_STATUSES).optional(),
  paymentDeadline: z.enum(VALID_PAYMENT_DEADLINES).optional(),
  documentStatus: z.enum(VALID_DOCUMENT_STATUSES).optional(),
  ruleMatchStatus: z.enum(VALID_RULE_MATCH_STATUSES).optional(),
```

- [ ] **Step 3: Add list aggregates**

In `src/app/api/finance/ksef/invoices/route.ts`, add query handling for:

- `paymentStatus`
- `documentStatus`
- `ruleMatchStatus`
- due-date bucket filtering using `calculatePaymentAgingBucket`

Return this shape:

```ts
{
  invoices,
  total,
  grossAmountTotal,
  unpaidAmountTotal,
  paymentAging: {
    OVERDUE: { count: number, grossAmount: number },
    DUE_0_7: { count: number, grossAmount: number },
    DUE_8_14: { count: number, grossAmount: number },
    DUE_15_30: { count: number, grossAmount: number },
    LATER: { count: number, grossAmount: number },
    MISSING_DUE_DATE: { count: number, grossAmount: number },
  },
  page,
  pageSize,
  totalPages,
  counts,
}
```

Use the same `where` filter for all aggregate totals so bottom summaries always reflect the active filter.

- [ ] **Step 4: Add payment update endpoint**

Create `src/app/api/finance/ksef/invoices/[id]/payment/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { KsefInvoicePaymentSchema } from '@/lib/validations/ksef-inbox'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoicePaymentSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const data = parsed.data
  const invoice = await prisma.ksefInvoice.update({
    where: { id },
    data: {
      paymentStatus: data.paymentStatus,
      paidAt: data.paymentStatus === 'PAID' ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      auditLogs: {
        create: {
          action: 'payment.update',
          actorId: auth.session.user.id,
          afterJson: JSON.stringify(data),
        },
      },
    },
    include: {
      costCenter: true,
      subCategory: { include: { category: true } },
      supplierRule: true,
    },
  })

  return NextResponse.json({ invoice })
}
```

- [ ] **Step 5: Add foreign-currency PLN conversion endpoint**

Create `src/app/api/finance/ksef/invoices/[id]/currency-conversion/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { KsefInvoiceCurrencyConversionSchema } from '@/lib/validations/ksef-inbox'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceCurrencyConversionSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const existing = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (existing.status === 'APPROVED') {
    return NextResponse.json({ error: 'Zatwierdzonej faktury nie można przeliczać ponownie.' }, { status: 409 })
  }
  if (existing.currency === 'PLN') {
    return NextResponse.json({ error: 'Faktura PLN nie wymaga przeliczenia waluty.' }, { status: 400 })
  }

  const data = parsed.data
  const invoice = await prisma.ksefInvoice.update({
    where: { id },
    data: {
      originalCurrency: existing.originalCurrency ?? existing.currency,
      originalGrossAmount: existing.originalGrossAmount ?? existing.grossAmount,
      originalNetAmount: existing.originalNetAmount ?? existing.netAmount,
      originalVatAmount: existing.originalVatAmount ?? existing.vatAmount,
      reportingGrossAmount: roundMoney(data.reportingGrossAmount),
      reportingNetAmount: data.reportingNetAmount == null ? null : roundMoney(data.reportingNetAmount),
      reportingVatAmount: data.reportingVatAmount == null ? null : roundMoney(data.reportingVatAmount),
      currencyConversionNote: data.currencyConversionNote,
      convertedById: auth.session.user.id,
      convertedAt: new Date(),
      auditLogs: {
        create: {
          action: 'currency.convert',
          actorId: auth.session.user.id,
          beforeJson: JSON.stringify({
            currency: existing.currency,
            grossAmount: existing.grossAmount,
            netAmount: existing.netAmount,
            vatAmount: existing.vatAmount,
          }),
          afterJson: JSON.stringify(data),
        },
      },
    },
    include: {
      costCenter: true,
      subCategory: { include: { category: true } },
      supplierRule: true,
    },
  })

  return NextResponse.json({ invoice })
}
```

- [ ] **Step 6: Add payment summary component**

Create `src/components/shared/ksef-payment-summary.tsx`:

```tsx
interface AgingBucketSummary {
  count: number
  grossAmount: number
}

interface KsefPaymentSummaryProps {
  grossAmountTotal: number
  unpaidAmountTotal: number
  paymentAging: Record<string, AgingBucketSummary>
  formatMoney: (value: number) => string
}

const LABELS: Record<string, string> = {
  OVERDUE: 'Po terminie',
  DUE_0_7: '0-7 dni',
  DUE_8_14: '8-14 dni',
  DUE_15_30: '15-30 dni',
}

export function KsefPaymentSummary({ grossAmountTotal, unpaidAmountTotal, paymentAging, formatMoney }: KsefPaymentSummaryProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
      <div>
        <p className="data-label">Suma faktur</p>
        <p className="num text-sm font-semibold">{formatMoney(grossAmountTotal)}</p>
      </div>
      <div>
        <p className="data-label">Pozostało do zapłaty</p>
        <p className="num text-sm font-semibold">{formatMoney(unpaidAmountTotal)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Object.entries(LABELS).map(([bucket, label]) => (
          <div key={bucket} className="rounded border border-[var(--wd-border)] px-2 py-1">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--wd-text-muted)' }}>{label}</p>
            <p className="num text-xs font-semibold">{paymentAging[bucket]?.count ?? 0} / {formatMoney(paymentAging[bucket]?.grossAmount ?? 0)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Wire UI and tests**

Modify `src/components/shared/ksef-inbox-view.tsx`:

- Add filters for `paymentStatus` and `paymentDeadline`.
- Add `paymentStatus`, `paidAt`, `dueDate`, `documentStatus`, `ruleMatchStatus` to `KsefInvoiceRow`.
- Add `reportingGrossAmount`, `reportingNetAmount`, `reportingVatAmount`, `originalCurrency`, and `currencyConversionNote` to `KsefInvoiceRow`.
- Add response fields `unpaidAmountTotal` and `paymentAging`.
- Render `KsefPaymentSummary` in the bottom bar.
- Add a paid/unpaid checkbox or button in each row.
- For `currency !== 'PLN'` and missing `reportingGrossAmount`, show a compact "Przelicz PLN" action that opens a small form and calls `/api/finance/ksef/invoices/[id]/currency-conversion`.

Add test to `__tests__/unit/finance/ksef-inbox-view.test.tsx`:

```tsx
it('shows unpaid total and payment aging buckets', () => {
  render(<KsefInboxView {...propsWithPaymentSummary} />)
  expect(screen.getByText('Pozostało do zapłaty')).toBeTruthy()
  expect(screen.getByText('Po terminie')).toBeTruthy()
  expect(screen.getByText('0-7 dni')).toBeTruthy()
})
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/ksef-inbox.test.ts __tests__/unit/finance/ksef-inbox-view.test.tsx __tests__/unit/finance/cost-control.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/validations/ksef-inbox.ts src/app/api/finance/ksef/invoices src/components/shared/ksef-inbox-view.tsx src/components/shared/ksef-payment-summary.tsx __tests__/unit/finance/ksef-inbox.test.ts __tests__/unit/finance/ksef-inbox-view.test.tsx
git commit -m "Add KSeF payment control and aging summaries"
```

## Task 5: Supplier Rule Conflict Detection And Reclassification Preview

**Files:**
- Modify: `src/lib/finance/ksef-inbox.ts`
- Modify: `src/lib/finance/ksef-rule-application.ts`
- Modify: `src/app/api/finance/ksef/rules/route.ts`
- Create: `src/app/api/finance/ksef/rules/reclassification-preview/route.ts`
- Modify: `__tests__/unit/finance/ksef-inbox.test.ts`

- [ ] **Step 1: Extend rule matching tests**

Add tests that assert:

- exact NIP wins over name.
- exact normalized name wins over partial name.
- equal priority conflict returns `CONFLICT`.
- conflict sets `ruleMatchStatus = 'CONFLICT'` and does not assign a supplier rule.

Run:

```bash
npm test -- __tests__/unit/finance/ksef-inbox.test.ts
```

Expected: FAIL until the existing `findMatchingSupplierRule` is replaced or wrapped.

- [ ] **Step 2: Replace single-rule return with a decision object**

In `src/lib/finance/ksef-inbox.ts`, export:

```ts
export type SupplierRuleMatchDecision =
  | { status: 'NO_RULE' }
  | { status: 'MATCHED'; rule: SupplierRuleInput }
  | { status: 'CONFLICT'; rules: SupplierRuleInput[] }
```

Implement `resolveSupplierRuleMatch(invoice, rules)` using `resolveSupplierRuleDecision` from `cost-control.ts`.

Keep `findMatchingSupplierRule()` as a compatibility wrapper:

```ts
export function findMatchingSupplierRule(invoice: SupplierMatchInput, rules: SupplierRuleInput[]) {
  const decision = resolveSupplierRuleMatch(invoice, rules)
  return decision.status === 'MATCHED' ? decision.rule : null
}
```

- [ ] **Step 3: Update rule application**

Modify `src/lib/finance/ksef-rule-application.ts`:

- `MATCHED`: update invoice status to `MAPPED`, set `supplierRuleId`, set `ruleMatchStatus = 'MATCHED'`.
- `CONFLICT`: leave status as `NEW`, clear `supplierRuleId`, set `ruleMatchStatus = 'CONFLICT'`.
- `NO_RULE`: leave status as `NEW`, set `ruleMatchStatus = 'NO_RULE'`.

- [ ] **Step 4: Implement reclassification preview**

Create `src/app/api/finance/ksef/rules/reclassification-preview/route.ts`:

- ADMIN-only.
- Accept `{ ruleId: string }`.
- Find approved invoices that match the rule.
- Return a diff array with current tags/allocation and proposed tags/allocation.
- Do not mutate data.
- Write no audit rows during preview.

The response shape:

```ts
{
  ruleId: string,
  affectedCount: number,
  diffs: Array<{
    invoiceId: string,
    invoiceNumber: string,
    supplierName: string,
    before: { costCenterId: string | null, subCategoryId: string | null },
    after: { costCenterId: string, subCategoryId: string },
  }>
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/ksef-inbox.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/ksef-inbox.ts src/lib/finance/ksef-rule-application.ts src/app/api/finance/ksef/rules __tests__/unit/finance/ksef-inbox.test.ts
git commit -m "Add supplier rule conflicts and reclassification preview"
```

## Task 6: Tags, Invoice Parts, And Allocation APIs

**Files:**
- Create: `src/lib/validations/cost-control.ts`
- Create: `src/app/api/finance/cost-tags/route.ts`
- Create: `src/app/api/finance/ksef/invoices/[id]/parts/route.ts`
- Create: `src/components/shared/ksef-invoice-parts-editor.tsx`
- Modify: `src/components/shared/ksef-inbox-view.tsx`
- Modify: `__tests__/unit/finance/ksef-inbox-view.test.tsx`

- [ ] **Step 1: Add validation schemas**

Create `src/lib/validations/cost-control.ts`:

```ts
import { z } from 'zod'
import { VALID_COST_CENTERS } from '@/lib/validations/ksef-inbox'

export const CostAllocationSchema = z.object({
  costCenterId: z.enum(VALID_COST_CENTERS),
  percent: z.coerce.number().positive().max(100),
})

export const KsefInvoicePartInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  grossAmount: z.coerce.number(),
  tagIds: z.array(z.string().min(1)).default([]),
  allocations: z.array(CostAllocationSchema).min(1),
})

export const KsefInvoicePartsUpdateSchema = z.object({
  parts: z.array(KsefInvoicePartInputSchema).min(1),
})
```

- [ ] **Step 2: Add tags endpoint**

Create `src/app/api/finance/cost-tags/route.ts`:

- GET uses `requireFinanceAdmin()`.
- Returns active tag groups ordered by group order and tag name.

Response:

```ts
{
  groups: Array<{
    id: string,
    name: string,
    slug: string,
    tags: Array<{ id: string, name: string, slug: string }>
  }>
}
```

- [ ] **Step 3: Add invoice parts endpoint**

Create `src/app/api/finance/ksef/invoices/[id]/parts/route.ts`:

- ADMIN-only.
- Reject approved invoices with HTTP 409.
- Validate that sum of parts equals invoice gross amount.
- Validate each part allocation equals 100%.
- Replace existing invoice parts in a transaction.
- Write `CostAuditLog` action `invoice.parts.update`.

- [ ] **Step 4: Add parts editor UI**

Create `src/components/shared/ksef-invoice-parts-editor.tsx` with:

- part label input.
- gross amount input.
- tag multi-select grouped by tag group.
- allocation rows for `JAG`, `PUL`, `GLOBAL`.
- visible validation messages for part total and allocation total.
- save button calling `/api/finance/ksef/invoices/[id]/parts`.

Keep it as a modal invoked from `KsefInboxView`.

- [ ] **Step 5: Add UI tests**

In `__tests__/unit/finance/ksef-inbox-view.test.tsx`, add:

```tsx
it('opens invoice parts editor from an invoice row', async () => {
  const user = userEvent.setup()
  render(<KsefInboxView {...propsWithTags} />)
  await user.click(screen.getByTitle('Rozbij fakturę'))
  expect(screen.getByText('Części faktury')).toBeTruthy()
  expect(screen.getByText('Suma części')).toBeTruthy()
})
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/cost-control.test.ts __tests__/unit/finance/ksef-inbox-view.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/lib/validations/cost-control.ts src/app/api/finance/cost-tags/route.ts 'src/app/api/finance/ksef/invoices/[id]/parts/route.ts' src/components/shared/ksef-invoice-parts-editor.tsx src/components/shared/ksef-inbox-view.tsx __tests__/unit/finance/ksef-inbox-view.test.tsx
git commit -m "Add invoice parts and allocation editing"
```

## Task 7: Approve KSeF Invoices Into Cost Events

**Files:**
- Create: `src/lib/finance/cost-events.ts`
- Create: `__tests__/unit/finance/cost-events.test.ts`
- Modify: `src/app/api/finance/ksef/invoices/[id]/approve/route.ts`

- [ ] **Step 1: Write cost-event creation tests**

Create `__tests__/unit/finance/cost-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCostEventDraftFromKsefInvoice } from '@/lib/finance/cost-events'

describe('buildCostEventDraftFromKsefInvoice', () => {
  it('blocks non-PLN invoices until manual PLN conversion is provided', () => {
    expect(() => buildCostEventDraftFromKsefInvoice({
      id: 'inv-eur',
      currency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'SaaS Vendor',
      supplierNip: null,
      invoiceNumber: 'EUR/1',
      grossAmount: 100,
      netAmount: 100,
      vatAmount: 0,
      parts: [],
    })).toThrow('Faktura w walucie obcej wymaga ręcznego przeliczenia na PLN przed zatwierdzeniem.')
  })

  it('uses ADMIN-entered PLN reporting amounts for foreign-currency invoices', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-eur',
      currency: 'EUR',
      originalCurrency: 'EUR',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'SaaS Vendor',
      supplierNip: null,
      invoiceNumber: 'EUR/1',
      grossAmount: 100,
      netAmount: 100,
      vatAmount: 0,
      reportingGrossAmount: 430,
      reportingNetAmount: 430,
      reportingVatAmount: 0,
      currencyConversionNote: 'EUR x 4.30',
      costCenterId: 'GLOBAL',
      subCategoryId: 'legacy-sub',
      parts: [],
    })

    expect(draft.currency).toBe('PLN')
    expect(draft.grossAmount).toBe(430)
    expect(draft.originalCurrency).toBe('EUR')
    expect(draft.originalGrossAmount).toBe(100)
  })

  it('uses invoice-level classification when no parts exist', () => {
    const draft = buildCostEventDraftFromKsefInvoice({
      id: 'inv-1',
      currency: 'PLN',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      supplierName: 'REMI',
      supplierNip: '9462595618',
      invoiceNumber: 'FV/1',
      grossAmount: 1000,
      netAmount: 813,
      vatAmount: 187,
      costCenterId: 'GLOBAL',
      subCategoryId: 'legacy-sub',
      parts: [],
    })

    expect(draft.parts).toEqual([
      {
        label: 'FV/1',
        grossAmount: 1000,
        tagIds: [],
        allocations: [{ costCenterId: 'GLOBAL', percent: 100, fallbackUsed: false }],
      },
    ])
  })
})
```

Run:

```bash
npm test -- __tests__/unit/finance/cost-events.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 2: Implement cost-event helper**

Create `src/lib/finance/cost-events.ts`:

```ts
import { validateCostParts, type FinanceCostCenterId } from '@/lib/finance/cost-control'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export interface KsefInvoiceForCostEvent {
  id: string
  currency: string
  originalCurrency?: string | null
  issueDate: Date
  supplierName: string
  supplierNip: string | null
  invoiceNumber: string
  grossAmount: number
  netAmount: number | null
  vatAmount: number | null
  reportingGrossAmount?: number | null
  reportingNetAmount?: number | null
  reportingVatAmount?: number | null
  currencyConversionNote?: string | null
  costCenterId?: string | null
  subCategoryId?: string | null
  parts: Array<{
    label: string
    grossAmount: number
    tags: Array<{ tagId: string }>
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

export function buildCostEventDraftFromKsefInvoice(invoice: KsefInvoiceForCostEvent) {
  const isForeignCurrency = invoice.currency !== 'PLN'
  if (isForeignCurrency && invoice.reportingGrossAmount == null) {
    throw new Error('Faktura w walucie obcej wymaga ręcznego przeliczenia na PLN przed zatwierdzeniem.')
  }
  const reportingGrossAmount = roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount)
  const reportingNetAmount = invoice.reportingNetAmount ?? invoice.netAmount
  const reportingVatAmount = invoice.reportingVatAmount ?? invoice.vatAmount

  const parts = invoice.parts.length > 0
    ? invoice.parts.map((part) => ({
        label: part.label,
        grossAmount: roundMoney(part.grossAmount),
        tagIds: part.tags.map((tag) => tag.tagId),
        allocations: part.allocations.map((allocation) => ({
          costCenterId: allocation.costCenterId as FinanceCostCenterId,
          percent: allocation.percent,
          fallbackUsed: false,
        })),
      }))
    : [{
        label: invoice.invoiceNumber,
        grossAmount: reportingGrossAmount,
        tagIds: [],
        allocations: [{
          costCenterId: (invoice.costCenterId ?? 'GLOBAL') as FinanceCostCenterId,
          percent: 100,
          fallbackUsed: false,
        }],
      }]

  const validation = validateCostParts(reportingGrossAmount, parts)
  if (!validation.ok) throw new Error(validation.error)

  return {
    source: 'KSEF',
    sourceInvoiceId: invoice.id,
    eventDate: invoice.issueDate,
    supplierName: invoice.supplierName,
    supplierNip: invoice.supplierNip,
    reference: invoice.invoiceNumber,
    grossAmount: reportingGrossAmount,
    netAmount: reportingNetAmount == null ? null : roundMoney(reportingNetAmount),
    vatAmount: reportingVatAmount == null ? null : roundMoney(reportingVatAmount),
    currency: 'PLN',
    originalCurrency: isForeignCurrency ? invoice.currency : null,
    originalGrossAmount: isForeignCurrency ? roundMoney(invoice.grossAmount) : null,
    currencyConversionNote: isForeignCurrency ? invoice.currencyConversionNote : null,
    parts,
  }
}
```

- [ ] **Step 3: Update approve route**

Modify `src/app/api/finance/ksef/invoices/[id]/approve/route.ts`:

- Use `requireFinanceAdmin()`.
- Load invoice with parts, tags, and allocations.
- Reject `status === 'APPROVED'`.
- Reject `documentStatus === 'CANCELLED'`.
- Reject `ruleMatchStatus === 'CONFLICT'`.
- Reject `currency !== 'PLN'` only when `reportingGrossAmount` is still missing. If PLN reporting amounts exist, approve using those PLN values and preserve original currency values on the source invoice/audit.
- Call `buildCostEventDraftFromKsefInvoice`.
- Create `CostEvent` and nested parts/tags/allocations in one transaction.
- Set invoice `status = 'APPROVED'`.
- Create audit action `invoice.approve`.
- Do not update `ActualEntry` in this new path.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/cost-events.test.ts __tests__/unit/finance/cost-control.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/cost-events.ts 'src/app/api/finance/ksef/invoices/[id]/approve/route.ts' __tests__/unit/finance/cost-events.test.ts
git commit -m "Approve KSeF invoices into cost events"
```

## Task 8: Approved Cost Events Ledger

**Files:**
- Create: `src/lib/finance/cost-reporting.ts`
- Create: `__tests__/unit/finance/cost-reporting.test.ts`
- Create: `src/app/api/finance/cost-events/route.ts`
- Create: `src/components/shared/cost-events-view.tsx`
- Create: `src/app/(dashboard)/finance/cost-events/page.tsx`

- [ ] **Step 1: Write reporting tests**

Create `__tests__/unit/finance/cost-reporting.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCostWarningTotal, summarizeSupplierSpend } from '@/lib/finance/cost-reporting'

describe('summarizeSupplierSpend', () => {
  it('groups approved cost events by supplier NIP when available', () => {
    const rows = summarizeSupplierSpend([
      { supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 100 },
      { supplierName: 'REMI sp.j.', supplierNip: '9462595618', grossAmount: 50 },
      { supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])

    expect(rows).toEqual([
      { key: '9462595618', supplierName: 'REMI', supplierNip: '9462595618', grossAmount: 150 },
      { key: 'No NIP', supplierName: 'No NIP', supplierNip: null, grossAmount: 25 },
    ])
  })
})

describe('buildCostWarningTotal', () => {
  it('sums costs that can make reports incomplete', () => {
    expect(buildCostWarningTotal([
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 100 },
      { status: 'MAPPED', documentStatus: 'CORRECTION', currency: 'PLN', grossAmount: 50 },
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 200 },
    ])).toBe(350)
  })
})
```

- [ ] **Step 2: Implement reporting helpers**

Create `src/lib/finance/cost-reporting.ts` with:

- `summarizeSupplierSpend(events)`.
- `buildCostWarningTotal(invoices)`.
- `filterConfidentialCostEvents(events, role)`.
- `sumAllocatedCostsByCenter(events)`.

- [ ] **Step 3: Implement ledger API**

Create `src/app/api/finance/cost-events/route.ts`:

- GET uses `requireFinanceReportAccess()`.
- MANAGER sees only approved non-confidential events.
- ADMIN sees all approved events and can include confidential with filter.
- Supports supplier search, NIP search, date range, tag filters, allocation filters, and source filters.
- POST uses `requireFinanceAdmin()` and creates a manual `CostEvent`.

- [ ] **Step 4: Implement ledger page**

Create `src/app/(dashboard)/finance/cost-events/page.tsx`:

- Require ADMIN or MANAGER.
- Fetch initial approved cost events.
- Pass role into `CostEventsView`.

Create `src/components/shared/cost-events-view.tsx`:

- Filter bar: period, supplier/NIP, tags, allocation, source.
- ADMIN-only button `Dodaj koszt ręczny`.
- Manual cost form fields: date, source name, reference, gross amount PLN, optional net/VAT, confidential checkbox, tag selector, allocation selector, note.
- Form submits to `POST /api/finance/cost-events` and refreshes the active ledger filter after success.
- Table: date, supplier/source, reference, tags, allocations, gross amount.
- Bottom summary: total for active filter.
- Group selector: supplier, tag, salon, month, payment status.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/cost-reporting.test.ts
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/cost-reporting.ts src/app/api/finance/cost-events/route.ts 'src/app/(dashboard)/finance/cost-events/page.tsx' src/components/shared/cost-events-view.tsx __tests__/unit/finance/cost-reporting.test.ts
git commit -m "Add approved cost events ledger"
```

## Task 9: Break-Even Reporting, Period Close, And Contribution Margin

**Files:**
- Modify: `src/lib/finance/cost-reporting.ts`
- Modify: `__tests__/unit/finance/cost-reporting.test.ts`
- Create: `src/app/api/finance/period-closes/route.ts`
- Create: `src/app/api/finance/break-even/route.ts`
- Create: `src/components/shared/break-even-view.tsx`
- Create: `src/app/(dashboard)/finance/break-even/page.tsx`

- [ ] **Step 1: Add break-even tests**

Extend `__tests__/unit/finance/cost-reporting.test.ts`:

```ts
import { buildBreakEvenReport } from '@/lib/finance/cost-reporting'

it('shows missing contribution margin instead of inventing break-even turnover', () => {
  const report = buildBreakEvenReport({
    revenue: [{ costCenterId: 'JAG', amount: 10000 }],
    allocatedCosts: [{ costCenterId: 'JAG', fixedCosts: 5000, variableCosts: 1000, cogs: 2000 }],
    contributionMargins: {},
    warningAmount: 0,
  })

  expect(report.byCostCenter.JAG.breakEvenTurnover).toBeNull()
  expect(report.byCostCenter.JAG.warning).toBe('missing contribution margin')
})

it('calculates break-even turnover from fixed costs and contribution margin', () => {
  const report = buildBreakEvenReport({
    revenue: [{ costCenterId: 'JAG', amount: 15000 }],
    allocatedCosts: [{ costCenterId: 'JAG', fixedCosts: 6000, variableCosts: 1000, cogs: 2000 }],
    contributionMargins: { JAG: 0.5 },
    warningAmount: 100,
  })

  expect(report.byCostCenter.JAG.breakEvenTurnover).toBe(12000)
  expect(report.byCostCenter.JAG.delta).toBe(3000)
  expect(report.warningAmount).toBe(100)
})
```

- [ ] **Step 2: Implement report builder**

Add to `src/lib/finance/cost-reporting.ts`:

- `buildBreakEvenReport(input)`.
- `selectClosedMonthsForHistoricalMargin(periodCloses, currentYear, currentMonth)`.
- `resolveContributionMargin({ historical, manualOverride })`.

- [ ] **Step 3: Add period close endpoint**

Create `src/app/api/finance/period-closes/route.ts`:

- GET uses `requireFinanceReportAccess()`.
- POST uses `requireFinanceAdmin()`.
- POST body: `{ year: number, month: number, note?: string }`.
- Upsert `FinancePeriodClose` by `year/month`.

- [ ] **Step 4: Add break-even endpoint and page**

Create `src/app/api/finance/break-even/route.ts`:

- GET uses `requireFinanceReportAccess()`.
- Reads revenue, approved cost events, contribution settings, and finance period closes.
- Excludes confidential line items for MANAGER.
- Returns `GLOBAL` costs separately and warning totals.

Create `src/app/(dashboard)/finance/break-even/page.tsx` and `src/components/shared/break-even-view.tsx`:

- Cards for Jagiellońska, Puławska, GLOBAL, and company.
- Show revenue, fixed costs, variable costs, COGS, contribution margin, break-even turnover, delta, and warning amount.
- Show `missing contribution margin` when no historical or manual margin exists.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/cost-reporting.test.ts
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/cost-reporting.ts src/app/api/finance/period-closes/route.ts src/app/api/finance/break-even/route.ts 'src/app/(dashboard)/finance/break-even/page.tsx' src/components/shared/break-even-view.tsx __tests__/unit/finance/cost-reporting.test.ts
git commit -m "Add salon break-even reporting"
```

## Task 10: KSeF XML Due Dates, Corrections, Cancellations, And Foreign Currency Blocking

**Files:**
- Modify: `src/lib/finance/ksef-invoice-preview.ts`
- Modify: `src/lib/finance/ksef-client.ts`
- Modify: `src/app/api/finance/ksef/sync/route.ts`
- Modify: `__tests__/unit/finance/ksef-invoice-preview.test.ts`
- Modify: `__tests__/unit/finance/ksef-client.test.ts`

- [ ] **Step 1: Add XML due-date test**

Extend `__tests__/unit/finance/ksef-invoice-preview.test.ts` with a small XML fixture containing payment due date and assert parsed `paymentDueDate`.

- [ ] **Step 2: Parse due date in preview helper**

Modify `src/lib/finance/ksef-invoice-preview.ts` to return:

```ts
paymentDueDate?: string | null
```

Use KSeF XML payment fields when present. If multiple candidate due-date fields exist, prefer the field explicitly tied to payment terms.

- [ ] **Step 3: Preserve document metadata in sync**

Modify `src/lib/finance/ksef-client.ts` and `src/app/api/finance/ksef/sync/route.ts` so:

- `currency !== 'PLN'` imports as `status = 'NEW'`, `ruleMatchStatus = 'NO_RULE'`, fills `originalCurrency`, `originalGrossAmount`, `originalNetAmount`, and `originalVatAmount`, and leaves `reportingGrossAmount` empty until ADMIN uses the currency-conversion endpoint from Task 4.
- correction documents set `documentStatus = 'CORRECTION'`.
- correction documents set `correctsInvoiceId` when the original invoice can be identified from KSeF metadata or XML references.
- cancelled/invalidated documents set `documentStatus = 'CANCELLED'`.
- duplicate imports update the existing invoice by `externalId`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- __tests__/unit/finance/ksef-client.test.ts __tests__/unit/finance/ksef-invoice-preview.test.ts __tests__/unit/finance/cost-events.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/finance/ksef-invoice-preview.ts src/lib/finance/ksef-client.ts src/app/api/finance/ksef/sync/route.ts __tests__/unit/finance/ksef-client.test.ts __tests__/unit/finance/ksef-invoice-preview.test.ts
git commit -m "Handle KSeF due dates and document statuses"
```

## Task 11: Navigation And Finance Dashboard Links

**Files:**
- Modify: `src/components/shared/sidebar.tsx`
- Modify: `src/app/(dashboard)/finance/page.tsx`
- Modify: `src/components/shared/company-health-view.tsx`

- [ ] **Step 1: Update finance links**

Add links to:

- `/finance/ksef` labeled `KSeF Inbox`, visible only for ADMIN.
- `/finance/cost-events` labeled `Zdarzenia kosztowe`, visible for ADMIN and MANAGER.
- `/finance/break-even` labeled `Break-even`, visible for ADMIN and MANAGER.

- [ ] **Step 2: Add warning summaries to finance home**

Modify `src/app/(dashboard)/finance/page.tsx` to compute:

- KSeF `NEW` + `MAPPED` count for ADMIN.
- unpaid total for ADMIN.
- unclassified warning amount for ADMIN and MANAGER, excluding confidential rows for MANAGER.

Pass these to `CompanyHealthView`.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/components/shared/sidebar.tsx 'src/app/(dashboard)/finance/page.tsx' src/components/shared/company-health-view.tsx
git commit -m "Expose cost control finance navigation"
```

## Task 12: Final Verification

**Files:**
- Check all files touched by previous tasks.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm test -- __tests__/unit/finance/cost-control.test.ts __tests__/unit/finance/cost-events.test.ts __tests__/unit/finance/cost-reporting.test.ts __tests__/unit/finance/ksef-inbox.test.ts __tests__/unit/finance/ksef-inbox-view.test.tsx __tests__/unit/finance/ksef-client.test.ts __tests__/unit/finance/ksef-invoice-preview.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run scoped lint on touched files**

Run:

```bash
npx eslint src/lib/finance/cost-control.ts src/lib/finance/cost-events.ts src/lib/finance/cost-reporting.ts src/lib/finance/finance-access.ts src/lib/validations/cost-control.ts src/lib/validations/ksef-inbox.ts src/components/shared/ksef-inbox-view.tsx src/components/shared/ksef-payment-summary.tsx src/components/shared/ksef-invoice-parts-editor.tsx src/components/shared/cost-events-view.tsx src/components/shared/break-even-view.tsx
```

Expected: PASS for touched files. If unrelated generated Prisma lint fails during full-project lint, document it separately and do not mix unrelated cleanup into this branch.

- [ ] **Step 4: Manual smoke test with dev server**

Run:

```bash
npm run dev
```

Open:

- `http://127.0.0.1:3000/finance/ksef`
- `http://127.0.0.1:3000/finance/cost-events`
- `http://127.0.0.1:3000/finance/break-even`

Verify:

- ADMIN can see KSeF inbox.
- MANAGER is redirected away from KSeF inbox.
- KSeF bottom bar shows total invoices, unpaid total, and aging buckets.
- Paid/unpaid toggle updates the row and summary.
- Rule conflicts are filterable.
- Invoice split editor rejects totals that do not equal invoice gross amount.
- Approved invoice creates a cost event.
- Cost events ledger filters by supplier/NIP.
- Break-even shows GLOBAL separately.

- [ ] **Step 5: Finish verification state**

If verification passes without edits, do not create an empty commit. If verification requires code changes, return to the task that owns the changed file, apply the fix there, repeat that task's focused verification, and use that task's commit step.

## Self-Review Notes

- Spec coverage: payment aging is covered by Tasks 1 and 4; GLOBAL and allocation validation by Tasks 1, 2, 6, and 9; corrections/cancellations/foreign currency by Tasks 7 and 10; supplier conflicts and reclassification preview by Task 5; roles by Task 3; warning totals by Tasks 8 and 9.
- Type consistency: use `UNPAID`/`PAID`, `ACTIVE`/`CORRECTED`/`CORRECTION`/`CANCELLED`, `NO_RULE`/`MATCHED`/`CONFLICT`, and `JAG`/`PUL`/`GLOBAL` consistently in schema, Zod, helper types, API, and UI.
- Execution order matters: run Task 1 before schema/API work, because subsequent tasks depend on the pure helper contracts.
