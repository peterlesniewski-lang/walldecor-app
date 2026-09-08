# KSeF Compact Tags and Issue Dates Implementation Plan

> **For agentic workers:** Execute inline using executing-plans and test-driven-development. The user approved implementation and production deployment in this task.

**Goal:** Compact invoice tags and server-side issue-date filtering without changing classification semantics.

**Architecture:** Wrap the existing tag editor with a collapsed summary; keep classification ownership in KsefInboxView. Add validated date boundaries to the existing list API so list, pagination and monetary totals use the same Prisma predicate. Month selection only fills the two date fields.

**Tech Stack:** Next.js 16, React, Zod, Prisma/SQLite, Vitest, Playwright.

## Tasks

- [x] Add failing real-database list tests in `__tests__/unit/finance/ksef-date-filter.test.ts`: September boundaries including final-day timestamp; adjacent months excluded; one-sided range; amounts/count/pagination; invalid dates and reversed range return 400.
- [x] Run `npm test -- __tests__/unit/finance/ksef-date-filter.test.ts` and confirm assertions fail because dates are currently ignored.
- [x] Extend `src/lib/validations/ksef-inbox.ts` with optional valid ISO date fields and ordering refinement. Extend `src/app/api/finance/ksef/invoices/route.ts` with query parsing and a common issueDate gte/lte predicate. Run the test again.
- [x] Add UI tests in `__tests__/unit/finance/ksef-inbox-view.test.tsx` for collapsed tags, edit/close/draft persistence, approved rows, month filling date boundaries, custom date range, clearing and sorting preservation. Cover leap/non-leap February, April and December through the month control. Run tests and confirm feature failures.
- [x] Add `src/components/shared/ksef-invoice-tags.tsx` for labels and lazy editor; wire to existing classification/save flow. Add `src/lib/finance/ksef-date-filter.ts` for deterministic UTC month bounds. Add date controls to the inbox filter form, validation before applying and query propagation.
- [x] Run all finance tests, ESLint on changed files, and `npm run build -- --webpack`.
- [x] Extend `scripts/validate-ksef-bulk-payments.mjs` with fixtures spanning months and tags. Verify real browser date filtering, boundaries, date clearing, compact tags/edit/save/readback, existing bulk payments and desktop/mobile screenshots.
- [ ] Review diff for accidental API semantics changes or migrations. Commit, push and merge PR only after verification; preserve unrelated checkout files.
- [ ] Follow coolify-deploy: verify live identity/current commit, backup and integrity, deploy, await finished/healthy, verify authenticated production UI with read-only filtering and tag expansion. Record resource IDs and deployed version; do not edit real invoice tags or payments during verification.

## Essential assertions

```ts
expect(response.status).toBe(400) // issueDateFrom > issueDateTo
expect(body.total).toBe(52) // date filter applied before pageSize=50
expect(body.invoices).toHaveLength(50)
expect(body.grossAmountTotal).toBe(520) // all 52 matching rows, not only the page
expect(within(table).queryByRole('button', { name: 'contractors' })).toBeNull()
await user.click(within(table).getByRole('button', { name: 'Edytuj tagi' }))
expect(within(table).getByRole('button', { name: 'contractors' })).toBeTruthy()
```

Rollback: redeploy the previous verified commit preserving the current database. No schema migration or automatic database restore is part of this change.

## Review correction

The independent review identified a race between pending filter requests and sorting/navigation. Added a loading guard on the root fieldset for all requests and saves, with `finally` release after success/failure. Both orderings (filter then sort; sort then filter) have delayed-response regression tests: red before the fix, green after. Finance suite: 169 passing tests in 28 files.
