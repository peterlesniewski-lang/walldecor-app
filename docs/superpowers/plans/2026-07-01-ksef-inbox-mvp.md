# KSeF Inbox MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable KSeF Inbox MVP for WallDecor finance: settings, manual invoice intake, supplier rules, classification, and approval into monthly actual costs.

**Architecture:** Keep external KSeF API synchronization out of today's scope. Store invoices and rules in Prisma, expose small dashboard API routes, and keep business rules in tested pure TypeScript helpers so approval behavior is stable.

**Tech Stack:** Next.js App Router, Prisma 5 + SQLite, Vitest, Zod, React Server Components and small client components.

---

## File Structure

- Modify: `prisma/schema.prisma` - add `KsefInvoice` and `KsefSupplierRule`.
- Create: `__tests__/unit/finance/ksef-inbox.test.ts` - test normalization, rule matching, invoice validation, and actual-cost conversion.
- Create: `src/lib/finance/ksef-inbox.ts` - pure helpers for KSeF invoice workflow.
- Create: `src/lib/validations/ksef-inbox.ts` - Zod request schemas for invoices, rules, status updates, and approval.
- Create: `src/app/api/finance/ksef/invoices/route.ts` - list/create invoices.
- Create: `src/app/api/finance/ksef/invoices/[id]/route.ts` - update invoice classification/status.
- Create: `src/app/api/finance/ksef/invoices/[id]/approve/route.ts` - approve invoice and upsert `ActualEntry`.
- Create: `src/app/api/finance/ksef/rules/route.ts` - list/create supplier rules.
- Create: `src/components/shared/ksef-inbox-view.tsx` - operational client UI.
- Modify: `src/app/(dashboard)/finance/ksef/page.tsx` - replace placeholder with real data view.
- Modify: `src/app/(dashboard)/finance/page.tsx` - pass pending KSeF count to company health.

## Task 1: Tested KSeF Domain Logic

- [ ] Write failing tests in `__tests__/unit/finance/ksef-inbox.test.ts`:
  - NIP normalization removes separators.
  - invoice create schema rejects missing supplier, invalid date, non-positive amount.
  - rule matching uses normalized supplier NIP first and case-insensitive supplier name fallback.
  - approval converts invoice date to year/month and rounds gross amount to two decimals.
- [ ] Run: `npm test -- __tests__/unit/finance/ksef-inbox.test.ts`
- [ ] Implement `src/lib/finance/ksef-inbox.ts` and `src/lib/validations/ksef-inbox.ts`.
- [ ] Re-run the focused test and then `npm test`.

## Task 2: Prisma Models

- [ ] Add `KsefInvoice` fields: supplier data, invoice number, issue date, gross/net/vat amounts, currency, status, classification fields, source, notes, timestamps, optional `actualEntryId`.
- [ ] Add `KsefSupplierRule` fields: supplier NIP/name pattern, target cost center, subcategory, active flag, timestamps.
- [ ] Run: `npx prisma generate`.
- [ ] Run: `npm test`.

## Task 3: API Routes

- [ ] Implement admin/manager access for KSeF invoice actions.
- [ ] Implement `GET/POST /api/finance/ksef/invoices`.
- [ ] Implement `PATCH /api/finance/ksef/invoices/[id]`.
- [ ] Implement `POST /api/finance/ksef/invoices/[id]/approve`, which creates/updates the month actual cost and marks invoice `APPROVED`.
- [ ] Implement `GET/POST /api/finance/ksef/rules`.
- [ ] Run: `npm test`.

## Task 4: UI

- [ ] Replace placeholder KSeF page with invoice table, add-invoice form, status filter, classification controls, and approve action.
- [ ] Show supplier rules on the same page with a compact add-rule form.
- [ ] Keep labels operational and Polish-language.
- [ ] Pass pending invoice count into `CompanyHealthView`.

## Task 5: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Note existing repo lint debt separately if full lint remains red.
