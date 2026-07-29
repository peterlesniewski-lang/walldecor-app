# HR Leave Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blanket leave-balance initialization with explicit per-employee entitlement configuration, auditable corrections, unpaid leave, and a VLD subtype that consumes the VL pool.

**Architecture:** Add effective-dated entitlement and append-only balance-correction models without changing existing request or balance identifiers. Centralize entitlement calculation and balance-pool resolution in pure HR services, then make every request lifecycle route use those services. Keep configuration ADMIN-only on the employee profile and preserve all existing leave history.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 5 with SQLite migrations, NextAuth role checks, Zod, React 19, Vitest, Testing Library, Tailwind CSS, Lucide icons.

**Source Spec:** `docs/superpowers/specs/2026-07-29-hr-leave-and-monthly-time-tracking-design.md`

---

## File Structure

**Create:**

- `src/lib/hr/leave-entitlement.ts` — pure entitlement calculation and effective-config selection.
- `src/lib/hr/leave-type-catalog.ts` — canonical system leave-type definitions and protected behavior.
- `src/app/api/hr/employees/[id]/leave-entitlement/route.ts` — ADMIN-only read, preview, and apply endpoint.
- `src/components/hr/employees/leave-entitlement-panel.tsx` — employee-profile configuration and correction history.
- `prisma/migrations/20260729_hr_leave_entitlements/migration.sql` — additive entitlement and correction tables plus UB seed.
- `scripts/audit-hr-leave-migration.ts` — read-only pre-deployment inventory.
- `__tests__/unit/hr/leave-entitlement.test.ts`
- `__tests__/unit/hr/leave-balance-policy.test.ts`
- `__tests__/unit/hr/leave-entitlement-route.test.ts`
- `__tests__/unit/hr/leave-balance-correction-route.test.ts`
- `__tests__/unit/hr/leave-entitlement-panel.test.tsx`
- `__tests__/unit/hr/employee-leave-initialization-route.test.ts`

**Modify:**

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `package.json`
- `src/lib/hr/schemas.ts`
- `src/lib/hr/leave-balance-policy.ts`
- `src/app/api/hr/employees/route.ts`
- `src/app/api/hr/employees/[id]/route.ts`
- `src/app/api/hr/leave-balances/[id]/route.ts`
- `src/app/api/hr/leave-balances/route.ts`
- `src/app/api/hr/leave-balances/carryover/route.ts`
- `src/app/api/hr/leave-requests/route.ts`
- `src/app/api/hr/leave-requests/[id]/approve/route.ts`
- `src/app/api/hr/leave-requests/[id]/reject/route.ts`
- `src/app/api/hr/leave-requests/[id]/route.ts`
- `src/app/api/hr/leave-types/route.ts`
- `src/app/api/hr/leave-types/[id]/route.ts`
- `src/app/(dashboard)/hr/employees/[id]/page.tsx`
- `src/app/(dashboard)/hr/leave/types/page.tsx`
- `src/components/hr/employees/leave-tab-client.tsx`
- `src/components/hr/leave/leave-request-form.tsx`
- `__tests__/unit/hr/leave-requests-route.test.ts`
- `__tests__/unit/hr/operational-access.test.ts`

---

### Task 1: Add Effective Entitlement And Correction Models

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260729_hr_leave_entitlements/migration.sql`

- [ ] **Step 1: Add additive Prisma relations and models**

Add relations to `Employee`, `LeaveType`, and `LeaveBalanceNew`, then add these models:

```prisma
model LeaveEntitlementConfig {
  id                 String   @id @default(cuid())
  employeeId         String
  employee           Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  mode               String   // "DAYS_20" | "DAYS_26" | "CUSTOM"
  customAnnualDays   Int?
  employmentFraction Float    @default(1)
  effectiveFrom      DateTime
  note               String?
  createdById        String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([employeeId, effectiveFrom])
  @@index([employeeId, effectiveFrom])
}

model LeaveBalanceCorrection {
  id         String          @id @default(cuid())
  balanceId  String
  balance    LeaveBalanceNew @relation(fields: [balanceId], references: [id], onDelete: Restrict)
  employeeId String
  employee   Employee        @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  leaveTypeId String
  leaveType  LeaveType       @relation(fields: [leaveTypeId], references: [id], onDelete: Restrict)
  year       Int
  reason     String
  actorId    String
  beforeJson String
  afterJson  String
  createdAt  DateTime        @default(now())

  @@index([balanceId, createdAt])
  @@index([employeeId, year])
}
```

Use named relation fields:

```prisma
// Employee
leaveEntitlementConfigs LeaveEntitlementConfig[]
leaveBalanceCorrections LeaveBalanceCorrection[]

// LeaveType
leaveBalanceCorrections LeaveBalanceCorrection[]

// LeaveBalanceNew
corrections LeaveBalanceCorrection[]
```

- [ ] **Step 2: Write the SQLite migration**

Create both tables, indexes, and foreign keys. Do not update or delete `LeaveBalanceNew` or `LeaveRequestNew`. Insert UB idempotently:

```sql
INSERT INTO "LeaveType" (
  "id", "name", "code", "color", "isPaid",
  "requiresApproval", "tracksBalance", "maxDaysPerYear", "isActive"
)
SELECT
  'leave-type-ub', 'Urlop bezpłatny', 'UB', '#64748B', false,
  true, false, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM "LeaveType" WHERE "code" = 'UB');
```

Also normalize only the protected flags, without touching requests or balances:

```sql
UPDATE "LeaveType"
SET "tracksBalance" = false
WHERE "code" IN ('SL', 'UB');

UPDATE "LeaveType"
SET "isPaid" = false, "requiresApproval" = true, "tracksBalance" = false
WHERE "code" = 'UB';
```

- [ ] **Step 3: Validate and generate the Prisma client**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: both commands exit `0`; Prisma reports a valid schema and generates `src/generated/prisma`.

- [ ] **Step 4: Commit the additive data model**

```bash
git add prisma/schema.prisma prisma/migrations/20260729_hr_leave_entitlements/migration.sql
git commit -m "feat(hr): add leave entitlement audit models"
```

### Task 2: Implement And Test Entitlement Calculation

**Files:**

- Create: `src/lib/hr/leave-entitlement.ts`
- Create: `__tests__/unit/hr/leave-entitlement.test.ts`

- [ ] **Step 1: Write failing calculation tests**

Cover 20, 26, custom, fractions, rounding, partial employment year, and effective selection:

```ts
import { describe, expect, it } from 'vitest'
import {
  calculateConfiguredEntitlement,
  selectEffectiveEntitlement,
} from '@/lib/hr/leave-entitlement'

describe('calculateConfiguredEntitlement', () => {
  it.each([
    ['DAYS_20', null, 1, 20],
    ['DAYS_26', null, 1, 26],
    ['CUSTOM', 30, 1, 30],
    ['DAYS_20', null, 0.5, 10],
    ['DAYS_26', null, 0.75, 20],
  ] as const)('calculates %s at fraction %s', (mode, customAnnualDays, fraction, expected) => {
    expect(calculateConfiguredEntitlement({
      mode,
      customAnnualDays,
      employmentFraction: fraction,
      employmentStartDate: new Date('2020-01-01'),
      year: 2026,
    })).toBe(expected)
  })

  it('applies the existing partial-year rule after fraction and rounds up', () => {
    expect(calculateConfiguredEntitlement({
      mode: 'DAYS_26',
      customAnnualDays: null,
      employmentFraction: 0.5,
      employmentStartDate: new Date('2026-07-01'),
      year: 2026,
    })).toBe(7)
  })
})

describe('selectEffectiveEntitlement', () => {
  it('selects the latest configuration effective on the target date', () => {
    const selected = selectEffectiveEntitlement([
      { id: 'old', effectiveFrom: new Date('2025-01-01') },
      { id: 'new', effectiveFrom: new Date('2026-06-01') },
      { id: 'future', effectiveFrom: new Date('2027-01-01') },
    ], new Date('2026-12-31'))

    expect(selected?.id).toBe('new')
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement.test.ts
```

Expected: FAIL because `@/lib/hr/leave-entitlement` does not exist.

- [ ] **Step 3: Implement the pure module**

Export these stable contracts:

```ts
export type LeaveEntitlementMode = 'DAYS_20' | 'DAYS_26' | 'CUSTOM'

export interface LeaveEntitlementInput {
  mode: LeaveEntitlementMode
  customAnnualDays: number | null
  employmentFraction: number
  employmentStartDate: Date
  year: number
}

export function annualDaysForMode(
  mode: LeaveEntitlementMode,
  customAnnualDays: number | null
): number {
  if (mode === 'DAYS_20') return 20
  if (mode === 'DAYS_26') return 26
  if (!Number.isInteger(customAnnualDays) || customAnnualDays! < 1 || customAnnualDays! > 365) {
    throw new Error('Custom annual leave must be an integer from 1 to 365')
  }
  return customAnnualDays!
}

export function calculateConfiguredEntitlement(input: LeaveEntitlementInput): number {
  if (input.employmentFraction <= 0 || input.employmentFraction > 1) {
    throw new Error('Employment fraction must be greater than 0 and no greater than 1')
  }
  const base = Math.ceil(annualDaysForMode(input.mode, input.customAnnualDays) * input.employmentFraction)
  return calcProportionalLeaveDays(input.employmentStartDate, input.year, base)
}

export function selectEffectiveEntitlement<T extends { effectiveFrom: Date }>(
  configs: T[],
  targetDate: Date
): T | null {
  return configs
    .filter((config) => config.effectiveFrom <= targetDate)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
}
```

Import and reuse `calcProportionalLeaveDays` from `src/lib/hr/utils.ts`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the calculation boundary**

```bash
git add src/lib/hr/leave-entitlement.ts __tests__/unit/hr/leave-entitlement.test.ts
git commit -m "feat(hr): calculate configured leave entitlement"
```

### Task 3: Centralize Protected Leave Types And Balance Pools

**Files:**

- Create: `src/lib/hr/leave-type-catalog.ts`
- Modify: `src/lib/hr/leave-balance-policy.ts`
- Modify: `prisma/seed.ts`
- Create: `__tests__/unit/hr/leave-balance-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  resolveLeaveBalancePoolId,
  isOnDemandLeave,
} from '@/lib/hr/leave-balance-policy'

const vl = { id: 'vl', code: 'VL', tracksBalance: true, parentId: null }
const vld = { id: 'vld', code: 'VLD', tracksBalance: true, parentId: 'vl' }

describe('leave balance pool policy', () => {
  it('uses VL as the VLD balance pool', () => {
    expect(resolveLeaveBalancePoolId(vld)).toBe('vl')
  })

  it.each(['SL', 'UB'])('never tracks %s balance', (code) => {
    expect(resolveLeaveBalancePoolId({
      id: code.toLowerCase(),
      code,
      tracksBalance: true,
      parentId: null,
    })).toBeNull()
  })

  it('keeps ordinary tracked types in their own pool', () => {
    expect(resolveLeaveBalancePoolId(vl)).toBe('vl')
  })

  it('recognizes VLD by type even for historical rows with isOnDemand=false', () => {
    expect(isOnDemandLeave(vld, { isOnDemand: false })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-balance-policy.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add the canonical catalog**

Move the leave-type seed definitions out of `prisma/seed.ts` into:

```ts
export const SYSTEM_LEAVE_TYPES = [
  { code: 'VL', name: 'Urlop wypoczynkowy', color: '#3B82F6', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: 26, parentCode: null },
  { code: 'VLD', name: 'Urlop na żądanie', color: '#8B5CF6', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: 4, parentCode: 'VL' },
  { code: 'SL', name: 'Zwolnienie chorobowe', color: '#EF4444', isPaid: true, requiresApproval: false, tracksBalance: false, maxDaysPerYear: null, parentCode: null },
  { code: 'UB', name: 'Urlop bezpłatny', color: '#64748B', isPaid: false, requiresApproval: true, tracksBalance: false, maxDaysPerYear: null, parentCode: null },
  { code: 'RW', name: 'Praca zdalna', color: '#10B981', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'RWO', name: 'Okazjonalna praca zdalna', color: '#6EE7B7', isPaid: true, requiresApproval: false, tracksBalance: true, maxDaysPerYear: 24, parentCode: null },
  { code: 'DEL', name: 'Delegacja', color: '#7C3AED', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'ML', name: 'Urlop macierzyński', color: '#EC4899', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'PL', name: 'Urlop tacierzyński', color: '#F59E0B', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'UO', name: 'Urlop opiekuńczy', color: '#F97316', isPaid: false, requiresApproval: true, tracksBalance: true, maxDaysPerYear: 5, parentCode: null },
  { code: 'OT', name: 'Czas wolny za nadgodziny', color: '#14B8A6', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'FIL', name: 'Opieka nad chorym', color: '#FB923C', isPaid: true, requiresApproval: false, tracksBalance: true, maxDaysPerYear: 2, parentCode: null },
  { code: 'VBL', name: 'Urlop dodatkowy', color: '#60A5FA', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
  { code: 'VSL', name: 'Urlop wolontariacki', color: '#34D399', isPaid: false, requiresApproval: true, tracksBalance: true, maxDaysPerYear: 6, parentCode: null },
  { code: 'ZOW', name: 'Zwolnienie z pracy', color: '#94A3B8', isPaid: true, requiresApproval: true, tracksBalance: true, maxDaysPerYear: null, parentCode: null },
] as const

export const PROTECTED_LEAVE_TYPE_RULES = {
  SL: { tracksBalance: false },
  UB: { isPaid: false, requiresApproval: true, tracksBalance: false, maxDaysPerYear: null },
  VLD: { requiresApproval: true, tracksBalance: true, maxDaysPerYear: 4, parentCode: 'VL' },
} as const
```

Update `prisma/seed.ts` to import `SYSTEM_LEAVE_TYPES` and keep the existing two-pass idempotent upsert.

- [ ] **Step 4: Replace the policy module**

Keep `shouldTrackLeaveBalance` for current callers and add:

```ts
export type BalancePolicyLeaveType = {
  id: string
  code: string
  tracksBalance: boolean
  parentId?: string | null
}

export function resolveLeaveBalancePoolId(
  leaveType: BalancePolicyLeaveType,
  request: LeaveRequestBalancePolicy = {}
): string | null {
  if (request.isRemoteWork || request.isDelegation) return null
  if (leaveType.code === 'SL' || leaveType.code === 'UB') return null
  if (leaveType.code === 'VLD') return leaveType.parentId ?? null
  return leaveType.tracksBalance ? leaveType.id : null
}

export function shouldTrackLeaveBalance(
  leaveType: BalancePolicyLeaveType,
  request: LeaveRequestBalancePolicy = {}
): boolean {
  return resolveLeaveBalancePoolId(leaveType, request) !== null
}

export function isOnDemandLeave(
  leaveType: Pick<BalancePolicyLeaveType, 'code'>,
  request: { isOnDemand?: boolean } = {}
): boolean {
  return leaveType.code === 'VLD' || request.isOnDemand === true
}
```

- [ ] **Step 5: Run focused tests and seed compilation**

Run:

```bash
npm test -- __tests__/unit/hr/leave-balance-policy.test.ts
npx prisma generate
npx tsc --noEmit
```

Expected: all commands pass.

- [ ] **Step 6: Commit the canonical leave policy**

```bash
git add src/lib/hr/leave-type-catalog.ts src/lib/hr/leave-balance-policy.ts prisma/seed.ts __tests__/unit/hr/leave-balance-policy.test.ts
git commit -m "fix(hr): centralize leave balance pool rules"
```

### Task 4: Add ADMIN Entitlement Preview And Apply API

**Files:**

- Modify: `src/lib/hr/schemas.ts`
- Create: `src/app/api/hr/employees/[id]/leave-entitlement/route.ts`
- Create: `__tests__/unit/hr/leave-entitlement-route.test.ts`

- [ ] **Step 1: Add the request schema**

```ts
export const leaveEntitlementSaveSchema = z.object({
  mode: z.enum(['DAYS_20', 'DAYS_26', 'CUSTOM']),
  customAnnualDays: z.number().int().min(1).max(365).nullable().default(null),
  employmentFraction: z.number().gt(0).max(1),
  effectiveFrom: z.coerce.date(),
  note: z.string().max(1000).nullable().optional(),
  year: z.number().int().min(2000).max(2100),
  preview: z.boolean().default(true),
  correctionReason: z.string().trim().min(3).max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'CUSTOM' && data.customAnnualDays === null) {
    ctx.addIssue({ code: 'custom', path: ['customAnnualDays'], message: 'Custom annual days are required' })
  }
})
```

- [ ] **Step 2: Write failing route tests**

Mock Prisma and NextAuth. Cover:

```ts
it('blocks managers from entitlement configuration', async () => {
  mockGetServerSession.mockResolvedValue(session('MANAGER', 'manager-1'))
  const response = await POST(request(validPayload), { params: Promise.resolve({ id: 'employee-1' }) })
  expect(response.status).toBe(403)
})

it('returns the calculated delta without writing in preview mode', async () => {
  mockGetServerSession.mockResolvedValue(session('ADMIN'))
  mockEmployeeFindUnique.mockResolvedValue({
    id: 'employee-1',
    startDate: new Date('2020-01-01'),
  })
  mockLeaveTypeFindUnique.mockResolvedValue({ id: 'vl', code: 'VL' })
  mockBalanceFindUnique.mockResolvedValue({ id: 'balance-1', totalDays: 26, usedDays: 3, pendingDays: 1 })

  const response = await POST(request({ ...validPayload, mode: 'DAYS_20', preview: true }), ctx)
  expect(await response.json()).toMatchObject({
    calculatedDays: 20,
    currentTotalDays: 26,
    deltaDays: -6,
    requiresCorrection: true,
  })
  expect(mockTransaction).not.toHaveBeenCalled()
})

it('requires a correction reason when applying a changed balance', async () => {
  const response = await POST(request({ ...validPayload, preview: false }), ctx)
  expect(response.status).toBe(422)
})
```

- [ ] **Step 3: Run the route test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement-route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 4: Implement GET and POST**

`GET` returns:

```ts
{
  config: latestConfig ?? null,
  calculatedDays: latestConfig ? number : null,
  balance: vlBalance ?? null,
  corrections: correctionHistory,
  needsReview: latestConfig === null,
}
```

`POST` must:

1. require `ADMIN`;
2. load the employee and the `VL` leave type;
3. calculate the year total with `calculateConfiguredEntitlement`;
4. return preview data without writes when `preview=true`;
5. require `correctionReason` when an existing balance total changes;
6. transactionally create the effective config, upsert the VL balance, and create `LeaveBalanceCorrection` when the balance changed;
7. never edit `usedDays`, `pendingDays`, request rows, or existing config rows.

Use this correction payload:

```ts
const before = {
  totalDays: existingBalance?.totalDays ?? 0,
  usedDays: existingBalance?.usedDays ?? 0,
  pendingDays: existingBalance?.pendingDays ?? 0,
  carriedOver: existingBalance?.carriedOver ?? 0,
}
const after = { ...before, totalDays: calculatedDays }

await tx.leaveBalanceCorrection.create({
  data: {
    balanceId: balance.id,
    employeeId,
    leaveTypeId: vl.id,
    year: parsed.data.year,
    reason: parsed.data.correctionReason!,
    actorId: session.user.id,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
  },
})
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the entitlement API**

```bash
git add src/lib/hr/schemas.ts src/app/api/hr/employees/[id]/leave-entitlement/route.ts __tests__/unit/hr/leave-entitlement-route.test.ts
git commit -m "feat(hr): add leave entitlement preview and apply API"
```

### Task 5: Require Audit Reasons For Manual Balance Corrections

**Files:**

- Modify: `src/lib/hr/schemas.ts`
- Modify: `src/app/api/hr/leave-balances/[id]/route.ts`
- Modify: `src/app/api/hr/leave-balances/route.ts`
- Create: `__tests__/unit/hr/leave-balance-correction-route.test.ts`

- [ ] **Step 1: Tighten correction schemas**

Replace the current direct update schema with:

```ts
export const leaveBalanceCorrectionSchema = z.object({
  totalDays: z.number().min(0).optional(),
  usedDays: z.number().min(0).optional(),
  carriedOver: z.number().min(0).optional(),
  reason: z.string().trim().min(3).max(1000),
}).refine(
  (data) => data.totalDays !== undefined || data.usedDays !== undefined || data.carriedOver !== undefined,
  { message: 'At least one balance field is required' }
)
```

- [ ] **Step 2: Write failing route tests**

Cover:

- MANAGER gets `403`;
- missing reason gets `400`;
- ADMIN update creates exactly one correction with serialized before/after state;
- the transaction preserves `pendingDays`.

Core assertion:

```ts
expect(tx.leaveBalanceCorrection.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    balanceId: 'balance-1',
    employeeId: 'employee-1',
    reason: 'Korekta po weryfikacji dokumentów',
    actorId: 'admin-user',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
  }),
})
```

- [ ] **Step 3: Run test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-balance-correction-route.test.ts
```

Expected: FAIL because the route still permits MANAGER and does not audit.

- [ ] **Step 4: Make balance mutations ADMIN-only and transactional**

Update `PATCH /api/hr/leave-balances/[id]` to:

- require ADMIN;
- parse `leaveBalanceCorrectionSchema`;
- load the balance with leave type;
- calculate `before` and `after`;
- update the balance and create the correction in one Prisma transaction;
- return the updated balance.

Update `POST /api/hr/leave-balances` to require ADMIN instead of ADMIN/MANAGER. Leave the GET scope unchanged.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-balance-correction-route.test.ts __tests__/unit/hr/operational-access.test.ts
```

Expected: PASS after updating any old manager-mutation expectation to `403`.

- [ ] **Step 6: Commit audited corrections**

```bash
git add src/lib/hr/schemas.ts src/app/api/hr/leave-balances src/app/api/hr/leave-balances/route.ts __tests__/unit/hr/leave-balance-correction-route.test.ts __tests__/unit/hr/operational-access.test.ts
git commit -m "fix(hr): audit leave balance corrections"
```

### Task 6: Use The Shared VL Pool Through The Full Request Lifecycle

**Files:**

- Modify: `src/app/api/hr/leave-requests/route.ts`
- Modify: `src/app/api/hr/leave-requests/[id]/approve/route.ts`
- Modify: `src/app/api/hr/leave-requests/[id]/reject/route.ts`
- Modify: `src/app/api/hr/leave-requests/[id]/route.ts`
- Modify: `__tests__/unit/hr/leave-requests-route.test.ts`

- [ ] **Step 1: Extend failing request tests**

Add tests that verify:

```ts
it('creates UB without reading or mutating a balance', async () => {
  mockLeaveTypeFindUnique.mockResolvedValue({
    id: 'ub',
    code: 'UB',
    tracksBalance: false,
    parentId: null,
  } as never)
  // submit one working day
  expect(response.status).toBe(201)
  expect(mockBalanceFindUnique).not.toHaveBeenCalled()
  expect(tx.leaveBalanceNew.update).not.toHaveBeenCalled()
})

it('reserves VL balance for VLD and counts requested days, not requests', async () => {
  mockLeaveTypeFindUnique.mockResolvedValue({
    id: 'vld',
    code: 'VLD',
    tracksBalance: true,
    parentId: 'vl',
  } as never)
  mockBalanceFindUnique.mockResolvedValue({
    id: 'vl-balance',
    totalDays: 20,
    usedDays: 3,
    pendingDays: 1,
  } as never)
  mockRequestAggregate.mockResolvedValue({ _sum: { days: 3 } } as never)

  expect(response.status).toBe(201)
  expect(tx.leaveBalanceNew.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'vl-balance' },
    data: { pendingDays: { increment: 1 } },
  }))
})

it('rejects VLD when existing pending and approved VLD days plus requested days exceed four', async () => {
  mockRequestAggregate.mockResolvedValue({ _sum: { days: 4 } } as never)
  expect(response.status).toBe(422)
})
```

Add equivalent approval, rejection, and cancellation tests proving that each route updates the VL balance row for a VLD request.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-requests-route.test.ts
```

Expected: VLD shared-pool and day-sum tests fail.

- [ ] **Step 3: Update POST request creation**

Load `id`, `code`, `tracksBalance`, and `parentId` for the selected type. Derive:

```ts
const balancePoolId = resolveLeaveBalancePoolId(leaveType, {
  isRemoteWork,
  isDelegation,
})
const canonicalOnDemand = isOnDemandLeave(leaveType, { isOnDemand })
```

When `balancePoolId` exists, look up and mutate:

```ts
where: {
  employeeId_leaveTypeId_year: {
    employeeId,
    leaveTypeId: balancePoolId,
    year,
  },
}
```

For VLD limits, aggregate days from both canonical VLD rows and historical `isOnDemand=true` rows:

```ts
const used = await prisma.leaveRequestNew.aggregate({
  where: {
    employeeId,
    status: { notIn: ['cancelled', 'rejected'] },
    startDate: { gte: yearStart, lte: yearEnd },
    OR: [
      { isOnDemand: true },
      { leaveType: { code: 'VLD' } },
    ],
  },
  _sum: { days: true },
})

if ((used._sum.days ?? 0) + days > 4) {
  return NextResponse.json(
    { error: 'Przekroczono limit urlopu na żądanie (maks. 4 dni w roku)' },
    { status: 422 }
  )
}
```

Persist `isOnDemand: canonicalOnDemand`.

- [ ] **Step 4: Update approve, reject, and cancel**

Each lifecycle route must include `id`, `code`, `tracksBalance`, and `parentId` for `leaveType`, call `resolveLeaveBalancePoolId`, load the resolved balance, and mutate by balance `id`. Do not use `leaveRequest.leaveTypeId` as the balance key.

Approval validation uses:

```ts
const available = balance.totalDays - balance.usedDays
```

Then moves request days from pending to used. Rejection and cancellation only decrement pending.

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-requests-route.test.ts
```

Expected: PASS for VL, VLD, SL, and UB.

- [ ] **Step 6: Commit shared-pool request behavior**

```bash
git add src/app/api/hr/leave-requests src/app/api/hr/leave-requests/route.ts __tests__/unit/hr/leave-requests-route.test.ts
git commit -m "fix(hr): make on-demand leave consume vacation balance"
```

### Task 7: Expose Protected Type Behavior And Fix The Request Form

**Files:**

- Modify: `src/app/api/hr/leave-types/route.ts`
- Modify: `src/app/api/hr/leave-types/[id]/route.ts`
- Modify: `src/app/(dashboard)/hr/leave/types/page.tsx`
- Modify: `src/components/hr/leave/leave-request-form.tsx`
- Modify: `__tests__/unit/hr/leave-requests-route.test.ts`

- [ ] **Step 1: Add protected-rule route tests**

Verify:

- UB cannot be changed to paid, non-approval, or balance-tracked;
- SL cannot be changed to balance-tracked;
- VLD keeps parent VL and four-day maximum;
- custom leave types can edit `tracksBalance`.

Expected protected update response: `422` with a Polish explanation naming the protected rule.

- [ ] **Step 2: Enforce protected rules in type routes**

Create one helper in `leave-type-catalog.ts`:

```ts
export interface LeaveTypeBehavior {
  isPaid: boolean
  requiresApproval: boolean
  tracksBalance: boolean
  maxDaysPerYear: number | null
}

export function validateProtectedLeaveTypeUpdate(
  code: string,
  update: Partial<LeaveTypeBehavior>
): string | null {
  const protectedRule = PROTECTED_LEAVE_TYPE_RULES[code as keyof typeof PROTECTED_LEAVE_TYPE_RULES]
  if (!protectedRule) return null
  for (const [key, expected] of Object.entries(protectedRule)) {
    if (key === 'parentCode' || update[key as keyof LeaveTypeBehavior] === undefined) continue
    if (update[key as keyof LeaveTypeBehavior] !== expected) {
      return `Typ ${code} ma chronioną regułę: ${key}`
    }
  }
  return null
}
```

Run this before updating a system type. For VLD, resolve and enforce the VL parent server-side.

- [ ] **Step 3: Add balance tracking to type administration**

Extend the page `LeaveType` interface with `tracksBalance`, add a checkbox/toggle labeled `Pomniejsza saldo`, include it in POST/PATCH, and display a compact `Saldo / Bez salda` status column.

Disable protected behavior toggles for UB, SL, and VLD and show a short tooltip through the native `title` attribute.

- [ ] **Step 4: Make VLD a type choice, not a second checkbox**

In `leave-request-form.tsx`:

- remove the `isOnDemand` checkbox state and UI;
- send `isOnDemand: selectedLeaveType?.code === 'VLD'`;
- for VLD, resolve `selectedBalance` from the parent VL type;
- compute used VLD days by summing `days`, not counting requests;
- show `Pozostało: X z 4 dni` under the VLD option;
- keep `Ten typ nie pomniejsza salda urlopowego` for UB and SL;
- do not show insufficient balance for UB or SL.

Use:

```ts
const selectedBalanceTypeId =
  selectedLeaveType?.code === 'VLD'
    ? allLeaveTypes.find((type) => type.code === 'VL')?.id
    : selectedLeaveType?.id
const selectedBalance = balances.find((balance) => balance.leaveTypeId === selectedBalanceTypeId)
```

- [ ] **Step 5: Run focused route and component tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-requests-route.test.ts __tests__/unit/hr/leave-balance-policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit catalog and form behavior**

```bash
git add src/lib/hr/leave-type-catalog.ts src/app/api/hr/leave-types 'src/app/(dashboard)/hr/leave/types/page.tsx' src/components/hr/leave/leave-request-form.tsx __tests__/unit/hr/leave-requests-route.test.ts
git commit -m "feat(hr): expose leave balance behavior"
```

### Task 8: Add The Employee Entitlement Panel And Audited Manual Editing

**Files:**

- Create: `src/components/hr/employees/leave-entitlement-panel.tsx`
- Modify: `src/components/hr/employees/leave-tab-client.tsx`
- Modify: `src/app/(dashboard)/hr/employees/[id]/page.tsx`
- Create: `__tests__/unit/hr/leave-entitlement-panel.test.tsx`

- [ ] **Step 1: Write failing panel tests**

Mock `fetch` and render the panel. Cover:

```ts
it('marks employees without a config as requiring review', () => {
  render(<LeaveEntitlementPanel employeeId="employee-1" initialData={{
    config: null,
    calculatedDays: null,
    balance: { totalDays: 26, usedDays: 3, pendingDays: 1 },
    corrections: [],
    needsReview: true,
  }} />)
  expect(screen.getByText('Do weryfikacji')).toBeTruthy()
})

it('previews a changed total before enabling apply', async () => {
  // Select 20 days and submit preview.
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/hr/employees/employee-1/leave-entitlement',
    expect.objectContaining({ method: 'POST' })
  )
  expect(await screen.findByText(/Zmiana salda: -6 dni/)).toBeTruthy()
  expect(screen.getByLabelText('Powód korekty')).toBeTruthy()
})
```

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement-panel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the ADMIN panel**

The component receives server-loaded initial data and renders:

- active `20 / 26 / Własny` segmented control;
- employment fraction numeric input with `0.01` step and `0 < value <= 1`;
- effective date;
- optional note;
- calculated annual result;
- current balance summary;
- `Do weryfikacji` status when no config exists;
- correction history with date, reason, and before/after total;
- preview before apply;
- required reason only when preview reports `requiresCorrection=true`.

Use Lucide `Calculator`, `History`, and `Save` icons. Keep the panel unframed inside the existing Urlopy tab; do not nest it inside another card.

- [ ] **Step 4: Integrate the panel and remove manager balance mutation**

In the employee page:

- fetch configs and corrections only when `isAdmin`;
- pass them to `LeaveEntitlementPanel`;
- set `canEditBalance={isAdmin}` on `LeaveTabClient`;
- keep managers able to view balances and requests but not edit them.

In `LeaveTabClient`:

- rename `canEdit` to `canEditBalance`;
- require a correction reason in the existing edit modal;
- send `{ totalDays, reason }`;
- remove the MANAGER-facing add/edit controls.

- [ ] **Step 5: Run component and access tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement-panel.test.tsx __tests__/unit/hr/operational-access.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the employee-profile UI**

```bash
git add src/components/hr/employees/leave-entitlement-panel.tsx src/components/hr/employees/leave-tab-client.tsx 'src/app/(dashboard)/hr/employees/[id]/page.tsx' __tests__/unit/hr/leave-entitlement-panel.test.tsx
git commit -m "feat(hr): manage leave entitlement on employee profile"
```

### Task 9: Stop Blanket 26-Day Initialization And Make Carryover Config-Aware

**Files:**

- Modify: `src/app/api/hr/employees/route.ts`
- Modify: `src/app/api/hr/leave-balances/carryover/route.ts`
- Create: `__tests__/unit/hr/employee-leave-initialization-route.test.ts`
- Modify: `__tests__/unit/hr/operational-access.test.ts`

- [ ] **Step 1: Write failing employee-creation test**

```ts
it('does not create blanket 26-day balances for a new employee', async () => {
  mockGetServerSession.mockResolvedValue(session('ADMIN'))
  mockEmployeeCreate.mockResolvedValue({ id: 'employee-new' } as never)

  const response = await POST(request(validEmployeePayload))

  expect(response.status).toBe(201)
  expect(mockLeaveTypeFindMany).not.toHaveBeenCalled()
  expect(mockBalanceCreateMany).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/employee-leave-initialization-route.test.ts
```

Expected: FAIL because the route currently initializes 26 days for most employment types.

- [ ] **Step 3: Remove automatic blanket balances**

Delete the `annualDays` block from `POST /api/hr/employees`. Return the created employee unchanged. New employees will show `Do weryfikacji` until ADMIN saves entitlement.

- [ ] **Step 4: Make annual carryover use configured VL entitlement**

Update carryover behavior:

- process only the VL balance pool;
- resolve the effective employee config for `toYear`;
- skip employees without configuration and include them in `needsReview`;
- calculate new annual base with `calculateConfiguredEntitlement`;
- calculate carryover from `totalDays - usedDays - pendingDays`;
- set target `totalDays = annualBase + carriedOver`;
- record `carriedOver` separately;
- create a correction audit if an existing target balance changes;
- require ADMIN and a non-empty carryover reason.

Return:

```ts
{
  processed: number,
  created: number,
  updated: number,
  skipped: number,
  needsReview: Array<{ employeeId: string; employeeName: string }>,
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- __tests__/unit/hr/employee-leave-initialization-route.test.ts __tests__/unit/hr/operational-access.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit initialization and rollover behavior**

```bash
git add src/app/api/hr/employees/route.ts src/app/api/hr/leave-balances/carryover/route.ts __tests__/unit/hr/employee-leave-initialization-route.test.ts __tests__/unit/hr/operational-access.test.ts
git commit -m "fix(hr): require explicit vacation entitlement"
```

### Task 10: Add A Read-Only Migration Audit And Complete Verification

**Files:**

- Create: `scripts/audit-hr-leave-migration.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement the read-only audit script**

The script must never mutate data. It prints:

```ts
const report = {
  employees: await prisma.employee.count({ where: { active: true } }),
  employeesWithConfig: await prisma.employee.count({
    where: { active: true, leaveEntitlementConfigs: { some: {} } },
  }),
  vacationBalances: await prisma.leaveBalanceNew.count({
    where: { leaveType: { code: 'VL' } },
  }),
  vldBalancesIgnoredByNewPolicy: await prisma.leaveBalanceNew.count({
    where: { leaveType: { code: 'VLD' } },
  }),
  existingRequests: await prisma.leaveRequestNew.count(),
  existingVldRequests: await prisma.leaveRequestNew.count({
    where: { OR: [{ isOnDemand: true }, { leaveType: { code: 'VLD' } }] },
  }),
}

console.log(JSON.stringify(report, null, 2))
```

Add:

```json
"audit:hr-leave-migration": "node --preserve-symlinks --import tsx scripts/audit-hr-leave-migration.ts"
```

- [ ] **Step 2: Run focused HR tests**

Run:

```bash
npm test -- __tests__/unit/hr/leave-entitlement.test.ts __tests__/unit/hr/leave-balance-policy.test.ts __tests__/unit/hr/leave-entitlement-route.test.ts __tests__/unit/hr/leave-balance-correction-route.test.ts __tests__/unit/hr/leave-entitlement-panel.test.tsx __tests__/unit/hr/leave-requests-route.test.ts __tests__/unit/hr/employee-leave-initialization-route.test.ts __tests__/unit/hr/operational-access.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the complete unit suite and production build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and Next.js production build exits `0`.

- [ ] **Step 4: Run the migration audit against the local database**

Run:

```bash
npm run audit:hr-leave-migration
```

Expected: valid JSON counts; no database rows change. Save the output in the deployment handoff, not in Git.

- [ ] **Step 5: Run the Impeccable UI detector once**

Run only after the UI is finished:

```bash
node /Users/piotr/.agents/skills/impeccable/scripts/detect.mjs --json src/components/hr/employees/leave-entitlement-panel.tsx src/components/hr/employees/leave-tab-client.tsx 'src/app/(dashboard)/hr/leave/types/page.tsx' src/components/hr/leave/leave-request-form.tsx
```

Expected: review every high-confidence finding; fix real overlap, text-fit, control, icon, and nested-card issues before continuing.

- [ ] **Step 6: Perform local browser acceptance**

Using an ADMIN account, verify:

1. an employee with no config shows `Do weryfikacji`;
2. previewing 26 to 20 shows the delta and requires a reason;
3. saving preserves used and pending counts;
4. the correction appears in history;
5. UB can be submitted with zero balance and remains pending;
6. VLD shows the shared VL availability and blocks day 5;
7. MANAGER cannot change entitlement or balances;
8. existing leave requests remain visible.

- [ ] **Step 7: Commit the audit and final verification fixes**

```bash
git add scripts/audit-hr-leave-migration.ts package.json
git commit -m "chore(hr): add leave migration audit"
```

Do not push or deploy until the migration audit output has been reviewed and a database backup has been confirmed.
