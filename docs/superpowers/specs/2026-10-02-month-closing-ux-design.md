# Month Closing UX Redesign

## Context

The "Wykonania" module (`/operations/runs`, `src/components/operations/*`) is used by the owner once a month to run the "Księgowość – koniec miesiąca" checklist (13 tasks, see `MONTH_END_TEMPLATE_ITEMS` in `prisma/seed.ts`). Each month the owner has to re-learn how to use it.

Pain points, confirmed with the owner and in code:

1. **Starting a month is hidden.** The only entry point is Operacje → Szablony → template → "Uruchom zamknięcie miesiąca". The runs list has no start action.
2. **Navigation and naming.** "Centrum", "Procedury", "Szablony", "Wykonania" do not say what each screen is for. "Szablony" is not even in the sidebar.
3. **A run can never be finished from the UI.** `PATCH /api/operations/runs/[id]` accepts `status: closed`, but nothing calls it, so 13/13 runs stay "Otwarte".
4. **The task list lives in a template** that has to be created and maintained elsewhere, instead of on the month being worked on.
5. **Three clicks to tick a task:** select the row, then click the status in the right-hand panel.

Scope: the module is used for **one process only**, month-end closing. The generic multi-process framing from `2026-05-18-operations-playbook-design.md` is not extended here.

## Decisions

- Keep the current structure (runs list + run detail with right-hand panel). Fix what blocks the owner; no wizard, no single-page redesign.
- The task list **lives on the run**. A new month is a copy of the previous run.
- **No close blocking.** "Zamknij miesiąc" always works; "Gotowe do zamknięcia" is only a hint.
- A task added on a run has a per-task **"Powtarzaj co miesiąc"** switch, on by default. Off = one-off task.
- Reordering is by **drag and drop** (`@dnd-kit/sortable`, already a dependency, see `src/components/shared/sortable-row.tsx`).
- Sidebar label **"Wykonania" → "Zamknięcie miesiąca"**; "Centrum" removed; route `/operations/runs` unchanged.
- A closed run is **read-only** except "Otwórz ponownie".

## Design

### 1. Runs list (`/operations/runs`)

- Header button **"+ Rozpocznij miesiąc"** (ADMIN, MANAGER). Month defaults to the previous month (`getPreviousMonthPeriod`). The template is chosen automatically: the template of the most recent run, or, if there are no runs yet, the first active template.
- If no run exists for the previous month, a yellow banner shows at the top: "<miesiąc rok> nie ma jeszcze zamknięcia" with a button "Rozpocznij zamknięcie: <miesiąc rok>".
- Duplicate guard: if a run for the same template and period exists, the server returns 409 with the existing run's `runId` in the body and the UI redirects straight to that run (`router.push`) instead of creating a second one.
- Sections: **"Do zrobienia"** (status `open`) and **"Zamknięte"** (status `closed`, visually muted, below).
- Status labels: `open` → **"W toku"** (was "Otwarte"), `closed` → "Zamknięte". Derived hint **"Gotowe do zamknięcia"** when an open run has all tasks `done` (computed, not stored).
- Open-run cards show a line "Następne: <title of first task not done>".
- A card that is ready to close shows a "Zamknij miesiąc" button.

### 2. Run detail (`/operations/runs/[id]`)

- Header: run name, status badge, progress, **"Zamknij miesiąc"** button (always enabled for open runs). Closed runs show **"Otwórz ponownie"** instead.
- Each checklist row gets a **checkbox**: one click toggles `todo` ↔ `done`. The other statuses (W toku, Bloker) and the note stay in the right-hand panel, which opens on click of the task title, as today.
- ADMIN and MANAGER can edit the list on an open run:
  - **"+ Dodaj zadanie"** form: title (required), description, linked procedure (optional), **"Powtarzaj co miesiąc"** switch (default on).
  - Row menu **⋯**: Edytuj, Usuń.
  - **Drag handle ⠿** on each row to reorder.
  - Icon **↻** shows that the task repeats; a "tylko ten miesiąc" badge marks one-off tasks.
- Edits apply to this run and, via the copy, to following months. Already closed runs are never changed.
- A task owner (non-manager) can still change only the status and note of their own tasks, as today.
- Closed run: no add / edit / delete / drag; task statuses are read-only.

### 3. Where the task list comes from

- New field `ChecklistRunItem.recurring Boolean @default(true)`. Existing items get `true`.
- Starting a run copies the items of the **most recent run of the same template** (by `periodYear`, `periodMonth`, `createdAt`) where `recurring = true`. In the copy: `status = todo`, `note = null`, `completedAt/completedById = null`; title, description, order, procedure and owner are kept, order is renumbered 1..n.
- If the template has no previous run, items are copied from the template items (current behavior, `createRunItemInputs`).
- Templates stay in the database and keep working at `/operations/templates`, but are removed from the sidebar and from the hub. Nothing is deleted.

### 4. Navigation

- Sidebar group "Operacje": remove **Centrum**; rename **Wykonania** to **Zamknięcie miesiąca**; keep **Procedury**.
- `/operations` redirects to `/operations/runs`.
- Page title: "Zamknięcie miesiąca", subtitle: "Checklista dla księgowości — co miesiąc".

### 5. API

| Endpoint | Change |
|---|---|
| `POST /api/operations/runs` | Copy from previous run (section 3); 409 on duplicate template + period. |
| `PATCH /api/operations/runs/[id]` | No validation of task completion when setting `closed`. Reopening (`open`) allowed. |
| `POST /api/operations/runs/[id]/items` | New. Add a task (ADMIN, MANAGER; run must be `open`). Appends at the end. |
| `PATCH /api/operations/runs/[id]/items/[itemId]` | Existing; additionally accepts `title`, `description`, `procedureId`, `recurring` for ADMIN, MANAGER. Status/note rules unchanged. Rejects edits on closed runs. |
| `DELETE /api/operations/runs/[id]/items/[itemId]` | New. ADMIN, MANAGER; run must be `open`; renumbers the rest. |
| `PUT /api/operations/runs/[id]/items/order` | New. Body: ordered list of item ids; renumbers in one transaction. ADMIN, MANAGER; run must be `open`. |

Constraint: `ChecklistRunItem` has `@@unique([runId, order])`, so delete and reorder renumber inside one transaction (move orders out of range first, then assign final values).

All route handlers use `{ params }: { params: Promise<...> }` and Zod validation (`src/lib/validations/operations.ts`).

### 6. Out of scope

- Assigning owners to tasks (existing behavior stays).
- Editing templates (existing pages stay as they are).
- Multiple processes / other checklists.
- Editing closed runs.

## Testing

Per `.claude/rules/testing.md`.

- **Unit (Vitest)**
  - Build items from the previous run: only `recurring`, status/note reset, renumbering, fallback to template when there is no previous run.
  - `isReadyToClose`: 0 tasks, some done, all done.
  - Reorder / renumber helper.
  - Previous-month period across year boundary (December → January).
  - Zod schemas for new and changed payloads.
- **Integration**
  - Items POST / PATCH / DELETE / order: ADMIN and MANAGER succeed, EMPLOYEE gets 403, closed run is rejected.
  - Run POST: duplicate period returns 409; copy honors `recurring`.
  - Close and reopen a run, including closing with unfinished tasks.
- **E2E (Playwright)**: start month → tick a task → add a one-off task → drag to reorder → close the month → next month does not contain the one-off task.

## Migration

- The repo ships SQL migrations in `prisma/migrations/` and `docker-entrypoint.sh` runs `prisma migrate deploy`, so the change is a new migration `20261002090000_run_item_recurring` with `ALTER TABLE "ChecklistRunItem" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT true;`. The default backfills existing rows with `true`. Update `architecture.md` with the new field.
- The duplicate-run guard (409) is enforced in application code inside a transaction, not with a unique index: `periodMonth` is nullable and existing production data may already contain duplicates that would make a new unique index fail to apply.
