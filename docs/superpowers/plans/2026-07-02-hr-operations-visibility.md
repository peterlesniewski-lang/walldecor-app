# HR and Operations Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user visibility controls for procedures, checklist templates and checklist runs, then harden HR so employees can manage their own leave/overtime and documents without seeing confidential payroll or other employee data.

**Architecture:** Use one generic visibility grant model for operational content (`procedure`, `template`, `run`) and one separate secure employee document model for HR files. Keep operational grants ADMIN-managed, keep HR payroll/confidential documents ADMIN-only except for the owning employee's own downloadable documents.

**Tech Stack:** Next.js 16 App Router, NextAuth sessions, Prisma SQLite, Vitest, React client components, private local file storage under a non-public directory.

---

## File Structure

- Modify `prisma/schema.prisma`: add `ContentVisibilityGrant`, `EmployeeDocument`, `EmployeeDocumentAuditLog`, and relations from `User`/`Employee`.
- Create `src/lib/operations/visibility.ts`: grant normalization, access predicates, Prisma query helpers.
- Modify `src/lib/wikipedia/actions.ts`: procedure visibility should include public procedures plus per-user grants for employees.
- Modify `src/lib/operations/queries.ts`: templates and runs should be filtered by role and grants; employees should not see ungranted process metadata.
- Create `src/app/api/admin/content-visibility/route.ts`: ADMIN-only list/update grants for procedure/template/run resources.
- Create `src/components/admin/content-visibility-matrix.tsx`: grouped on/off controls for users versus resources.
- Modify `src/app/(dashboard)/settings/page.tsx` or create `src/app/(dashboard)/settings/visibility/page.tsx`: admin panel entry point.
- Modify operations pages/API routes under `src/app/(dashboard)/operations/**` and `src/app/api/operations/**`: pass session user into query helpers and enforce detail access.
- Modify HR pages under `src/app/(dashboard)/hr/**`: enforce role-safe scopes, especially employee list/detail/report pages.
- Create `src/lib/hr/document-access.ts`: ADMIN/owner access checks and document category rules.
- Create `src/app/api/hr/employees/[id]/documents/route.ts`: upload/list documents.
- Create `src/app/api/hr/documents/[id]/download/route.ts`: private download with authorization and audit log.
- Create `src/components/hr/employees/employee-documents-tab.tsx`: employee document UI.
- Create `src/app/api/hr/monthly-report/send/route.ts`: ADMIN-only report generation and send action.
- Add unit tests under `__tests__/unit/operations/` and `__tests__/unit/hr/`.

---

### Task 1: Operational Visibility Data Model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/operations/visibility.ts`
- Test: `__tests__/unit/operations/visibility.test.ts`

- [ ] **Step 1: Add Prisma models**

Add this model and relations. Do not remove account fields from `User`.

```prisma
model User {
  id                 String    @id @default(cuid())
  username           String?   @unique
  email              String    @unique
  name               String
  role               String    @default("EMPLOYEE")
  passwordHash       String
  mustChangePassword Boolean   @default(false)
  passwordChangedAt  DateTime?
  isActive           Boolean   @default(true)
  employeeId         String?   @unique
  employee           Employee? @relation(fields: [employeeId], references: [id])
  createdAt          DateTime  @default(now())

  visibilityGrants        ContentVisibilityGrant[] @relation("VisibilityGrantUser")
  grantedVisibilityGrants ContentVisibilityGrant[] @relation("VisibilityGrantGrantedBy")
  documentAuditLogs       EmployeeDocumentAuditLog[]
}

model ContentVisibilityGrant {
  id           String   @id @default(cuid())
  resourceType String   // procedure | template | run
  resourceId   String
  userId       String
  user         User     @relation("VisibilityGrantUser", fields: [userId], references: [id], onDelete: Cascade)
  grantedById  String?
  grantedBy    User?    @relation("VisibilityGrantGrantedBy", fields: [grantedById], references: [id], onDelete: SetNull)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([resourceType, resourceId, userId])
  @@index([userId, resourceType])
  @@index([resourceType, resourceId])
}
```

- [ ] **Step 2: Generate Prisma client**

Run:

```bash
npx prisma generate
```

Expected: Prisma client generated without removing existing account fields.

- [ ] **Step 3: Add access helper**

Create `src/lib/operations/visibility.ts`:

```ts
import { prisma } from '@/lib/prisma'

export const OPERATION_RESOURCE_TYPES = ['procedure', 'template', 'run'] as const
export type OperationResourceType = (typeof OPERATION_RESOURCE_TYPES)[number]
export type Viewer = { id: string; role?: string | null }

export function canManageOperationVisibility(viewer: Viewer) {
  return viewer.role === 'ADMIN'
}

export function canBypassOperationVisibility(viewer: Viewer) {
  return viewer.role === 'ADMIN' || viewer.role === 'MANAGER'
}

export async function getGrantedResourceIds(viewer: Viewer, resourceType: OperationResourceType) {
  if (canBypassOperationVisibility(viewer)) return null
  const grants = await prisma.contentVisibilityGrant.findMany({
    where: { userId: viewer.id, resourceType },
    select: { resourceId: true },
  })
  return grants.map((grant) => grant.resourceId)
}

export async function hasOperationGrant(viewer: Viewer, resourceType: OperationResourceType, resourceId: string) {
  if (canBypassOperationVisibility(viewer)) return true
  const grant = await prisma.contentVisibilityGrant.findUnique({
    where: { resourceType_resourceId_userId: { resourceType, resourceId, userId: viewer.id } },
    select: { id: true },
  })
  return Boolean(grant)
}
```

- [ ] **Step 4: Test helper semantics**

Create `__tests__/unit/operations/visibility.test.ts` with cases:

```ts
import { describe, expect, it } from 'vitest'
import { canBypassOperationVisibility, canManageOperationVisibility } from '@/lib/operations/visibility'

describe('operation visibility roles', () => {
  it('only lets ADMIN manage grants', () => {
    expect(canManageOperationVisibility({ id: 'a', role: 'ADMIN' })).toBe(true)
    expect(canManageOperationVisibility({ id: 'm', role: 'MANAGER' })).toBe(false)
    expect(canManageOperationVisibility({ id: 'e', role: 'EMPLOYEE' })).toBe(false)
  })

  it('lets ADMIN and MANAGER bypass read filtering', () => {
    expect(canBypassOperationVisibility({ id: 'a', role: 'ADMIN' })).toBe(true)
    expect(canBypassOperationVisibility({ id: 'm', role: 'MANAGER' })).toBe(true)
    expect(canBypassOperationVisibility({ id: 'e', role: 'EMPLOYEE' })).toBe(false)
  })
})
```

Run:

```bash
npm test -- __tests__/unit/operations/visibility.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/operations/visibility.ts __tests__/unit/operations/visibility.test.ts
git commit -m "Add operational visibility grant model"
```

---

### Task 2: Enforce Visibility in Operations and Procedures

**Files:**
- Modify: `src/lib/wikipedia/actions.ts`
- Modify: `src/lib/operations/queries.ts`
- Modify: `src/app/(dashboard)/operations/*.tsx`
- Modify: `src/app/(dashboard)/operations/**/page.tsx`
- Modify: `src/app/api/operations/**/route.ts`
- Test: `__tests__/unit/operations/visibility-queries.test.ts`

- [ ] **Step 1: Pass viewer into query helpers**

Change query signatures:

```ts
type OperationViewer = { id: string; role?: string | null }

export async function getOperationModules(viewer: OperationViewer) {}
export async function getTemplates(viewer: OperationViewer) {}
export async function getTemplate(id: string, viewer: OperationViewer) {}
export async function getRuns(viewer: OperationViewer) {}
export async function getRun(id: string, viewer: OperationViewer) {}
```

- [ ] **Step 2: Filter templates for employees**

Inside `getTemplates(viewer)`:

```ts
const grantedIds = await getGrantedResourceIds(viewer, 'template')
const where = grantedIds === null ? {} : { id: { in: grantedIds } }

return prisma.checklistTemplate.findMany({
  where,
  orderBy: [{ module: { area: { order: 'asc' } } }, { module: { order: 'asc' } }, { name: 'asc' }],
  include: {
    module: { include: { area: true } },
    _count: { select: { items: true, runs: true } },
  },
})
```

- [ ] **Step 3: Filter runs for employees**

Employees can see a run when they have an explicit run grant or own at least one run item:

```ts
const grantedIds = await getGrantedResourceIds(viewer, 'run')
const where =
  grantedIds === null
    ? {}
    : {
        OR: [
          { id: { in: grantedIds } },
          { items: { some: { ownerId: viewer.id } } },
        ],
      }
```

- [ ] **Step 4: Protect detail pages**

`getTemplate(id, viewer)` returns `null` for employees without a template grant. `getRun(id, viewer)` returns `null` for employees without a run grant and without owned items.

- [ ] **Step 5: Extend procedure visibility**

In `getArticles(filters, role, viewerId?)`, employees should see:

```ts
{
  OR: [
    { visibility: 'public' },
    { id: { in: grantedProcedureIds } },
  ],
}
```

Keep ADMIN/MANAGER behavior unchanged.

- [ ] **Step 6: Update callers**

Use:

```ts
const viewer = { id: session.user.id, role: session.user.role }
const templates = await getTemplates(viewer)
const runs = await getRuns(viewer)
const run = await getRun(id, viewer)
```

- [ ] **Step 7: Test**

Add tests that assert:

- EMPLOYEE sees only granted templates.
- EMPLOYEE sees granted runs plus runs where they own an item.
- EMPLOYEE cannot fetch ungranted run detail.
- ADMIN sees all.

Run:

```bash
npm test -- __tests__/unit/operations/visibility-queries.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/wikipedia/actions.ts src/lib/operations/queries.ts src/app src/app/api __tests__/unit/operations/visibility-queries.test.ts
git commit -m "Enforce operational content visibility"
```

---

### Task 3: ADMIN Visibility Matrix UI

**Files:**
- Create: `src/app/api/admin/content-visibility/route.ts`
- Create: `src/components/admin/content-visibility-matrix.tsx`
- Create or modify: `src/app/(dashboard)/settings/visibility/page.tsx`
- Test: `__tests__/unit/operations/content-visibility-route.test.ts`

- [ ] **Step 1: Add ADMIN-only API**

`GET /api/admin/content-visibility?resourceType=procedure|template|run` returns active users, resources, and current grant user IDs.

`PATCH /api/admin/content-visibility` accepts:

```ts
{
  resourceType: 'procedure' | 'template' | 'run',
  resourceId: string,
  userId: string,
  visible: boolean
}
```

When `visible=true`, upsert `ContentVisibilityGrant`. When `visible=false`, delete it.

- [ ] **Step 2: Add toggle UI**

Build one page with tabs:

- `Procedury`
- `Szablony`
- `Wykonania`

Each row is one resource, each user gets an on/off switch. Use icon buttons/switches, not text-only buttons.

- [ ] **Step 3: Preserve global procedure visibility**

For procedures, show the existing global status:

- `Wszyscy` when `visibility='public'`
- `Wybrane osoby` when `visibility='manager'` plus grants

The per-user grant should not overwrite `Article.visibility`; it adds exceptions.

- [ ] **Step 4: Test route**

Tests:

- MANAGER gets `403`.
- ADMIN can grant visibility.
- ADMIN can revoke visibility.
- Invalid `resourceType` returns `400`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/content-visibility src/components/admin/content-visibility-matrix.tsx src/app/'(dashboard)'/settings/visibility __tests__/unit/operations/content-visibility-route.test.ts
git commit -m "Add admin visibility controls"
```

---

### Task 4: HR Access Hardening

**Files:**
- Modify: `src/components/hr/hr-sidebar.tsx`
- Modify: `src/app/(dashboard)/hr/employees/page.tsx`
- Modify: `src/app/(dashboard)/hr/employees/[id]/page.tsx`
- Modify: `src/app/(dashboard)/hr/time-tracking/reports/page.tsx`
- Modify: `src/app/api/hr/reports/**/route.ts`
- Test: `__tests__/unit/hr/hr-access.test.ts`

- [ ] **Step 1: Decide role rules**

Implement these exact rules:

- `ADMIN`: full HR access.
- `MANAGER`: team/operational HR access, no payroll documents, no payslips, no disciplinary documents.
- `EMPLOYEE`: own dashboard, own time tracking, own leave requests, own monthly report, own documents only.

- [ ] **Step 2: Hide global employee list from EMPLOYEE**

In `HrSidebar`, restrict `Lista pracowników` and `Struktura` to `ADMIN`/`MANAGER`. Add a separate `Mój profil` link for employees once a user has `employeeId`.

- [ ] **Step 3: Guard employee detail page**

In `src/app/(dashboard)/hr/employees/[id]/page.tsx`, before fetching all detail data:

```ts
const isOwnProfile = session.user.employeeId === id
const isAdminOrManager = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
if (!isOwnProfile && !isAdminOrManager) redirect('/hr')
```

Do not load confidential tabs for non-admins.

- [ ] **Step 4: Guard report APIs**

For report endpoints:

- ADMIN/MANAGER may request all employees.
- EMPLOYEE must be forced to `session.user.employeeId`; ignore arbitrary `employeeId` query params.
- If no `employeeId`, return `403`.

- [ ] **Step 5: Test**

Tests:

- EMPLOYEE cannot fetch another employee report.
- EMPLOYEE can fetch own monthly PDF.
- MANAGER cannot fetch confidential document APIs from Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/components/hr/hr-sidebar.tsx src/app/'(dashboard)'/hr src/app/api/hr/reports __tests__/unit/hr/hr-access.test.ts
git commit -m "Harden HR employee access"
```

---

### Task 5: Secure Employee Documents

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/hr/document-access.ts`
- Create: `src/app/api/hr/employees/[id]/documents/route.ts`
- Create: `src/app/api/hr/documents/[id]/download/route.ts`
- Create: `src/components/hr/employees/employee-documents-tab.tsx`
- Modify: `src/app/(dashboard)/hr/employees/[id]/page.tsx`
- Test: `__tests__/unit/hr/employee-documents.test.ts`

- [ ] **Step 1: Add document models**

```prisma
model EmployeeDocument {
  id             String   @id @default(cuid())
  employeeId     String
  employee       Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  category       String   // payslip | bonus | warning | contract | other
  title          String
  originalName   String
  mimeType       String
  sizeBytes      Int
  storagePath    String
  visibleToEmployee Boolean @default(true)
  uploadedById   String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  auditLogs      EmployeeDocumentAuditLog[]

  @@index([employeeId])
  @@index([category])
}

model EmployeeDocumentAuditLog {
  id         String   @id @default(cuid())
  documentId String
  document   EmployeeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  actorId    String
  actor      User     @relation(fields: [actorId], references: [id], onDelete: Restrict)
  action     String   // upload | download | update | revoke
  createdAt  DateTime @default(now())

  @@index([documentId])
  @@index([actorId])
}
```

Add `documents EmployeeDocument[]` to `Employee`.

- [ ] **Step 2: Use private storage**

Store files below:

```text
private_uploads/hr-documents/<employeeId>/<documentId>-<safe-name>
```

Never store HR documents in `public/`. The browser downloads only through the authorized API route.

- [ ] **Step 3: Access helper**

Rules:

- ADMIN can upload/list/download all.
- MANAGER cannot access `payslip`, `bonus`, `warning`, `contract` unless later explicitly approved.
- EMPLOYEE can list/download only own documents where `visibleToEmployee=true`.

- [ ] **Step 4: Upload route**

Validate:

- max file size 10 MB
- allowed MIME types: PDF, PNG, JPEG
- category in `payslip | bonus | warning | contract | other`
- `title` length 3-160

- [ ] **Step 5: UI tab**

Add `Dokumenty` tab on employee profile:

- ADMIN: upload button, category, visibility toggle, list all docs.
- EMPLOYEE viewing own profile: list visible docs, download only.
- MANAGER: no payroll/confidential docs.

- [ ] **Step 6: Audit**

Create audit log on every upload and download.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/hr/document-access.ts src/app/api/hr src/components/hr/employees/employee-documents-tab.tsx src/app/'(dashboard)'/hr/employees/'[id]'/page.tsx __tests__/unit/hr/employee-documents.test.ts
git commit -m "Add secure employee documents"
```

---

### Task 6: Monthly HR Report for Payroll Accountant

**Files:**
- Create: `src/lib/hr/monthly-report.ts`
- Create: `src/app/api/hr/monthly-report/send/route.ts`
- Modify: `src/components/hr/time-tracking/reports-dashboard.tsx`
- Test: `__tests__/unit/hr/monthly-report.test.ts`

- [ ] **Step 1: Extract report data builder**

Build one reusable function:

```ts
export async function buildMonthlyPayrollReport(month: string) {
  // returns employees, approved leave, overtime requests, time entries,
  // totals by employee, and generated CSV/PDF payload metadata
}
```

Use the same data sources already used by:

- `src/app/api/hr/reports/export/route.ts`
- `src/app/api/hr/reports/monthly-pdf/route.ts`

- [ ] **Step 2: Add manual send action**

`POST /api/hr/monthly-report/send`:

```ts
{
  month: '2026-07',
  recipientEmail: 'kadry@example.pl',
  includeCsv: true,
  includePdf: true
}
```

ADMIN-only. Store result in an audit table or `AppSetting` history if a dedicated table is not added yet.

- [ ] **Step 3: Add UI button**

In reports dashboard add:

- month picker
- recipient email
- `Generuj`
- `Wyślij do kadrowej`

- [ ] **Step 4: Cron decision**

Do not enable automatic cron until SMTP/recipient settings are confirmed. Build the endpoint so a cron can call it later with an internal secret header.

- [ ] **Step 5: Test**

Tests:

- report includes approved leave days
- report includes approved overtime split into `time_off` and `payment`
- EMPLOYEE cannot send payroll report

- [ ] **Step 6: Commit**

```bash
git add src/lib/hr/monthly-report.ts src/app/api/hr/monthly-report/send src/components/hr/time-tracking/reports-dashboard.tsx __tests__/unit/hr/monthly-report.test.ts
git commit -m "Add monthly HR payroll report action"
```

---

## Verification

After all tasks:

```bash
npx prisma generate
npm test
npm run build
```

Manual smoke:

- ADMIN can toggle visibility for one procedure, one template and one run.
- EMPLOYEE sees only granted procedures/templates/runs and assigned run items.
- EMPLOYEE cannot open another employee profile.
- EMPLOYEE can download own visible payslip.
- MANAGER cannot download payslips or disciplinary documents.
- ADMIN can generate monthly payroll report.
