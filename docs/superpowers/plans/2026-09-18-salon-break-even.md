# Salon break-even implementation plan

**Goal:** Administrator configures one company margin, maintains salon recurring expenses, replaces expected expenses with approved invoice costs, and sees a traceable monthly estimate.

**Architecture:** Additive SQLite migration and isolated break-even services. Existing Revenue remains the source of gross sales; a monthly companion net figure is tied to a gross snapshot to detect stale input. No edits to the HR task or legacy financial totals. ADMIN authorization on every read/write; transactional audit records for changes.

**Tech stack:** Next.js 16, Prisma 5 / SQLite, React 19, Vitest, Playwright.

## Accepted boundaries

- One manually entered company margin, effective from a selected month. Historical settings can be listed, edited and deleted. No per-salon margin.
- Salon expected fixed expense templates: create from an approved invoice allocation or manually, list, edit and archive. Start/end month are explicit.
- Administrator assigns an approved invoice part to a template for its reporting month. Valid actual allocations replace the expectation; unlinking restores it. A part/salon may never be assigned twice. Voided invoices cease replacing expectations.
- A split invoice's proportional net amount must be labelled approximate; an explicit match override can provide the exact allocated net cost.
- Gross sales are read from Przychody. Administrator enters the matching monthly net sales sum, can edit and clear it. Gross changes invalidate that net basis. No guessed VAT rate. Gross target uses only the valid observed gross/net ratio, explicitly as an estimate.
- HR is not available yet: show missing employer costs and provisional targets. Never infer employer cost from salary or silently interpret missing HR as zero.
- Main target net = (selected fixed expected/actual costs + recorded other variable costs) / margin. Also expose fixed-only target. Estimated balance = net revenue * margin - fixed costs - other variable costs. Never subtract goods twice.
- Historical company indicator uses three preceding calendar months and only a complete valid net basis; it is a purchases-based estimate, not actual sold-goods margin and not an automatic setting.
- Goods/cogs are not fixed expenses; one-off and payroll are excluded from recurring classification. Unselected fixed invoices and unclassified costs are visibly incomplete, not silently ignored.
- No production modifications until isolated acceptance and review. This worktree is `/Users/piotr/projekty/ksiegowosc/walldecor-breakeven`, branch `feat/salon-break-even`, base `83d5f80`.

## Parallel ownership

1. Persistence worker: additive schema/migration, validated settings mutations and settings GET, auth and audit tests.
2. Engine worker: shared contract, source eligibility, pure calculation, report GET/sources GET and calculation tests.
3. Interface worker: editable report, settings forms and source picker, loading/errors, responsive CSS, component tests.
4. Main: integration, safe environment, clean-database browser acceptance, reviews, regression/type/build gates and delivery evidence.

No agent may revert another's work. No visible control may be a placeholder. Every write must survive reload and server restart. Sample figures are exclusively synthetic test fixtures.

## Observable acceptance gates

- [x] Anonymous and non-admin callers cannot read or change break-even data.
- [x] Admin creates a margin and sees the same value applied to both salons; a future setting does not change an earlier report; editing/deleting persists.
- [x] Admin creates an expected rent expense; its net value contributes before an invoice is assigned.
- [x] Admin chooses an approved allocated source invoice; expected value is replaced, never added to actual. A repeated identical assignment remains one link; cross-template duplicate assignment is rejected. Unlink restores expected.
- [x] Admin edits and archives a recurring expense; report and persisted records agree.
- [x] Admin enters monthly net revenue corresponding to gross Przychody; ratio produces an estimated gross target. Updating gross invalidates stale net. Clearing net leaves an explicit missing state.
- [x] Report always exposes missing HR, unknown VAT/net, missing margin and incomplete history as applicable.
- [x] Variable/goods/one-off classification, voided documents, corrections, shared invoice allocations and effective month boundaries have meaningful unit tests.
- [x] Clean-database browser flow covers login, create/read/edit/archive/unlink, reload, server restart and access denial. No direct database mutation to make user workflow pass.
- [x] Finance regressions, focused typecheck, production build, and browser acceptance pass. Final review assesses spec first then code quality; fix actionable findings.

## Evidence

Initial unchanged baseline: `npm test -- __tests__/unit/finance/breakeven.test.ts __tests__/unit/finance/realized-costs.test.ts` — 8 tests pass.

## Verification on 2026-09-18

- `npm test -- __tests__/unit/finance`: 44 files, 409 tests passed; `/private/tmp/wd-break-even-finance-final.log`.
- `npm run typecheck:app`: passed.
- `npm run build -- --webpack`: passed, matching the Docker build mode; `/private/tmp/wd-break-even-build.log`.
- Merged current production/main `98f79762871e36f3df03c9cb2cd0143e29548083`, preserving the installation changes.
- Independent spec and code reviews closed findings concerning month serialization, invalid zero net sales, cent-level stale snapshots, editing assignment overrides, and missing historical invoice costs.
- Production context verified: `wallvps`, Root Team, My first project, production, application `pwc0sk0w8cw8k8wkgwokgogk`, `https://app.walldecor.pl`. SQLite and skip-seed checks passed without printing environment values.
- SQLite backup: `/data/backups/breakeven-20260918-gNmkJi/before.db`. Directory mode 700, files mode 600. Rehearsal used a separate `rehearsal.db` in that directory.
- Exact additive migration SHA256: `17c39b452ae1e21649b7bd631c76836cb63473e60102a8849aab7c62a0fb4d62`. Rehearsal passed integrity and foreign-key checks, retained row counts in all existing tables, and created exactly four new tables. Production data was not changed by rehearsal.
- Rollback: redeploy the preceding application commit; additive tables may remain. Do not restore the full backup over subsequent business writes.

Browser acceptance: `node --preserve-symlinks scripts/validate-break-even.mjs --confirm-synthetic-local` — PASS, ten acceptance groups, clean synthetic database, actual production build and server restart. Artifact: `test-results/break-even-1789733002651/report.json`; desktop/mobile screenshots in the same directory. SQLite integrity `ok`, no foreign-key violations, no browser page errors or horizontal mobile overflow. This covered authenticated CRUD, source selection, actual/expected replacement, future-month isolation, stale net rejection and access denial. Failed preliminary harness runs concerned fixture username normalization, select label matching and synchronization of post-save readbacks; no sample records touched production.

Production deployment `k4k0g44ow0gg0gs0ko0k4s4w` finished successfully for commit `fcbdcd297d06db4f6419f1e7498531aa5bf41048`. Public health returned HTTP 200 / ok. Authenticated browser verified the new report, settings, real approved source options, source prefill of salon/net/supplier, and the margin editor. Forms were cancelled without production writes. In the new container: SQLite integrity `ok`, no foreign-key violations, no unfinished migrations, all four configuration tables empty. Production UI visibly shows missing configuration and HR rather than fabricated values.

Final repeated clean-database acceptance: `test-results/break-even-1789733056154/report.json`, PASS 10 groups, including additional mobile salon screenshot. The worktree is retained with artifacts for follow-up.
