# HR Module Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the known production gaps in the HR module: privacy, stale placeholder routes, monthly reporting flow clarity, tests, and status documentation.

**Architecture:** Add a small HR access boundary that all employee-facing API/pages can share. Keep salary/contract data admin-only, scope employee visibility by role, redirect stale pages to active routes, and validate with focused regression tests plus full build.

**Tech Stack:** Next.js App Router, NextAuth session roles, Prisma SQLite, Vitest unit tests.

---

### Task 1: HR Access Boundary

**Files:**
- Create: `src/lib/hr/access.ts`
- Test: `__tests__/unit/hr/access.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these behaviors:
- ADMIN can view all employees and confidential employee data.
- EMPLOYEE can view only their own employee profile and no confidential relations.
- MANAGER can view employees in the same division when linked to an employee profile.
- MANAGER without a linked employee profile cannot see all employee data by accident.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- __tests__/unit/hr/access.test.ts`
Expected: fail because `src/lib/hr/access.ts` does not exist yet.

- [ ] **Step 3: Implement access helpers**

Add helpers for:
- `canViewConfidentialHrData(role)`
- `getScopedEmployeeWhere(session)`
- `canViewEmployeeRecord(session, employee)`

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- __tests__/unit/hr/access.test.ts`
Expected: pass.

### Task 2: Harden Employee API and Pages

**Files:**
- Modify: `src/app/api/hr/employees/route.ts`
- Modify: `src/app/api/hr/employees/[id]/route.ts`
- Modify: `src/app/(dashboard)/hr/employees/page.tsx`
- Modify: `src/app/(dashboard)/hr/employees/[id]/page.tsx`
- Test: `__tests__/unit/hr/employees-access-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover these behaviors:
- non-admin GET `/api/hr/employees/[id]` does not include `contracts`, `additionalContracts`, or `salaryHistory`.
- employee cannot fetch another employee profile.
- admin can still fetch confidential relations.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- __tests__/unit/hr/employees-access-route.test.ts`
Expected: fail because current route returns confidential relations to every logged-in user.

- [ ] **Step 3: Implement API hardening**

Use `src/lib/hr/access.ts` to scope list/detail queries and only include confidential relations for ADMIN.

- [ ] **Step 4: Harden server pages**

Make employee list/detail pages use the same policy:
- EMPLOYEE list redirects to own profile or shows a linked-profile warning.
- EMPLOYEE cannot open another employee profile.
- MANAGER without scope does not get unrestricted access.
- ADMIN remains unchanged.

- [ ] **Step 5: Re-run focused tests**

Run: `npm test -- __tests__/unit/hr/access.test.ts __tests__/unit/hr/employees-access-route.test.ts`
Expected: pass.

### Task 3: Replace Stale Placeholder Routes

**Files:**
- Modify: `src/app/(dashboard)/hr/page.tsx`
- Modify: `src/app/(dashboard)/hr/leaves/page.tsx`
- Modify: `src/app/(dashboard)/hr/timesheets/page.tsx`

- [ ] **Step 1: Replace stale text with redirects**

Redirect:
- `/hr` -> `/hr/employees`
- `/hr/leaves` -> `/hr/leave`
- `/hr/timesheets` -> `/hr/time-tracking`

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: routes compile and old placeholder text is no longer rendered.

### Task 4: Monthly HR Reporting Flow Check

**Files:**
- Inspect: `src/components/hr/time-tracking/reports-dashboard.tsx`
- Inspect: `src/app/api/hr/reports/monthly-pdf/route.ts`
- Modify docs if needed: `project_status.md`

- [ ] **Step 1: Confirm report flow**

Verify that monthly reporting has:
- timecard CSV
- attendance CSV
- overtime CSV
- plan-vs-actual CSV
- monthly PDF generation

- [ ] **Step 2: Document limits**

Record that automatic email/cron and employee document vault are not part of the completed M6-M8 module and require separate data model and storage decisions.

### Task 5: Verification and Commit

**Files:**
- Modify: `project_status.md`

- [ ] **Step 1: Run focused HR tests**

Run: `npm test -- __tests__/unit/hr`
Expected: all HR tests pass.

- [ ] **Step 2: Run full unit suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit and push**

Commit message: `Complete HR module hardening`

Run:
- `git add ...`
- `git commit -m "Complete HR module hardening"`
- `git push`
