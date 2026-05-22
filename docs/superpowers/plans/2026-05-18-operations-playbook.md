# Operations Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first MVP of the Operacje section: reusable operational templates and month-specific checklist runs, seeded with month-end accounting.

**Architecture:** Add a small Operations domain beside the existing Knowledge module. Reuse `Article` records with `type = "procedure"` for how-to content, while storing templates and executions in dedicated Prisma models. Pages use Server Components for shells and focused Client Components for interactive status updates.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 5 + SQLite, Zod, existing shadcn/Tailwind patterns, Vitest.

---

## File Structure

- `prisma/schema.prisma`: add OperationArea, OperationModule, ChecklistTemplate, ChecklistTemplateItem, ChecklistRun, ChecklistRunItem.
- `src/lib/validations/operations.ts`: Zod schemas and role/status constants.
- `src/lib/operations/run-factory.ts`: pure helpers for validating templates and materializing run items.
- `src/lib/operations/queries.ts`: Prisma query helpers for progress summaries and role filtering.
- `src/app/api/operations/runs/route.ts`: list runs and create run from template.
- `src/app/api/operations/runs/[id]/route.ts`: get one run.
- `src/app/api/operations/runs/[id]/items/[itemId]/route.ts`: update run item status/note.
- `src/app/api/operations/templates/route.ts`: list templates.
- `src/app/api/operations/templates/[id]/route.ts`: get one template.
- `src/app/(dashboard)/operations/page.tsx`: landing.
- `src/app/(dashboard)/operations/procedures/page.tsx`: filtered procedure library.
- `src/app/(dashboard)/operations/templates/page.tsx`: template list.
- `src/app/(dashboard)/operations/templates/[id]/page.tsx`: template detail.
- `src/app/(dashboard)/operations/runs/page.tsx`: run list.
- `src/app/(dashboard)/operations/runs/[id]/page.tsx`: run work screen.
- `src/components/operations/*.tsx`: focused UI pieces for cards, run lists, split view, status controls.
- `src/components/shared/sidebar.tsx`: add Operacje nav section.
- `prisma/seed.ts`: seed Finanse, Koniec miesiąca, procedure articles, template, template items.
- `__tests__/unit/operations/run-factory.test.ts`: pure unit tests.

## Tasks

### Task 1: Operations Domain Helpers

- [ ] Write failing tests in `__tests__/unit/operations/run-factory.test.ts`:
  - empty template throws `EMPTY_TEMPLATE`.
  - template item fields are copied into run item input.
  - progress summary counts done, blocked, and total.
- [ ] Run `npm test -- __tests__/unit/operations/run-factory.test.ts`; expect failure because the module does not exist.
- [ ] Create `src/lib/operations/run-factory.ts` with `assertTemplateHasItems`, `createRunItemInputs`, and `calculateRunProgress`.
- [ ] Run the unit test; expect pass.

### Task 2: Prisma Schema

- [ ] Add the six Operations models to `prisma/schema.prisma` with relations and indexes.
- [ ] Run `npx prisma generate`.
- [ ] Run `npm test -- __tests__/unit/operations/run-factory.test.ts`; expect pass.

### Task 3: Validation and API

- [ ] Create `src/lib/validations/operations.ts` with run creation and run item update schemas.
- [ ] Add `src/lib/operations/queries.ts` for run include shapes and progress formatting.
- [ ] Add template list/detail API routes.
- [ ] Add run list/create/detail/update-item API routes.
- [ ] Run `npm run build`; fix type errors before continuing.

### Task 4: Seed First Accounting Module

- [ ] Add seed helpers in `prisma/seed.ts`:
  - upsert OperationArea `finance`.
  - upsert OperationModule `month-end`.
  - upsert operational procedure articles.
  - upsert ChecklistTemplate `Księgowość - koniec miesiąca`.
  - replace template items deterministically for this template.
- [ ] Run `npx prisma generate`.
- [ ] Do not run destructive seed against production data from this task.

### Task 5: UI Shell and Navigation

- [ ] Add Operacje to `src/components/shared/sidebar.tsx`.
- [ ] Create the `/operations` landing page.
- [ ] Create `/operations/procedures`, reusing the `ArticleList` pattern where possible and filtering to `type=procedure`.
- [ ] Create `/operations/templates` and `/operations/templates/[id]`.
- [ ] Create `/operations/runs` and `/operations/runs/[id]`.

### Task 6: Interactive Run Work Screen

- [ ] Create a client component for split-view run execution.
- [ ] Left panel: checklist, status markers, progress.
- [ ] Right panel: selected item details, linked procedure content rendered with `ArticleViewer`, note field, status buttons.
- [ ] Wire status/note updates to `/api/operations/runs/[id]/items/[itemId]`.
- [ ] Run `npm run build`.

### Task 7: Documentation and Verification

- [ ] Update `project_status.md`, `architecture.md`, and project memory with the new module.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start local dev server and smoke test `/operations`.

## Self-Review

Spec coverage:
- Separate Operacje section: covered by Tasks 5 and 7.
- Reuse Encyklopedia components: covered by Tasks 5 and 6.
- Dedicated templates/runs model: covered by Tasks 2 and 3.
- Month-end accounting seed: covered by Task 4.
- Tests: covered by Task 1 and Task 7.

Scope intentionally excludes attachments, reminders, versioning, Google Drive, KSeF integration, and comment threads.
