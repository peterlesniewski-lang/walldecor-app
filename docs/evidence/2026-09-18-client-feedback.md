# Client-form feedback release — 2026-09-18

## Implemented

- Clear save-product/save-measurement and add-another-work labels.
- Parent-based question indentation in client form, preview and answer history.
- Required-field error marks, accessible descriptions and first-error focus; question and file errors aggregated before submission.
- Submitted answers remain read-only until the existing correction action is chosen.
- Audited, transactional template replacement only before any client link, submission or client file exists. Stale snapshot IDs conflict rather than overwrite.
- New links store authenticated AES-256-GCM ciphertext in a nullable column. Editor-only retrieval is no-store, validates order/hash, and supports copying/opening on return. Legacy hash-only links remain valid and cannot be reconstructed.
- Link panel guards concurrent refresh/mutation and clears stale URLs after lost authorization.

## Verification before release

- Installation unit/integration suite: 688/688 passing.
- Follow-up link-panel review and regressions: passed (including RSC refresh, same-timestamp rotation and lost authorization).
- `npm run typecheck:app`: passed.
- `npm run build`: passed.
- Playwright card/client-form/mobile designer: 3/3 passing on isolated fresh SQLite and test-only media/calendar adapters.
- Card screenshots and overflow assertions: 360, 430, 768 and 1280 pixels; edit screenshot recorded by the card scenario.
- Calendar test clock fixed to its fixture date; no Calendar runtime changes.

## Production preflight

- Coolify wallvps, Root Team, localhost server, My first project / production.
- App `pwc0sk0w8cw8k8wkgwokgogk`, app.walldecor.pl; previous commit `83d5f8017c59845762d801b904a4f257726c37dd`.
- Existing production main merged before building; finance changes preserved.
- SQLite quick_check passed, zero unfinished migrations, 8 legacy link rows.
- Backup: `/data/backups/walldecor-before-feedback-20260918.db`; integrity_check passed.
- Migration rehearsal: `/data/backups/walldecor-feedback-migration-check-20260918.db`; additive column succeeded, integrity_check passed, 8 legacy rows preserved.
- Dedicated encryption key configured in Coolify runtime only, build-time false. No secret values recorded here. Preserve the key with infrastructure backups; do not rotate casually.
- Rollback: redeploy the prior application version; additive nullable column may remain. Do not restore the database over new user data.

## Not part of this release

- Answer-specific unusual-condition warnings: require explicit versioned rule configuration; existing question risk levels are not answer triggers. No new planning blocks added.
- Installer delivery/access integration: separate design, no permission expansion.
- Colored builder branches/hover emphasis: not included; this release adds indentation.
- Real uploaded-file preview after submission is not available in the current public projection; UI states this rather than pretending to show a file.

Production rollout result is recorded separately after deployment and public verification.
