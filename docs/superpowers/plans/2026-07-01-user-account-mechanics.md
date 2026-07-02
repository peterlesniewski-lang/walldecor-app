# User Account Mechanics Verification Plan

> **For agentic workers:** this plan has already been implemented in the working tree. Do not re-run it as "implement from scratch"; use it as a verification and closeout checklist.

**Goal:** Switch WallDecor accounts from email login to username login with temporary passwords and forced password changes.

**Architecture:** Keep the existing role model unchanged for now. Add username and password-state fields to `User`, centralize account helper logic, and update auth, admin user management, and password-change flows without solving the broader access matrix in this phase. Forced password state is intentionally refreshed from the database in the NextAuth JWT callback so resets/deactivation affect existing sessions, at the cost of an extra user lookup on authenticated requests.

**Tech Stack:** Next.js App Router, NextAuth credentials provider, Prisma 5 + SQLite, bcryptjs, Vitest, Zod.

---

## Tasks

- [x] Add tested account helpers for username normalization and strong temporary password generation.
- [x] Extend `User` with `username`, `mustChangePassword`, and `passwordChangedAt`.
- [x] Update NextAuth login to use `username` and carry `mustChangePassword` in JWT/session.
- [x] Add `/change-password` page and API route that clears `mustChangePassword`.
- [x] Update admin user management create/reset UI and API to use `username`, show one-time temp passwords, and never send `passwordHash`.
- [x] Update seed/backfill so existing users get usernames and admin login remains possible.
- [x] Add migration coverage for account fields and current KSeF schema changes.
- [x] Extend middleware matcher so forced password changes cover `/knowledge`, `/operations`, `/notifications`, and future dashboard routes, not only `/dashboard`, `/finance`, `/hr`, and `/settings`.
- [x] Update E2E auth spec from email login to username login and add a forced-password-change redirect scenario.
- [x] Run Prisma sync, unit tests, build, and live smoke test.

## Backfill Notes

- Existing users with empty `username` are backfilled from the email local-part.
- Username normalization removes diacritics, punctuation, spaces, and symbols.
- Backfill resolves collisions with numeric suffixes (`jan`, `jan2`, `jan3`).
- Legacy login fallback compares against the normalized email local-part, so `jan.kowalski@...` maps to `jankowalski`.

## Deployment Notes

- Local development was synchronized with `npx prisma db push` — confirmed: `prisma/walldecor.db` has the new columns.
- `npx prisma generate` was **not** actually run before this task was first marked done: the shipped `src/generated/prisma/index.d.ts` / `index.js` (what `@/generated/prisma` resolves to) was still missing `username`/`mustChangePassword`/`passwordChangedAt`, which breaks TypeScript checking during `next build`. Verified during review — running `npx prisma generate` fixes it, and `npm run build` / `npm test` pass cleanly afterward. **Re-run `npx prisma generate` on any fresh checkout or CI runner before building.**
- `src/generated/prisma/` also contains orphaned files from an earlier generator layout (`models/`, `client.ts`, `browser.ts`, `commonInputTypes.ts`, `internal/`) that the current generator no longer produces and the app doesn't import (entry point is `index.d.ts`/`index.js`). Gitignored, so harmless, but safe to delete for clarity: `rm -rf src/generated/prisma && npx prisma generate`.
- This branch includes a SQL migration for the new account fields and KSeF tables. If production continues using the current project convention of `prisma db push --accept-data-loss`, adding nullable `username` is safe; still run seed/backfill or rely on the legacy login fallback before requiring users to sign in by username.
- `npm test` and `npm run build` were verified clean (after the `prisma generate` fix above). The new Playwright scenario in `e2e/auth.spec.ts` (`redirects protected app pages to password change when required`) has **not** been executed live — run `npm run test:e2e` against a running dev server before considering this shipped.
