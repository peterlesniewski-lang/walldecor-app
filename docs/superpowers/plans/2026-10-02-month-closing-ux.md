# Month Closing UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Wykonania" module intuitive for the owner's once-a-month closing ritual: start a month from the runs list, edit the task list on the run itself (copied from the previous month), tick tasks with one click, drag to reorder, close and reopen a month.

**Architecture:** Keep the existing runs list + run detail screens. Add a `recurring` flag on run items; starting a run copies the recurring items of the previous run of the same template (template items are only a fallback for the very first run). Database logic moves into a framework-agnostic service (`run-service.ts`) that is integration-tested against a real SQLite file; route handlers stay thin and are unit-tested with mocks. UI changes are limited to the runs list, the run detail, the sidebar and `/operations`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 5 + SQLite (SQL migrations in `prisma/migrations`, applied by `prisma migrate deploy`), Zod, Tailwind, `@dnd-kit/core` + `@dnd-kit/sortable` (already installed), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-month-closing-ux-design.md`

**Project rules that apply (from `CLAUDE.md`):** route handlers use `{ params }: { params: Promise<...> }` + `await params`; Zod for every payload (use `.nullish()` for clearable fields; never send `""` for enums/ids — send `null`); no `any`; UI strings in Polish, code in English; shared logic in `src/lib`; do **not** push without asking the user.

---

## File Structure

**Create**
- `prisma/migrations/20261002090000_run_item_recurring/migration.sql` — adds `ChecklistRunItem.recurring`.
- `src/lib/operations/run-service.ts` — DB logic: create run (copy from previous), add / delete / reorder items, guards. No `next/*` imports.
- `src/lib/operations/run-http.ts` — maps `RunServiceError` to `NextResponse`.
- `src/app/api/operations/runs/[id]/items/route.ts` — `POST` add task.
- `src/app/api/operations/runs/[id]/items/order/route.ts` — `PUT` reorder.
- `src/components/operations/run-status-button.tsx` — close / reopen button for the list.
- `src/components/operations/start-month-banner.tsx` — yellow "month missing" banner.
- `src/components/operations/run-task-list.tsx` — drag-and-drop checklist (rows, checkbox, ⋯ menu).
- `src/components/operations/run-task-form.tsx` — add / edit task form.
- `__tests__/unit/operations/run-validations.test.ts`
- `__tests__/unit/operations/run-routes.test.ts`
- `__tests__/integration/operations/run-service.test.ts`
- `e2e/operations-month-closing.spec.ts`

**Modify**
- `prisma/schema.prisma` (`ChecklistRunItem`)
- `src/lib/operations/run-factory.ts` + `__tests__/unit/operations/run-factory.test.ts`
- `src/lib/validations/operations.ts`
- `src/app/api/operations/runs/route.ts` (`POST`)
- `src/app/api/operations/runs/[id]/items/[itemId]/route.ts` (`PATCH` extended, `DELETE` added)
- `src/lib/operations/queries.ts` (`getRuns`, new `getDefaultRunTemplateId`, `getProcedureOptions`)
- `src/components/operations/status-badge.tsx`
- `src/components/operations/runs-list.tsx`
- `src/components/operations/start-run-button.tsx`
- `src/components/operations/run-detail-client.tsx` (rewritten)
- `src/app/(dashboard)/operations/runs/page.tsx`
- `src/app/(dashboard)/operations/runs/[id]/page.tsx`
- `src/app/(dashboard)/operations/page.tsx` (becomes a redirect)
- `src/components/shared/sidebar.tsx`
- `architecture.md`, `project_status.md`

## UI strings contract (used by components and the E2E spec — keep identical)

| Where | Text |
|---|---|
| Runs page `h1` | `Zamknięcie miesiąca` |
| Runs page header button | `+ Rozpocznij miesiąc` (popup selects have `aria-label` `Miesiąc` / `Rok`; popup submit `Utwórz wykonanie: <miesiąc rok>`) |
| Banner | heading `<miesiąc rok> nie ma jeszcze zamknięcia`, button `Rozpocznij zamknięcie: <miesiąc rok>` |
| List sections | `Do zrobienia`, `Zamknięte` |
| Status labels | `W toku`, `Gotowe do zamknięcia`, `Zamknięte` |
| Detail buttons | `Zamknij miesiąc`, `Otwórz ponownie`, `+ Dodaj zadanie` |
| Form | headings `Nowe zadanie` / `Edytuj zadanie`; labels `Tytuł zadania`, `Opis (opcjonalnie)`, `Procedura „jak to zrobić” (opcjonalnie)`; switch `aria-label` `Powtarzaj co miesiąc`; buttons `Dodaj` / `Zapisz`, `Anuluj` |
| Row | checkbox `aria-label` `Oznacz jako gotowe: <tytuł>`, drag handle `Przeciągnij zadanie: <tytuł>`, menu `Opcje zadania: <tytuł>`, badge `tylko ten miesiąc`, row `data-testid="run-task-row"` |

---

### Task 0: Environment and baseline

**Files:** none (verification only)

- [ ] **Step 1: Install dependencies and generate the Prisma client**

The worktree starts without `node_modules` and without `src/generated/prisma` (gitignored).

Run:
```bash
npm ci
npx prisma generate
```
Expected: `npm ci` finishes without errors; `prisma generate` prints `Generated Prisma Client`.

- [ ] **Step 2: Run the existing operations tests as a baseline**

Run: `npm test -- __tests__/unit/operations`
Expected: all existing operations tests PASS (run-factory, template-items, visibility, content-visibility-route).

- [ ] **Step 3: Confirm the branch**

Run: `git branch --show-current`
Expected: `improve-module-ux`

---

### Task 1: Schema field and migration

**Files:**
- Modify: `prisma/schema.prisma` (model `ChecklistRunItem`, around line 2250)
- Create: `prisma/migrations/20261002090000_run_item_recurring/migration.sql`

- [ ] **Step 1: Add the field to the Prisma model**

In `prisma/schema.prisma`, inside `model ChecklistRunItem`, add the `recurring` line directly under `note`:

```prisma
  status         String                 @default("todo") // todo | in_progress | blocked | done
  note           String?
  recurring      Boolean                @default(true)
  completedAt    DateTime?
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20261002090000_run_item_recurring/migration.sql`:

```sql
-- Tasks on a month-closing run can be one-off (recurring = false); they are skipped when the next month is copied from this run.
ALTER TABLE "ChecklistRunItem" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Validate the schema and regenerate the client**

Run:
```bash
npx prisma validate
npx prisma generate
```
Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client`.

- [ ] **Step 4: Apply all migrations to a scratch database and check the column**

Run:
```bash
SCRATCH="$(mktemp -d)/check.db"
DATABASE_URL="file:$SCRATCH" npx prisma migrate deploy
sqlite3 "$SCRATCH" "PRAGMA table_info('ChecklistRunItem');" | grep recurring
```
Expected: the last command prints a row ending in `recurring|BOOLEAN|1|true|0` (column exists, NOT NULL, default true).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261002090000_run_item_recurring
git commit -m "feat(operations): add recurring flag to checklist run items"
```

---

### Task 2: Pure logic in `run-factory.ts` (TDD)

**Files:**
- Modify: `src/lib/operations/run-factory.ts`
- Modify: `__tests__/unit/operations/run-factory.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/unit/operations/run-factory.test.ts`, extend the import list and append a new `describe` block at the end of the file.

Replace the import at the top with:

```ts
import { describe, expect, it } from 'vitest'
import {
  assertTemplateHasItems,
  buildRunItemsFromPreviousRun,
  calculateRunProgress,
  createRunItemInputs,
  createRunName,
  findRunForPeriod,
  getNextOpenItem,
  getPreviousMonthPeriod,
  getRunDisplayStatus,
  isPermutationOf,
  isReadyToClose,
} from '@/lib/operations/run-factory'
```

Append at the end of the file:

```ts
describe('month closing helpers', () => {
  const previousItems = [
    { templateItemId: 't3', title: 'Rejestr VAT', description: null, order: 3, procedureId: 'p-vat', ownerId: null, recurring: true },
    { templateItemId: 't1', title: 'Raport z kasy', description: 'Obie lokalizacje', order: 1, procedureId: null, ownerId: 'u1', recurring: true },
    { templateItemId: null, title: 'Faktura od nowego dostawcy', description: null, order: 2, procedureId: null, ownerId: null, recurring: false },
  ]

  it('copies only recurring tasks from the previous run, renumbered from 1', () => {
    const inputs = buildRunItemsFromPreviousRun(previousItems)

    expect(inputs.map((item) => [item.order, item.title])).toEqual([
      [1, 'Raport z kasy'],
      [2, 'Rejestr VAT'],
    ])
  })

  it('resets status when copying a task and keeps owner and procedure', () => {
    const [first] = buildRunItemsFromPreviousRun(previousItems)

    expect(first).toEqual({
      templateItemId: 't1',
      title: 'Raport z kasy',
      description: 'Obie lokalizacje',
      order: 1,
      procedureId: null,
      ownerId: 'u1',
      status: 'todo',
      recurring: true,
    })
  })

  it('returns an empty list when no task of the previous run repeats', () => {
    expect(buildRunItemsFromPreviousRun([{ ...previousItems[0], recurring: false }])).toEqual([])
  })

  it('does not mutate the previous run items', () => {
    const snapshot = JSON.stringify(previousItems)
    buildRunItemsFromPreviousRun(previousItems)
    expect(JSON.stringify(previousItems)).toBe(snapshot)
  })

  it('is not ready to close when the run has no tasks', () => {
    expect(isReadyToClose([])).toBe(false)
  })

  it('is not ready to close when some task is not done', () => {
    expect(isReadyToClose([{ status: 'done' }, { status: 'in_progress' }])).toBe(false)
  })

  it('is ready to close when every task is done', () => {
    expect(isReadyToClose([{ status: 'done' }, { status: 'done' }])).toBe(true)
  })

  it('shows "ready" for an open run with every task done', () => {
    expect(getRunDisplayStatus('open', [{ status: 'done' }])).toBe('ready')
  })

  it('keeps the stored status for a closed run even when every task is done', () => {
    expect(getRunDisplayStatus('closed', [{ status: 'done' }])).toBe('closed')
  })

  it('finds the first task that is not done, by order', () => {
    const next = getNextOpenItem([
      { title: 'C', order: 3, status: 'todo' },
      { title: 'A', order: 1, status: 'done' },
      { title: 'B', order: 2, status: 'blocked' },
    ])

    expect(next?.title).toBe('B')
  })

  it('returns null as next task when everything is done', () => {
    expect(getNextOpenItem([{ title: 'A', order: 1, status: 'done' }])).toBeNull()
  })

  it('finds the run for a template and period', () => {
    const runs = [
      { id: 'a', templateId: 't', periodYear: 2026, periodMonth: 8 },
      { id: 'b', templateId: 't', periodYear: 2026, periodMonth: 9 },
      { id: 'c', templateId: 'other', periodYear: 2026, periodMonth: 9 },
    ]

    expect(findRunForPeriod(runs, 't', { periodYear: 2026, periodMonth: 9 })?.id).toBe('b')
  })

  it('does not find a run for the previous December in January', () => {
    const runs = [{ id: 'a', templateId: 't', periodYear: 2026, periodMonth: 12 }]

    expect(findRunForPeriod(runs, 't', { periodYear: 2025, periodMonth: 12 })).toBeUndefined()
  })

  it('accepts a reordered list of the same ids as a permutation', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true)
  })

  it('rejects an order list with a missing id', () => {
    expect(isPermutationOf(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
  })

  it('rejects an order list with a duplicated id', () => {
    expect(isPermutationOf(['a', 'b'], ['a', 'a'])).toBe(false)
  })

  it('rejects an order list with an unknown id', () => {
    expect(isPermutationOf(['a', 'b'], ['a', 'x'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/unit/operations/run-factory.test.ts`
Expected: FAIL — the new helpers are not exported from `run-factory` (e.g. `buildRunItemsFromPreviousRun is not a function`).

- [ ] **Step 3: Implement the helpers**

In `src/lib/operations/run-factory.ts`:

(a) Replace the `RunItemCreateInput` interface with:

```ts
export interface RunItemCreateInput {
  templateItemId: string | null
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: RunItemStatus
  recurring?: boolean
}
```

(b) Append to the end of the file:

```ts
export interface PreviousRunItem {
  templateItemId: string | null
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  recurring: boolean
}

export function buildRunItemsFromPreviousRun(items: PreviousRunItem[]): RunItemCreateInput[] {
  return items
    .filter((item) => item.recurring)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      templateItemId: item.templateItemId,
      title: item.title,
      description: item.description,
      order: index + 1,
      procedureId: item.procedureId,
      ownerId: item.ownerId,
      status: 'todo' as const,
      recurring: true,
    }))
}

export function isReadyToClose(items: RunItemStatusLike[]) {
  return items.length > 0 && items.every((item) => item.status === 'done')
}

export function getRunDisplayStatus(status: string, items: RunItemStatusLike[]) {
  if (status === 'open' && isReadyToClose(items)) return 'ready'
  return status
}

export function getNextOpenItem<T extends { order: number; status: string }>(items: T[]): T | null {
  const open = items.filter((item) => item.status !== 'done').sort((a, b) => a.order - b.order)
  return open[0] ?? null
}

export function findRunForPeriod<T extends { templateId: string; periodYear: number; periodMonth: number | null }>(
  runs: T[],
  templateId: string,
  period: ClosingPeriod
): T | undefined {
  return runs.find(
    (run) =>
      run.templateId === templateId &&
      run.periodYear === period.periodYear &&
      run.periodMonth === period.periodMonth
  )
}

export function isPermutationOf(current: string[], next: string[]) {
  if (current.length !== next.length) return false
  const expected = new Set(current)
  return new Set(next).size === next.length && next.every((id) => expected.has(id))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/unit/operations/run-factory.test.ts`
Expected: PASS (existing tests and all new helper tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/run-factory.ts __tests__/unit/operations/run-factory.test.ts
git commit -m "feat(operations): add month closing helpers (copy from previous run, ready to close)"
```

---

### Task 3: Zod schemas (TDD)

**Files:**
- Modify: `src/lib/validations/operations.ts`
- Create: `__tests__/unit/operations/run-validations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/unit/operations/run-validations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CreateChecklistRunItemSchema,
  ReorderChecklistRunItemsSchema,
  UpdateChecklistRunItemSchema,
} from '@/lib/validations/operations'

describe('CreateChecklistRunItemSchema', () => {
  it('should default recurring to true', () => {
    const parsed = CreateChecklistRunItemSchema.parse({ title: 'Faktura od dostawcy' })

    expect(parsed.recurring).toBe(true)
  })

  it('should accept null description and null procedure from the form', () => {
    const result = CreateChecklistRunItemSchema.safeParse({
      title: 'Faktura od dostawcy',
      description: null,
      procedureId: null,
      recurring: false,
    })

    expect(result.success).toBe(true)
  })

  it('should trim the title', () => {
    const parsed = CreateChecklistRunItemSchema.parse({ title: '  Faktura od dostawcy  ' })

    expect(parsed.title).toBe('Faktura od dostawcy')
  })

  it('should reject a title shorter than 3 characters', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'ab' }).success).toBe(false)
  })

  it('should reject an empty procedure id', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'Faktura', procedureId: '' }).success).toBe(false)
  })
})

describe('UpdateChecklistRunItemSchema', () => {
  it('should accept switching recurring off', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ recurring: false }).success).toBe(true)
  })

  it('should accept unlinking a procedure with null', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ procedureId: null }).success).toBe(true)
  })

  it('should accept a status-only update as before', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ status: 'done' }).success).toBe(true)
  })

  it('should reject a title shorter than 3 characters', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ title: 'x' }).success).toBe(false)
  })
})

describe('ReorderChecklistRunItemsSchema', () => {
  it('should accept a list of item ids', () => {
    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds: ['a', 'b'] }).success).toBe(true)
  })

  it('should reject an empty list', () => {
    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds: [] }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/unit/operations/run-validations.test.ts`
Expected: FAIL — `CreateChecklistRunItemSchema` / `ReorderChecklistRunItemsSchema` are not exported.

- [ ] **Step 3: Implement the schemas**

In `src/lib/validations/operations.ts` replace the `UpdateChecklistRunItemSchema` block with the following (and add the two new schemas right after it):

```ts
export const UpdateChecklistRunItemSchema = z.object({
  status: z.enum(RUN_ITEM_STATUSES).optional(),
  note: z.string().max(2000).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  title: z.string().min(3).max(200).trim().optional(),
  description: z.string().max(2000).trim().nullish(),
  procedureId: z.string().min(1).nullish(),
  recurring: z.boolean().optional(),
})

// Fields that change the task list itself (ADMIN / MANAGER only), as opposed to status and note.
export const RUN_ITEM_STRUCTURE_FIELDS = ['title', 'description', 'procedureId', 'recurring'] as const

export const CreateChecklistRunItemSchema = z.object({
  title: z.string().min(3).max(200).trim(),
  description: z.string().max(2000).trim().nullish(),
  procedureId: z.string().min(1).nullish(),
  recurring: z.boolean().default(true),
})

export const ReorderChecklistRunItemsSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(200),
})
```

At the bottom of the file, add the inferred types next to the existing ones:

```ts
export type CreateChecklistRunItemInput = z.infer<typeof CreateChecklistRunItemSchema>
export type ReorderChecklistRunItemsInput = z.infer<typeof ReorderChecklistRunItemsSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/unit/operations/run-validations.test.ts`
Expected: PASS (all schema tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/operations.ts __tests__/unit/operations/run-validations.test.ts
git commit -m "feat(operations): validate run task create, edit and reorder payloads"
```

---

### Task 4: Run service with integration tests (TDD)

**Files:**
- Create: `src/lib/operations/run-service.ts`
- Create: `__tests__/integration/operations/run-service.test.ts`

The tests use a throwaway SQLite file created with `prisma db push` (same approach as `__tests__/integration/cashier/ledger.test.ts`), because the `@@unique([runId, order])` behaviour cannot be verified with mocks.

- [ ] **Step 1: Write the failing integration tests**

Create `__tests__/integration/operations/run-service.test.ts`:

```ts
// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  addRunItem,
  createRunFromTemplate,
  deleteRunItem,
  reorderRunItems,
} from '@/lib/operations/run-service'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-operations-test-'))
const url = `file:${path.join(directory, 'operations.db')}`
const db = new PrismaClient({ datasources: { db: { url } } })

beforeAll(async () => {
  const result = spawnSync(
    process.execPath,
    ['--preserve-symlinks', 'node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(`Temporary schema setup failed: ${result.stderr || result.stdout}`)
}, 30_000)

beforeEach(async () => {
  await db.$transaction([
    db.checklistRunItem.deleteMany(),
    db.checklistRun.deleteMany(),
    db.checklistTemplateItem.deleteMany(),
    db.checklistTemplate.deleteMany(),
    db.operationModule.deleteMany(),
    db.operationArea.deleteMany(),
    db.article.deleteMany(),
  ])
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function seedTemplate(titles = ['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT']) {
  await db.operationArea.create({ data: { id: 'area', name: 'Finanse', slug: 'finanse' } })
  await db.operationModule.create({
    data: { id: 'module', areaId: 'area', name: 'Koniec miesiąca', slug: 'koniec-miesiaca' },
  })
  await db.checklistTemplate.create({
    data: {
      id: 'template',
      moduleId: 'module',
      name: 'Księgowość - koniec miesiąca',
      items: { create: titles.map((title, index) => ({ title, order: index + 1 })) },
    },
  })
}

const startInput = (periodMonth: number) => ({
  templateId: 'template',
  periodYear: 2026,
  periodMonth,
  createdById: 'admin',
})

const taskInput = (title: string, recurring = true) => ({
  title,
  description: null,
  procedureId: null,
  recurring,
})

const itemsOf = (runId: string) =>
  db.checklistRunItem.findMany({ where: { runId }, orderBy: { order: 'asc' } })

describe('createRunFromTemplate', () => {
  it('should copy template items when there is no previous run', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, startInput(8))

    expect(run.items.map((item) => item.title)).toEqual(['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT'])
  })

  it('should name the run after the template and period', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, startInput(8))

    expect(run.name).toBe('Księgowość - koniec miesiąca - sierpień 2026')
  })

  it('should copy only recurring tasks from the previous run', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    const [first, second] = august.items
    await db.checklistRunItem.update({ where: { id: second.id }, data: { recurring: false } })
    await db.checklistRunItem.update({ where: { id: first.id }, data: { status: 'done', note: 'Zrobione' } })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items.map((item) => item.title)).toEqual(['Raport z kasy', 'Rejestr VAT'])
  })

  it('should reset status and note on copied tasks', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.update({
      where: { id: august.items[0].id },
      data: { status: 'done', note: 'Zrobione', completedAt: new Date() },
    })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items[0]).toMatchObject({ status: 'todo', note: null, completedAt: null })
  })

  it('should renumber copied tasks from 1', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.update({ where: { id: august.items[0].id }, data: { recurring: false } })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items.map((item) => item.order)).toEqual([1, 2])
  })

  it('should reject a second run for the same template and period', async () => {
    await seedTemplate()
    const first = await createRunFromTemplate(db, startInput(8))

    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({
      code: 'RUN_EXISTS',
      details: { runId: first.id },
    })
  })

  it('should reject starting from a template without items when there is no previous run', async () => {
    await seedTemplate([])

    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({ code: 'EMPTY_TEMPLATE' })
  })

  it('should reject an unknown template', async () => {
    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' })
  })
})

describe('addRunItem', () => {
  it('should append the task at the end of the run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    const item = await addRunItem(db, run.id, taskInput('Faktura od nowego dostawcy', false))

    expect(item).toMatchObject({ order: 4, recurring: false, status: 'todo' })
  })

  it('should reject an unknown procedure', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(
      addRunItem(db, run.id, { ...taskInput('Faktura od dostawcy'), procedureId: 'missing' })
    ).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND' })
  })

  it('should reject adding to a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(addRunItem(db, run.id, taskInput('Faktura od dostawcy'))).rejects.toMatchObject({
      code: 'RUN_CLOSED',
    })
  })
})

describe('deleteRunItem', () => {
  it('should renumber the remaining tasks', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await deleteRunItem(db, run.id, run.items[0].id)

    const remaining = await itemsOf(run.id)
    expect(remaining.map((item) => [item.order, item.title])).toEqual([
      [1, 'Saldo rachunków'],
      [2, 'Rejestr VAT'],
    ])
  })

  it('should reject deleting a task that belongs to another run', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    const september = await createRunFromTemplate(db, startInput(9))

    await expect(deleteRunItem(db, august.id, september.items[0].id)).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    })
  })

  it('should reject deleting from a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(deleteRunItem(db, run.id, run.items[0].id)).rejects.toMatchObject({ code: 'RUN_CLOSED' })
  })
})

describe('reorderRunItems', () => {
  it('should apply the new order despite the unique (run, order) constraint', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    const reversed = [...run.items].reverse().map((item) => item.id)

    await reorderRunItems(db, run.id, reversed)

    const items = await itemsOf(run.id)
    expect(items.map((item) => [item.order, item.title])).toEqual([
      [1, 'Rejestr VAT'],
      [2, 'Saldo rachunków'],
      [3, 'Raport z kasy'],
    ])
  })

  it('should reject an order list that is not a permutation of the run tasks', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(reorderRunItems(db, run.id, [run.items[0].id])).rejects.toMatchObject({
      code: 'ORDER_MISMATCH',
    })
  })

  it('should reject reordering a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(
      reorderRunItems(db, run.id, run.items.map((item) => item.id))
    ).rejects.toMatchObject({ code: 'RUN_CLOSED' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/integration/operations/run-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/operations/run-service"`.

- [ ] **Step 3: Implement the service**

Create `src/lib/operations/run-service.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma'
import {
  buildRunItemsFromPreviousRun,
  createRunItemInputs,
  createRunName,
  isPermutationOf,
} from '@/lib/operations/run-factory'

export type RunServiceErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'EMPTY_TEMPLATE'
  | 'RUN_EXISTS'
  | 'RUN_NOT_FOUND'
  | 'RUN_CLOSED'
  | 'ITEM_NOT_FOUND'
  | 'ORDER_MISMATCH'
  | 'PROCEDURE_NOT_FOUND'

export class RunServiceError extends Error {
  constructor(
    readonly code: RunServiceErrorCode,
    readonly details: { runId?: string } = {}
  ) {
    super(code)
    this.name = 'RunServiceError'
  }
}

// `ChecklistRunItem` has @@unique([runId, order]): shift every order far out of range first, then assign the final values.
const ORDER_SHIFT = 10_000

const RUN_WITH_ITEMS = {
  template: { include: { module: { include: { area: true } } } },
  items: { orderBy: { order: 'asc' } },
} as const

export interface StartRunInput {
  templateId: string
  periodYear: number
  periodMonth: number | null
  name?: string
  createdById: string
}

export interface RunTaskInput {
  title: string
  description?: string | null
  procedureId?: string | null
  recurring: boolean
}

export async function createRunFromTemplate(db: PrismaClient, input: StartRunInput) {
  return db.$transaction(async (tx) => {
    const template = await tx.checklistTemplate.findUnique({
      where: { id: input.templateId },
      include: { items: { orderBy: { order: 'asc' } } },
    })
    if (!template) throw new RunServiceError('TEMPLATE_NOT_FOUND')

    const existing = await tx.checklistRun.findFirst({
      where: { templateId: template.id, periodYear: input.periodYear, periodMonth: input.periodMonth },
      select: { id: true },
    })
    if (existing) throw new RunServiceError('RUN_EXISTS', { runId: existing.id })

    const previous = await tx.checklistRun.findFirst({
      where: { templateId: template.id },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
      include: { items: { orderBy: { order: 'asc' } } },
    })

    if (!previous && template.items.length === 0) throw new RunServiceError('EMPTY_TEMPLATE')
    const itemInputs = previous
      ? buildRunItemsFromPreviousRun(previous.items)
      : createRunItemInputs(template.items)

    return tx.checklistRun.create({
      data: {
        templateId: template.id,
        name: input.name ?? createRunName(template.name, input.periodYear, input.periodMonth),
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        createdById: input.createdById,
        items: { create: itemInputs },
      },
      include: RUN_WITH_ITEMS,
    })
  })
}

export async function assertRunIsOpen(db: PrismaClient, runId: string) {
  const run = await db.checklistRun.findUnique({ where: { id: runId }, select: { status: true } })
  if (!run) throw new RunServiceError('RUN_NOT_FOUND')
  if (run.status !== 'open') throw new RunServiceError('RUN_CLOSED')
}

export async function assertProcedureExists(db: PrismaClient, procedureId: string) {
  const procedure = await db.article.findFirst({
    where: { id: procedureId, type: 'procedure' },
    select: { id: true },
  })
  if (!procedure) throw new RunServiceError('PROCEDURE_NOT_FOUND')
}

export async function getProcedureForItem(db: PrismaClient, procedureId: string | null) {
  if (!procedureId) return null
  return db.article.findFirst({
    where: { id: procedureId, type: 'procedure' },
    select: { id: true, title: true, content: true },
  })
}

export async function addRunItem(db: PrismaClient, runId: string, input: RunTaskInput) {
  await assertRunIsOpen(db, runId)
  if (input.procedureId) await assertProcedureExists(db, input.procedureId)

  return db.$transaction(async (tx) => {
    const last = await tx.checklistRunItem.aggregate({ where: { runId }, _max: { order: true } })
    return tx.checklistRunItem.create({
      data: {
        runId,
        title: input.title,
        description: input.description ?? null,
        procedureId: input.procedureId ?? null,
        recurring: input.recurring,
        order: (last._max.order ?? 0) + 1,
        status: 'todo',
      },
    })
  })
}

export async function deleteRunItem(db: PrismaClient, runId: string, itemId: string) {
  await assertRunIsOpen(db, runId)

  await db.$transaction(async (tx) => {
    const item = await tx.checklistRunItem.findFirst({ where: { id: itemId, runId }, select: { id: true } })
    if (!item) throw new RunServiceError('ITEM_NOT_FOUND')

    await tx.checklistRunItem.delete({ where: { id: itemId } })

    const remaining = await tx.checklistRunItem.findMany({
      where: { runId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    })
    for (const [index, entry] of remaining.entries()) {
      if (entry.order !== index + 1) {
        await tx.checklistRunItem.update({ where: { id: entry.id }, data: { order: index + 1 } })
      }
    }
  })
}

export async function reorderRunItems(db: PrismaClient, runId: string, itemIds: string[]) {
  await assertRunIsOpen(db, runId)

  await db.$transaction(async (tx) => {
    const current = await tx.checklistRunItem.findMany({ where: { runId }, select: { id: true } })
    if (!isPermutationOf(current.map((item) => item.id), itemIds)) {
      throw new RunServiceError('ORDER_MISMATCH')
    }

    await tx.checklistRunItem.updateMany({ where: { runId }, data: { order: { increment: ORDER_SHIFT } } })
    for (const [index, id] of itemIds.entries()) {
      await tx.checklistRunItem.update({ where: { id }, data: { order: index + 1 } })
    }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/integration/operations/run-service.test.ts`
Expected: PASS (all service tests). The first run takes longer because it pushes the schema to a temporary database.

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/run-service.ts __tests__/integration/operations/run-service.test.ts
git commit -m "feat(operations): copy runs from the previous month and edit run tasks in a service"
```

---

### Task 5: API routes (TDD)

**Files:**
- Create: `src/lib/operations/run-http.ts`
- Create: `src/app/api/operations/runs/[id]/items/route.ts`
- Create: `src/app/api/operations/runs/[id]/items/order/route.ts`
- Modify: `src/app/api/operations/runs/route.ts`
- Modify: `src/app/api/operations/runs/[id]/items/[itemId]/route.ts`
- Create: `__tests__/unit/operations/run-routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `__tests__/unit/operations/run-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  addRunItem,
  assertRunIsOpen,
  createRunFromTemplate,
  deleteRunItem,
  getProcedureForItem,
  reorderRunItems,
  RunServiceError,
} from '@/lib/operations/run-service'
import { POST as startRun } from '@/app/api/operations/runs/route'
import { POST as createItem } from '@/app/api/operations/runs/[id]/items/route'
import { PATCH as patchItem, DELETE as removeItem } from '@/app/api/operations/runs/[id]/items/[itemId]/route'
import { PUT as putOrder } from '@/app/api/operations/runs/[id]/items/order/route'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { checklistRunItem: { findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/operations/run-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/operations/run-service')>()
  return {
    ...actual,
    createRunFromTemplate: vi.fn(),
    addRunItem: vi.fn(),
    deleteRunItem: vi.fn(),
    reorderRunItems: vi.fn(),
    assertRunIsOpen: vi.fn(),
    assertProcedureExists: vi.fn(),
    getProcedureForItem: vi.fn(),
  }
})

const mockSession = vi.mocked(getServerSession)
const mockFindItem = vi.mocked(prisma.checklistRunItem.findFirst)
const mockUpdateItem = vi.mocked(prisma.checklistRunItem.update)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE', id = `${role.toLowerCase()}-1`) {
  return { user: { id, name: role, email: `${id}@test.pl`, role }, expires: '' }
}

function jsonRequest(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/operations/test', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const runParams = { params: Promise.resolve({ id: 'run-1' }) }
const itemParams = { params: Promise.resolve({ id: 'run-1', itemId: 'item-1' }) }

const storedItem = {
  id: 'item-1',
  runId: 'run-1',
  title: 'Raport z kasy',
  description: null,
  order: 1,
  procedureId: null,
  ownerId: 'employee-1',
  status: 'todo',
  note: null,
  recurring: true,
  completedAt: null,
  completedById: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mockSession.mockResolvedValue(session('MANAGER'))
  mockFindItem.mockResolvedValue(storedItem)
  mockUpdateItem.mockResolvedValue(storedItem)
  vi.mocked(getProcedureForItem).mockResolvedValue(null)
})

describe('POST /api/operations/runs', () => {
  const body = { templateId: 'template-1', periodYear: 2026, periodMonth: 9 }

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(403)
  })

  it('should return 409 with the existing run id when the month is already started', async () => {
    vi.mocked(createRunFromTemplate).mockRejectedValue(new RunServiceError('RUN_EXISTS', { runId: 'run-9' }))

    const res = await startRun(jsonRequest('POST', body))

    expect(await res.json()).toMatchObject({ runId: 'run-9' })
  })

  it('should answer 409 for a duplicate month', async () => {
    vi.mocked(createRunFromTemplate).mockRejectedValue(new RunServiceError('RUN_EXISTS', { runId: 'run-9' }))

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(409)
  })

  it('should return 201 for a new month', async () => {
    vi.mocked(createRunFromTemplate).mockResolvedValue({ id: 'run-new' } as never)

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(201)
  })
})

describe('POST /api/operations/runs/[id]/items', () => {
  const body = { title: 'Faktura od nowego dostawcy', recurring: false }

  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(401)
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(403)
  })

  it('should return 400 for a too short title', async () => {
    const res = await createItem(jsonRequest('POST', { title: 'ab' }), runParams)

    expect(res.status).toBe(400)
  })

  it('should return 409 when the run is closed', async () => {
    vi.mocked(addRunItem).mockRejectedValue(new RunServiceError('RUN_CLOSED'))

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(409)
  })

  it('should return 201 and pass the recurring flag to the service', async () => {
    vi.mocked(addRunItem).mockResolvedValue({ ...storedItem, id: 'item-new', procedureId: null } as never)

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(201)
    expect(addRunItem).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ title: 'Faktura od nowego dostawcy', recurring: false })
    )
  })
})

describe('PATCH /api/operations/runs/[id]/items/[itemId]', () => {
  it('should let the task owner change the status', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(200)
  })

  it('should forbid the task owner from renaming the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { title: 'Inna nazwa' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should forbid an employee who does not own the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'someone-else'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should let a manager switch recurring off', async () => {
    const res = await patchItem(jsonRequest('PATCH', { recurring: false }), itemParams)

    expect(res.status).toBe(200)
    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recurring: false }) })
    )
  })

  it('should return 409 when the run is closed', async () => {
    vi.mocked(assertRunIsOpen).mockRejectedValue(new RunServiceError('RUN_CLOSED'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/operations/runs/[id]/items/[itemId]', () => {
  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should delete the task for a manager', async () => {
    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(200)
    expect(deleteRunItem).toHaveBeenCalledWith(expect.anything(), 'run-1', 'item-1')
  })

  it('should return 404 for an unknown task', async () => {
    vi.mocked(deleteRunItem).mockRejectedValue(new RunServiceError('ITEM_NOT_FOUND'))

    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/operations/runs/[id]/items/order', () => {
  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a', 'b'] }), runParams)

    expect(res.status).toBe(403)
  })

  it('should return 400 when the ids do not match the run tasks', async () => {
    vi.mocked(reorderRunItems).mockRejectedValue(new RunServiceError('ORDER_MISMATCH'))

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a'] }), runParams)

    expect(res.status).toBe(400)
  })

  it('should reorder for a manager', async () => {
    const res = await putOrder(jsonRequest('PUT', { itemIds: ['b', 'a'] }), runParams)

    expect(res.status).toBe(200)
    expect(reorderRunItems).toHaveBeenCalledWith(expect.anything(), 'run-1', ['b', 'a'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/unit/operations/run-routes.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/operations/runs/[id]/items/route"` (and the other new routes).

- [ ] **Step 3: Add the error-to-response mapper**

Create `src/lib/operations/run-http.ts`:

```ts
import { NextResponse } from 'next/server'
import { RunServiceError, type RunServiceErrorCode } from '@/lib/operations/run-service'

const RESPONSES: Record<RunServiceErrorCode, { status: number; error: string }> = {
  TEMPLATE_NOT_FOUND: { status: 404, error: 'Template not found' },
  EMPTY_TEMPLATE: { status: 400, error: 'Template has no items' },
  RUN_EXISTS: { status: 409, error: 'Run already exists' },
  RUN_NOT_FOUND: { status: 404, error: 'Run not found' },
  RUN_CLOSED: { status: 409, error: 'Run is closed' },
  ITEM_NOT_FOUND: { status: 404, error: 'Item not found' },
  ORDER_MISMATCH: { status: 400, error: 'Item ids do not match the run' },
  PROCEDURE_NOT_FOUND: { status: 400, error: 'Procedure not found' },
}

export function runErrorResponse(error: RunServiceError) {
  const { status, error: message } = RESPONSES[error.code]
  return NextResponse.json({ error: message, ...error.details }, { status })
}
```

- [ ] **Step 4: Update `POST /api/operations/runs`**

In `src/app/api/operations/runs/route.ts` keep `GET` exactly as it is and replace the imports and `POST` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRuns } from '@/lib/operations/queries'
import { runErrorResponse } from '@/lib/operations/run-http'
import { createRunFromTemplate, RunServiceError } from '@/lib/operations/run-service'
import { CreateChecklistRunSchema } from '@/lib/validations/operations'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const runs = await getRuns({ id: session.user.id, role: session.user.role })
  return NextResponse.json(runs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = CreateChecklistRunSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const run = await createRunFromTemplate(prisma, {
      templateId: parsed.data.templateId,
      periodYear: parsed.data.periodYear,
      periodMonth: parsed.data.periodMonth ?? null,
      name: parsed.data.name,
      createdById: session.user.id,
    })
    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
```

- [ ] **Step 5: Add `POST /api/operations/runs/[id]/items`**

Create `src/app/api/operations/runs/[id]/items/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import { addRunItem, getProcedureForItem, RunServiceError } from '@/lib/operations/run-service'
import { CreateChecklistRunItemSchema } from '@/lib/validations/operations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = CreateChecklistRunItemSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const item = await addRunItem(prisma, id, parsed.data)
    const procedure = await getProcedureForItem(prisma, item.procedureId)
    return NextResponse.json({ ...item, procedure }, { status: 201 })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
```

- [ ] **Step 6: Add `PUT /api/operations/runs/[id]/items/order`**

Create `src/app/api/operations/runs/[id]/items/order/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import { reorderRunItems, RunServiceError } from '@/lib/operations/run-service'
import { ReorderChecklistRunItemsSchema } from '@/lib/validations/operations'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const parsed = ReorderChecklistRunItemsSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    await reorderRunItems(prisma, id, parsed.data.itemIds)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
```

- [ ] **Step 7: Extend `PATCH` and add `DELETE` for a single task**

Replace the whole content of `src/app/api/operations/runs/[id]/items/[itemId]/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import {
  assertProcedureExists,
  assertRunIsOpen,
  deleteRunItem,
  getProcedureForItem,
  RunServiceError,
} from '@/lib/operations/run-service'
import { RUN_ITEM_STRUCTURE_FIELDS, UpdateChecklistRunItemSchema } from '@/lib/validations/operations'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params
  const item = await prisma.checklistRunItem.findFirst({ where: { id: itemId, runId: id } })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
  const isOwner = item.ownerId === session.user.id
  if (!canManage && !isOwner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = UpdateChecklistRunItemSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const touchesStructure = RUN_ITEM_STRUCTURE_FIELDS.some((field) => parsed.data[field] !== undefined)
  if (touchesStructure && !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertRunIsOpen(prisma, id)
    if (parsed.data.procedureId) await assertProcedureExists(prisma, parsed.data.procedureId)
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }

  const status = parsed.data.status ?? item.status
  const completed = status === 'done'

  const updated = await prisma.checklistRunItem.update({
    where: { id: item.id },
    data: {
      status,
      note: parsed.data.note === undefined ? item.note : parsed.data.note,
      ownerId: canManage && parsed.data.ownerId !== undefined ? parsed.data.ownerId : item.ownerId,
      completedAt: completed ? (item.completedAt ?? new Date()) : null,
      completedById: completed ? session.user.id : null,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.procedureId !== undefined ? { procedureId: parsed.data.procedureId } : {}),
      ...(parsed.data.recurring !== undefined ? { recurring: parsed.data.recurring } : {}),
    },
  })

  const procedure = await getProcedureForItem(prisma, updated.procedureId)
  return NextResponse.json({ ...updated, procedure })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, itemId } = await params

  try {
    await deleteRunItem(prisma, id, itemId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
```

- [ ] **Step 8: Run the route tests**

Run: `npm test -- __tests__/unit/operations/run-routes.test.ts`
Expected: PASS (all route tests).

- [ ] **Step 9: Run the whole operations suite**

Run: `npm test -- __tests__/unit/operations __tests__/integration/operations`
Expected: PASS (existing and new tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/operations/run-http.ts src/app/api/operations __tests__/unit/operations/run-routes.test.ts
git commit -m "feat(operations): API to add, edit, delete and reorder run tasks; 409 on duplicate month"
```

---

### Task 6: Queries for the list page

**Files:**
- Modify: `src/lib/operations/queries.ts`

- [ ] **Step 1: Update imports**

At the top of `src/lib/operations/queries.ts` replace the `run-factory` import with:

```ts
import { calculateRunProgress, getNextOpenItem, isReadyToClose } from '@/lib/operations/run-factory'
```

- [ ] **Step 2: Replace `getRuns`**

Replace the whole `getRuns` function with the version below. The shape of `items` stays `{ status, ownerId }` (so `GET /api/operations/runs` does not change for existing consumers); two derived fields are added. Titles come only from tasks the viewer is allowed to see.

```ts
export async function getRuns(viewer: OperationViewer) {
  const grantedRunIds = await getGrantedResourceIds(viewer, 'run')
  const canBypass = canBypassOperationVisibility(viewer)

  const runs = await prisma.checklistRun.findMany({
    where: grantedRunIds === null
      ? {}
      : {
          OR: [
            { id: { in: grantedRunIds } },
            { items: { some: { ownerId: viewer.id } } },
          ],
        },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { select: { status: true, ownerId: true, title: true, order: true } },
    },
  })

  const grantedSet = new Set(grantedRunIds ?? [])

  return runs.map(({ items, ...run }) => {
    const visible =
      canBypass || grantedSet.has(run.id) ? items : items.filter((item) => item.ownerId === viewer.id)

    return {
      ...run,
      items: items.map(({ status, ownerId }) => ({ status, ownerId })),
      progress: calculateRunProgress(visible),
      nextItemTitle: getNextOpenItem(visible)?.title ?? null,
      readyToClose: run.status === 'open' && isReadyToClose(visible),
    }
  })
}
```

- [ ] **Step 3: Add two small queries at the end of the file**

Append:

```ts
// Template used by "Rozpocznij miesiąc": the template of the latest run, otherwise the first active template.
export async function getDefaultRunTemplateId() {
  const lastRun = await prisma.checklistRun.findFirst({
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    select: { templateId: true },
  })
  if (lastRun) return lastRun.templateId

  const template = await prisma.checklistTemplate.findFirst({
    where: { active: true },
    orderBy: [{ module: { area: { order: 'asc' } } }, { module: { order: 'asc' } }, { name: 'asc' }],
    select: { id: true },
  })
  return template?.id ?? null
}

export async function getProcedureOptions() {
  return prisma.article.findMany({
    where: { type: 'procedure' },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
    select: { id: true, title: true },
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:app`
Expected: no errors. (`runs-list.tsx` still compiles because it does not yet use the new fields.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/operations/queries.ts
git commit -m "feat(operations): expose next task and ready-to-close hint for runs"
```

---

### Task 7: Runs list UI (badge, cards, start button, banner, page)

**Files:**
- Modify: `src/components/operations/status-badge.tsx`
- Modify: `src/components/operations/start-run-button.tsx`
- Create: `src/components/operations/run-status-button.tsx`
- Create: `src/components/operations/start-month-banner.tsx`
- Modify: `src/components/operations/runs-list.tsx`
- Modify: `src/app/(dashboard)/operations/runs/page.tsx`

- [ ] **Step 1: Status labels**

Replace `src/components/operations/status-badge.tsx` with:

```tsx
const LABELS: Record<string, string> = {
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  blocked: 'Bloker',
  done: 'Gotowe',
  open: 'W toku',
  ready: 'Gotowe do zamknięcia',
  closed: 'Zamknięte',
  archived: 'Archiwum',
}

const CLASSES: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  blocked: 'bg-red-100 text-red-700',
  done: 'bg-green-100 text-green-700',
  open: 'bg-blue-100 text-blue-700',
  ready: 'bg-amber-100 text-amber-800',
  closed: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-600',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${CLASSES[status] ?? CLASSES.todo}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
```

- [ ] **Step 2: Make `StartRunButton` reusable (label, 409, errors, accessible selects)**

Replace `src/components/operations/start-run-button.tsx` with:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CalendarDays, Play, X } from 'lucide-react'
import { getPreviousMonthPeriod, MONTHS } from '@/lib/operations/run-factory'

export function StartRunButton({
  templateId,
  label = 'Uruchom zamknięcie miesiąca',
}: {
  templateId: string
  label?: string
}) {
  const router = useRouter()
  const defaultPeriod = getPreviousMonthPeriod()
  const [open, setOpen] = useState(false)
  const [periodYear, setPeriodYear] = useState(defaultPeriod.periodYear)
  const [periodMonth, setPeriodMonth] = useState(defaultPeriod.periodMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startRun() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/operations/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId,
        periodYear,
        periodMonth,
      }),
    })
    setLoading(false)

    if (res.status === 409) {
      const existing = (await res.json()) as { runId?: string }
      if (existing.runId) {
        router.push(`/operations/runs/${existing.runId}`)
        return
      }
    }
    if (!res.ok) {
      setError('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
      return
    }
    const run = (await res.json()) as { id: string }
    router.push(`/operations/runs/${run.id}`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        {loading ? 'Uruchamiam...' : label}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border bg-white p-4 text-left shadow-lg">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Jaki miesiąc zamykamy?</p>
              <p className="text-xs text-gray-500">Domyślnie proponujemy poprzedni miesiąc.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-gray-100" aria-label="Zamknij">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          <div className="grid grid-cols-[1fr_96px] gap-2">
            <select
              aria-label="Miesiąc"
              value={periodMonth}
              onChange={(event) => setPeriodMonth(Number(event.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
            <input
              aria-label="Rok"
              type="number"
              min={2020}
              max={2100}
              value={periodYear}
              onChange={(event) => setPeriodYear(Number(event.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={startRun}
            disabled={loading}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" />
            {loading ? 'Uruchamiam...' : `Utwórz wykonanie: ${MONTHS[periodMonth - 1]} ${periodYear}`}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Close / reopen button for list cards**

Create `src/components/operations/run-status-button.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function RunStatusButton({
  runId,
  nextStatus,
  children,
  primary = false,
}: {
  runId: string
  nextStatus: 'open' | 'closed'
  children: React.ReactNode
  primary?: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function changeStatus() {
    setLoading(true)
    setFailed(false)
    const res = await fetch(`/api/operations/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    setLoading(false)
    if (!res.ok) {
      setFailed(true)
      return
    }
    router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={changeStatus}
        disabled={loading}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
          primary ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
        }`}
      >
        {loading ? 'Zapisuję...' : children}
      </button>
      {failed && <span role="alert" className="text-xs text-red-700">Nie udało się zapisać.</span>}
    </span>
  )
}
```

- [ ] **Step 4: "Month missing" banner**

Create `src/components/operations/start-month-banner.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatClosingPeriod } from '@/lib/operations/run-factory'

export function StartMonthBanner({
  templateId,
  periodYear,
  periodMonth,
}: {
  templateId: string
  periodYear: number
  periodMonth: number
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const period = formatClosingPeriod(periodYear, periodMonth)

  async function startRun() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/operations/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, periodYear, periodMonth }),
    })
    setLoading(false)

    if (res.status === 409) {
      const existing = (await res.json()) as { runId?: string }
      if (existing.runId) {
        router.push(`/operations/runs/${existing.runId}`)
        return
      }
    }
    if (!res.ok) {
      setError('Nie udało się utworzyć wykonania. Spróbuj ponownie.')
      return
    }
    const run = (await res.json()) as { id: string }
    router.push(`/operations/runs/${run.id}`)
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-gray-900 first-letter:uppercase">{period} nie ma jeszcze zamknięcia</p>
      <p className="mt-0.5 text-sm text-amber-900">Księgowość czeka na komplet dokumentów za poprzedni miesiąc.</p>
      <button
        type="button"
        onClick={startRun}
        disabled={loading}
        className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Uruchamiam...' : `Rozpocznij zamknięcie: ${period}`}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Runs list with sections, next task and close button**

Replace `src/components/operations/runs-list.tsx` with:

```tsx
import Link from 'next/link'
import { CalendarCheck, CircleAlert } from 'lucide-react'
import { ProgressBar } from './progress-bar'
import { RunStatusButton } from './run-status-button'
import { StatusBadge } from './status-badge'

interface RunListItem {
  id: string
  name: string
  status: string
  nextItemTitle: string | null
  readyToClose: boolean
  template: {
    module: {
      name: string
      area: { name: string }
    }
  }
  progress: {
    total: number
    done: number
    blocked: number
    percent: number
  }
}

function RunCard({ run, canManage }: { run: RunListItem; canManage: boolean }) {
  const isOpen = run.status === 'open'

  return (
    <div className="relative rounded-xl border bg-white p-4 transition hover:border-gray-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-gray-500" />
            <h3 className="font-semibold text-gray-900">
              <Link href={`/operations/runs/${run.id}`} className="after:absolute after:inset-0">
                {run.name}
              </Link>
            </h3>
            <StatusBadge status={isOpen && run.readyToClose ? 'ready' : run.status} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {run.template.module.area.name} / {run.template.module.name}
          </p>
          {isOpen && run.nextItemTitle && (
            <p className="mt-1 text-xs text-gray-600">
              Następne: <span className="font-medium text-gray-900">{run.nextItemTitle}</span>
            </p>
          )}
        </div>
        {run.progress.blocked > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            <CircleAlert className="h-3.5 w-3.5" />
            {run.progress.blocked} bloker
          </span>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <ProgressBar percent={run.progress.percent} />
        <span className="shrink-0 text-xs font-medium text-gray-500">
          {run.progress.done}/{run.progress.total}
        </span>
      </div>
      {canManage && isOpen && run.readyToClose && (
        <div className="relative z-10 mt-3">
          <RunStatusButton runId={run.id} nextStatus="closed" primary>
            Zamknij miesiąc
          </RunStatusButton>
        </div>
      )}
    </div>
  )
}

function RunSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="grid gap-3">{children}</div>
    </section>
  )
}

export function RunsList({ runs, canManage }: { runs: RunListItem[]; canManage: boolean }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-sm text-gray-500">
        Brak wykonań. Użyj przycisku „Rozpocznij miesiąc”, żeby zacząć pierwsze zamknięcie.
      </div>
    )
  }

  const active = runs.filter((run) => run.status === 'open')
  const closed = runs.filter((run) => run.status !== 'open')

  return (
    <div className="grid gap-8">
      {active.length > 0 && (
        <RunSection title="Do zrobienia">
          {active.map((run) => (
            <RunCard key={run.id} run={run} canManage={canManage} />
          ))}
        </RunSection>
      )}
      {closed.length > 0 && (
        <RunSection title="Zamknięte">
          {closed.map((run) => (
            <div key={run.id} className="opacity-75">
              <RunCard run={run} canManage={canManage} />
            </div>
          ))}
        </RunSection>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Runs page**

Replace `src/app/(dashboard)/operations/runs/page.tsx` with:

```tsx
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getDefaultRunTemplateId, getRuns } from '@/lib/operations/queries'
import { findRunForPeriod, getPreviousMonthPeriod } from '@/lib/operations/run-factory'
import { RunsList } from '@/components/operations/runs-list'
import { StartMonthBanner } from '@/components/operations/start-month-banner'
import { StartRunButton } from '@/components/operations/start-run-button'

export default async function OperationRunsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
  const runs = await getRuns({ id: session.user.id, role: session.user.role })
  const templateId = canManage ? await getDefaultRunTemplateId() : null
  const previousPeriod = getPreviousMonthPeriod()
  const previousMonthMissing =
    templateId !== null && findRunForPeriod(runs, templateId, previousPeriod) === undefined

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
            <ListChecks className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Zamknięcie miesiąca</h1>
            <p className="text-sm text-gray-500">Checklista dla księgowości — co miesiąc.</p>
          </div>
        </div>
        {templateId && <StartRunButton templateId={templateId} label="+ Rozpocznij miesiąc" />}
      </div>

      {previousMonthMissing && templateId && (
        <StartMonthBanner
          templateId={templateId}
          periodYear={previousPeriod.periodYear}
          periodMonth={previousPeriod.periodMonth}
        />
      )}

      <RunsList runs={runs} canManage={canManage} />
    </div>
  )
}
```

- [ ] **Step 7: Turn the old hub `/operations` into a redirect**

The hub page rendered `RunsList` with the old props and would no longer compile. The spec removes the hub anyway (the runs page is the single entry point), so replace `src/app/(dashboard)/operations/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

export default function OperationsPage() {
  redirect('/operations/runs')
}
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck:app && npx eslint src/components/operations src/app/\(dashboard\)/operations`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/operations src/app/\(dashboard\)/operations
git commit -m "feat(operations): start a month from the list, month-missing banner, sections and close action"
```

---

### Task 8: Run detail UI (checkbox, add / edit / delete, drag and drop, close)

**Files:**
- Create: `src/components/operations/run-task-form.tsx`
- Create: `src/components/operations/run-task-list.tsx`
- Modify: `src/components/operations/run-detail-client.tsx` (full rewrite)
- Modify: `src/app/(dashboard)/operations/runs/[id]/page.tsx`

- [ ] **Step 1: Add / edit form**

Create `src/components/operations/run-task-form.tsx`:

```tsx
'use client'

import { useState, type FormEvent } from 'react'

export interface TaskFormValues {
  title: string
  description: string | null
  procedureId: string | null
  recurring: boolean
}

export interface ProcedureOption {
  id: string
  title: string
}

const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400'
const LABEL_CLASS = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500'

export function RunTaskForm({
  mode,
  initial,
  procedureOptions,
  saving,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit'
  initial?: TaskFormValues
  procedureOptions: ProcedureOption[]
  saving: boolean
  onSubmit: (values: TaskFormValues) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [procedureId, setProcedureId] = useState(initial?.procedureId ?? '')
  const [recurring, setRecurring] = useState(initial?.recurring ?? true)
  const [titleError, setTitleError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (title.trim().length < 3) {
      setTitleError('Tytuł musi mieć co najmniej 3 znaki.')
      return
    }
    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      procedureId: procedureId || null,
      recurring,
    })
  }

  return (
    <form onSubmit={submit} className="p-5">
      <h2 className="mb-4 text-lg font-bold text-gray-900">{mode === 'add' ? 'Nowe zadanie' : 'Edytuj zadanie'}</h2>

      <div className="mb-3">
        <label htmlFor="task-title" className={LABEL_CLASS}>
          Tytuł zadania
        </label>
        <input
          id="task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={INPUT_CLASS}
          autoFocus
        />
        {titleError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {titleError}
          </p>
        )}
      </div>

      <div className="mb-3">
        <label htmlFor="task-description" className={LABEL_CLASS}>
          Opis (opcjonalnie)
        </label>
        <textarea
          id="task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div className="mb-4">
        <label htmlFor="task-procedure" className={LABEL_CLASS}>
          Procedura „jak to zrobić” (opcjonalnie)
        </label>
        <select
          id="task-procedure"
          value={procedureId}
          onChange={(event) => setProcedureId(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Bez procedury</option>
          {procedureOptions.map((procedure) => (
            <option key={procedure.id} value={procedure.id}>
              {procedure.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={recurring}
          aria-label="Powtarzaj co miesiąc"
          onClick={() => setRecurring((current) => !current)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${recurring ? 'bg-green-600' : 'bg-gray-300'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${recurring ? 'left-[18px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-sm text-gray-700">
          Powtarzaj co miesiąc
          {!recurring && <span className="ml-1 text-gray-500">(tylko ten miesiąc)</span>}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {mode === 'add' ? 'Dodaj' : 'Zapisz'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50">
          Anuluj
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Drag-and-drop checklist**

Create `src/components/operations/run-task-list.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, MoreHorizontal, Repeat } from 'lucide-react'
import { StatusBadge } from './status-badge'

export interface RunTask {
  id: string
  title: string
  description: string | null
  status: string
  recurring: boolean
}

interface RunTaskListProps {
  items: RunTask[]
  selectedId: string
  canToggle: boolean
  canEdit: boolean
  onSelect: (id: string) => void
  onToggleDone: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

function RowMenu({ title, onEdit, onDelete }: { title: string; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false)
        return
      }
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Opcje zadania: ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
          setConfirming(false)
        }}
        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border bg-white p-1 shadow-lg">
          {confirming ? (
            <div className="p-2">
              <p className="mb-2 text-sm text-gray-800">Usunąć to zadanie?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDelete()
                  }}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Tak, usuń
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded border px-3 py-1 text-xs font-medium">
                  Nie
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onEdit()
                }}
                className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                Edytuj
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="block w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              >
                Usuń
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  item,
  selected,
  canToggle,
  canEdit,
  onSelect,
  onToggleDone,
  onEdit,
  onDelete,
}: {
  item: RunTask
  selected: boolean
  canToggle: boolean
  canEdit: boolean
  onSelect: () => void
  onToggleDone: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit,
  })
  const done = item.status === 'done'

  return (
    <div
      ref={setNodeRef}
      data-testid="run-task-row"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`flex items-start gap-2 px-3 py-2.5 ${selected ? 'bg-gray-50' : ''}`}
    >
      {canEdit && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Przeciągnij zadanie: ${item.title}`}
          className="mt-0.5 cursor-grab touch-none rounded p-0.5 text-gray-300 hover:text-gray-600 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Oznacz jako gotowe: ${item.title}`}
        disabled={!canToggle}
        onClick={onToggleDone}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
          done ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white hover:border-gray-500'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {done && <Check className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className={`block font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.title}</span>
        {item.description && <span className="mt-0.5 block text-xs text-gray-500">{item.description}</span>}
      </button>
      {(item.status === 'blocked' || item.status === 'in_progress') && <StatusBadge status={item.status} />}
      {item.recurring ? (
        <span title="Powtarza się co miesiąc" className="mt-0.5 text-gray-400">
          <Repeat className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="mt-0.5 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
          tylko ten miesiąc
        </span>
      )}
      {canEdit && <RowMenu title={item.title} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export function RunTaskList({
  items,
  selectedId,
  canToggle,
  canEdit,
  onSelect,
  onToggleDone,
  onReorder,
  onEdit,
  onDelete,
}: RunTaskListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(items, oldIndex, newIndex).map((item) => item.id))
  }

  return (
    <DndContext id="run-task-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="divide-y">
          {items.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              canToggle={canToggle}
              canEdit={canEdit}
              onSelect={() => onSelect(item.id)}
              onToggleDone={() => onToggleDone(item.id)}
              onEdit={() => onEdit(item.id)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
```

- [ ] **Step 3: Rewrite the detail client**

Replace the whole content of `src/components/operations/run-detail-client.tsx` with:

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Circle, CircleAlert, Loader2, Play } from 'lucide-react'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'
import { ProgressBar } from './progress-bar'
import { RunTaskForm, type ProcedureOption, type TaskFormValues } from './run-task-form'
import { RunTaskList } from './run-task-list'
import { StatusBadge } from './status-badge'
import {
  calculateRunProgress,
  formatClosingPeriod,
  getRunDisplayStatus,
  MONTHS,
} from '@/lib/operations/run-factory'

interface RunItem {
  id: string
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: string
  note: string | null
  recurring: boolean
}

interface Procedure {
  id: string
  title: string
  content: string
}

type ItemResponse = RunItem & { procedure: Procedure | null }

interface RunDetail {
  id: string
  name: string
  status: string
  periodYear: number
  periodMonth: number | null
  canManage: boolean
  template: {
    module: {
      name: string
      area: { name: string }
    }
  }
  items: RunItem[]
  procedures: Procedure[]
  procedureOptions: ProcedureOption[]
}

type FormState = { mode: 'add' } | { mode: 'edit'; itemId: string } | null

const STATUS_OPTIONS = [
  { id: 'todo', label: 'Do zrobienia', icon: Circle },
  { id: 'in_progress', label: 'W toku', icon: Play },
  { id: 'blocked', label: 'Bloker', icon: CircleAlert },
  { id: 'done', label: 'Gotowe', icon: Check },
]

const SAVE_ERROR = 'Nie udało się zapisać zmiany. Odśwież stronę i spróbuj ponownie.'

async function requestJson<T>(url: string, method: string, body?: unknown): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

export function RunDetailClient({ initialRun }: { initialRun: RunDetail }) {
  const router = useRouter()
  const [runName, setRunName] = useState(initialRun.name)
  const [runStatus, setRunStatus] = useState(initialRun.status)
  const [periodYear, setPeriodYear] = useState(initialRun.periodYear)
  const [periodMonth, setPeriodMonth] = useState(initialRun.periodMonth ?? 1)
  const [items, setItems] = useState(initialRun.items)
  const [procedures, setProcedures] = useState(initialRun.procedures)
  const [selectedId, setSelectedId] = useState(initialRun.items[0]?.id ?? '')
  const [note, setNote] = useState(initialRun.items[0]?.note ?? '')
  const [form, setForm] = useState<FormState>(null)
  const [error, setError] = useState<string | null>(null)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const { canManage } = initialRun
  const isOpen = runStatus === 'open'
  const canEditList = canManage && isOpen
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0]
  const editedItem = form?.mode === 'edit' ? items.find((item) => item.id === form.itemId) : undefined
  const progress = calculateRunProgress(items)
  const displayStatus = getRunDisplayStatus(runStatus, items)
  const procedureById = useMemo(
    () => new Map(procedures.map((procedure) => [procedure.id, procedure])),
    [procedures]
  )
  const selectedProcedure = selectedItem?.procedureId ? procedureById.get(selectedItem.procedureId) : null

  function registerProcedure(procedure: Procedure | null) {
    if (!procedure) return
    setProcedures((current) => (current.some((entry) => entry.id === procedure.id) ? current : [...current, procedure]))
  }

  function selectItem(id: string) {
    const item = items.find((entry) => entry.id === id)
    if (!item) return
    setSelectedId(item.id)
    setNote(item.note ?? '')
    setForm(null)
  }

  function patchItem(itemId: string, data: object, onDone?: () => void) {
    startTransition(async () => {
      const updated = await requestJson<ItemResponse>(
        `/api/operations/runs/${initialRun.id}/items/${itemId}`,
        'PATCH',
        data
      )
      if (!updated) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      const { procedure, ...item } = updated
      registerProcedure(procedure)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...item } : entry)))
      if (item.id === selectedId) setNote(item.note ?? '')
      onDone?.()
    })
  }

  function toggleDone(itemId: string) {
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return
    patchItem(itemId, { status: item.status === 'done' ? 'todo' : 'done' })
  }

  function addTask(values: TaskFormValues) {
    startTransition(async () => {
      const created = await requestJson<ItemResponse>(`/api/operations/runs/${initialRun.id}/items`, 'POST', values)
      if (!created) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      const { procedure, ...item } = created
      registerProcedure(procedure)
      setItems((current) => [...current, item])
      setSelectedId(item.id)
      setNote(item.note ?? '')
      setForm(null)
    })
  }

  function deleteTask(itemId: string) {
    startTransition(async () => {
      const result = await requestJson<{ ok: boolean }>(
        `/api/operations/runs/${initialRun.id}/items/${itemId}`,
        'DELETE'
      )
      if (!result) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      const remaining = items.filter((item) => item.id !== itemId).map((item, index) => ({ ...item, order: index + 1 }))
      setItems(remaining)
      if (selectedId === itemId) {
        setSelectedId(remaining[0]?.id ?? '')
        setNote(remaining[0]?.note ?? '')
      }
      setForm(null)
    })
  }

  function reorderTasks(orderedIds: string[]) {
    const previous = items
    const byId = new Map(items.map((item) => [item.id, item]))
    setItems(
      orderedIds.flatMap((id, index) => {
        const item = byId.get(id)
        return item ? [{ ...item, order: index + 1 }] : []
      })
    )
    startTransition(async () => {
      const result = await requestJson<{ ok: boolean }>(
        `/api/operations/runs/${initialRun.id}/items/order`,
        'PUT',
        { itemIds: orderedIds }
      )
      if (!result) {
        setItems(previous)
        setError(SAVE_ERROR)
        return
      }
      setError(null)
    })
  }

  function changeRunStatus(next: 'open' | 'closed') {
    startTransition(async () => {
      const updated = await requestJson<{ status: string }>(`/api/operations/runs/${initialRun.id}`, 'PATCH', {
        status: next,
      })
      if (!updated) {
        setError(SAVE_ERROR)
        return
      }
      setError(null)
      setRunStatus(updated.status)
      setForm(null)
      router.refresh()
    })
  }

  async function updatePeriod() {
    setPeriodSaving(true)
    const updated = await requestJson<{ name: string; periodYear: number; periodMonth: number | null }>(
      `/api/operations/runs/${initialRun.id}`,
      'PATCH',
      { periodYear, periodMonth }
    )
    setPeriodSaving(false)
    if (!updated) {
      setError(SAVE_ERROR)
      return
    }
    setError(null)
    setRunName(updated.name)
    setPeriodYear(updated.periodYear)
    setPeriodMonth(updated.periodMonth ?? 1)
  }

  return (
    <div>
      <div className="mb-6 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{runName}</h1>
              <StatusBadge status={displayStatus} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {initialRun.template.module.area.name} / {initialRun.template.module.name}
            </p>
            <div className="mt-3">
              {canEditList ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Zamykany miesiąc
                    </label>
                    <select
                      value={periodMonth}
                      onChange={(event) => setPeriodMonth(Number(event.target.value))}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Rok
                    </label>
                    <input
                      type="number"
                      min={2020}
                      max={2100}
                      value={periodYear}
                      onChange={(event) => setPeriodYear(Number(event.target.value))}
                      className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={updatePeriod}
                    disabled={periodSaving}
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {periodSaving ? 'Zapisuję...' : 'Zapisz okres'}
                  </button>
                </div>
              ) : (
                <p className="text-sm font-medium text-gray-700">
                  Zamykany okres: {formatClosingPeriod(periodYear, periodMonth)}
                </p>
              )}
            </div>
          </div>
          <div className="flex min-w-52 flex-col items-end gap-3">
            <div className="w-full">
              <div className="mb-2 flex justify-between text-xs font-medium text-gray-500">
                <span>Postęp</span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <ProgressBar percent={progress.percent} />
            </div>
            {canManage && isOpen && (
              <button
                type="button"
                onClick={() => changeRunStatus('closed')}
                disabled={isPending}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  displayStatus === 'ready'
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                Zamknij miesiąc
              </button>
            )}
            {canManage && !isOpen && (
              <button
                type="button"
                onClick={() => changeRunStatus('open')}
                disabled={isPending}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Otwórz ponownie
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[440px_1fr]">
        <div className="rounded-xl border bg-white">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-semibold text-gray-900">Checklista</h2>
              <p className="text-xs text-gray-500">{progress.blocked} blokerów</p>
            </div>
            {canEditList && (
              <button
                type="button"
                onClick={() => setForm({ mode: 'add' })}
                className="rounded-lg border border-gray-900 px-3 py-1.5 text-sm font-semibold hover:bg-gray-50"
              >
                + Dodaj zadanie
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">
              Brak zadań w tym wykonaniu.{canEditList ? ' Dodaj pierwsze zadanie przyciskiem powyżej.' : ''}
            </p>
          ) : (
            <RunTaskList
              items={items}
              selectedId={selectedItem?.id ?? ''}
              canToggle={isOpen && !isPending}
              canEdit={canEditList}
              onSelect={selectItem}
              onToggleDone={toggleDone}
              onReorder={reorderTasks}
              onEdit={(itemId) => setForm({ mode: 'edit', itemId })}
              onDelete={deleteTask}
            />
          )}
        </div>

        <div className="rounded-xl border bg-white">
          {form ? (
            <RunTaskForm
              key={form.mode === 'edit' ? form.itemId : 'new'}
              mode={form.mode}
              initial={
                editedItem
                  ? {
                      title: editedItem.title,
                      description: editedItem.description,
                      procedureId: editedItem.procedureId,
                      recurring: editedItem.recurring,
                    }
                  : undefined
              }
              procedureOptions={initialRun.procedureOptions}
              saving={isPending}
              onSubmit={(values) =>
                form.mode === 'edit' ? patchItem(form.itemId, values, () => setForm(null)) : addTask(values)
              }
              onCancel={() => setForm(null)}
            />
          ) : selectedItem ? (
            <div>
              <div className="border-b p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Zadanie</p>
                    <h2 className="mt-1 text-lg font-bold text-gray-900">{selectedItem.title}</h2>
                    {selectedItem.description && <p className="mt-1 text-sm text-gray-500">{selectedItem.description}</p>}
                  </div>
                  <StatusBadge status={selectedItem.status} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        onClick={() => patchItem(selectedItem.id, { status: option.id })}
                        disabled={isPending || !isOpen}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                          selectedItem.status === option.id
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    )
                  })}
                  {isPending && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
                </div>

                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Notatka / bloker
                  </label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    onBlur={() => {
                      if (isOpen && note !== (selectedItem.note ?? '')) patchItem(selectedItem.id, { note })
                    }}
                    readOnly={!isOpen}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                    placeholder="Co blokuje zadanie albo co trzeba zapamiętać?"
                  />
                </div>
              </div>

              <div className="p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">How-to</p>
                {selectedProcedure ? (
                  <ArticleViewer content={selectedProcedure.content} />
                ) : (
                  <div className="rounded-lg bg-gray-50 p-5 text-sm text-gray-500">
                    To zadanie nie ma jeszcze podpiętej procedury.
                    {canEditList ? ' Możesz ją dodać w menu „⋯” → Edytuj.' : ''}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-gray-500">Brak zadań w tym wykonaniu.</div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update the detail page**

Replace `src/app/(dashboard)/operations/runs/[id]/page.tsx` with:

```tsx
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getProcedureOptions, getRun } from '@/lib/operations/queries'
import { RunDetailClient } from '@/components/operations/run-detail-client'

export default async function OperationRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const run = await getRun(id, { id: session.user.id, role: session.user.role })
  if (!run) notFound()

  const visibleItems =
    session.user.role === 'EMPLOYEE' ? run.items.filter((item) => item.ownerId === session.user.id) : run.items
  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
  const procedureOptions = canManage ? await getProcedureOptions() : []

  return (
    <div className="mx-auto max-w-7xl p-6">
      <RunDetailClient
        initialRun={{
          id: run.id,
          name: run.name,
          status: run.status,
          periodYear: run.periodYear,
          periodMonth: run.periodMonth,
          canManage,
          template: run.template,
          items: visibleItems.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            order: item.order,
            procedureId: item.procedureId,
            ownerId: item.ownerId,
            status: item.status,
            note: item.note,
            recurring: item.recurring,
          })),
          procedures: run.procedures.map((procedure) => ({
            id: procedure.id,
            title: procedure.title,
            content: procedure.content,
          })),
          procedureOptions,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Typecheck and lint**

Run:
```bash
npm run typecheck:app
npx eslint src/components/operations src/app/\(dashboard\)/operations
```
Expected: no errors. Common fix if it fails: a `RunItem` returned from the API carries extra fields (`createdAt`, …) — that is fine at runtime because the client only reads the typed fields.

- [ ] **Step 6: Manual check in the browser**

Run: `npm run dev`, log in as an ADMIN, open `/operations/runs`, open a run, and verify: ticking a checkbox updates progress; "+ Dodaj zadanie" adds a task with the "tylko ten miesiąc" badge when the switch is off; ⋯ → Edytuj / Usuń (with inline confirmation); dragging a ⠿ handle reorders and survives a page reload; "Zamknij miesiąc" shows "Zamknięte" and hides the editing controls; "Otwórz ponownie" restores them.

- [ ] **Step 7: Commit**

```bash
git add src/components/operations src/app/\(dashboard\)/operations/runs
git commit -m "feat(operations): edit tasks on the run, one-click done, drag and drop, close and reopen month"
```

---

### Task 9: Navigation

**Files:**
- Modify: `src/components/shared/sidebar.tsx` (lines ~70–72)

(The `/operations` → `/operations/runs` redirect was added in Task 7 Step 7.)

- [ ] **Step 1: Find references that will be affected**

Run:
```bash
grep -rn "Centrum\|'/operations'\|\"/operations\"" src __tests__ e2e | grep -v "^src/app/api"
```
Expected: the sidebar entry and possibly back-links in the procedures/templates pages. Any back-link to `/operations` keeps working through the redirect; update its visible text only if it says "Centrum".

- [ ] **Step 2: Update the sidebar**

In `src/components/shared/sidebar.tsx`, in the `Operacje` section replace:

```ts
      { href: '/operations', label: 'Centrum', icon: ListChecks },
      { href: '/operations/procedures', label: 'Procedury', icon: BookOpen },
      { href: '/operations/runs', label: 'Wykonania', icon: ListChecks },
```

with:

```ts
      { href: '/operations/runs', label: 'Zamknięcie miesiąca', icon: ListChecks },
      { href: '/operations/procedures', label: 'Procedury', icon: BookOpen },
```

- [ ] **Step 3: Typecheck, lint and run all unit tests that touch the sidebar**

Run:
```bash
npm run typecheck:app
npx eslint src/components/shared/sidebar.tsx
npm test -- __tests__/unit/shared
```
Expected: no errors; tests PASS. If a test asserts the old labels, update the expected labels to `Zamknięcie miesiąca` and remove the `Centrum` expectation.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/sidebar.tsx
git commit -m "feat(operations): rename Wykonania to Zamknięcie miesiąca and drop the Centrum entry"
```

---

### Task 10: E2E spec

**Files:**
- Create: `e2e/operations-month-closing.spec.ts`

The Playwright database only contains the admin user, so the spec seeds its own operation area, module and template through Prisma (same approach as `e2e/hr-payroll.spec.ts`).

- [ ] **Step 1: Write the spec**

Create `e2e/operations-month-closing.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '../src/generated/prisma'
import { formatClosingPeriod, getPreviousMonthPeriod } from '../src/lib/operations/run-factory'

// Month closing on the isolated Playwright database. Every title below is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const TEMPLATE_ID = 'e2e-month-closing-template'
const TASKS = ['Raport z kasy testowej', 'Saldo rachunków testowych', 'Rejestr VAT testowy']
const ONE_OFF = 'Faktura od testowego dostawcy'

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Month closing E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(process.env.ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('Hasło').fill(process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const rowTitles = (page: Page) => page.getByTestId('run-task-row').locator('span.font-medium')

test.describe('Month closing', () => {
  test.beforeAll(async () => {
    assertQaDatabase()
    const prisma = new PrismaClient()
    try {
      await prisma.operationArea.create({ data: { id: 'e2e-area', name: 'Finanse (test)', slug: 'e2e-finanse' } })
      await prisma.operationModule.create({
        data: { id: 'e2e-module', areaId: 'e2e-area', name: 'Koniec miesiąca (test)', slug: 'e2e-koniec-miesiaca' },
      })
      await prisma.checklistTemplate.create({
        data: {
          id: TEMPLATE_ID,
          moduleId: 'e2e-module',
          name: 'Księgowość testowa',
          items: { create: TASKS.map((title, index) => ({ title, order: index + 1 })) },
        },
      })
    } finally {
      await prisma.$disconnect()
    }
  })

  test.afterAll(async () => {
    const prisma = new PrismaClient()
    try {
      await prisma.checklistRun.deleteMany({ where: { templateId: TEMPLATE_ID } })
      await prisma.checklistTemplate.deleteMany({ where: { id: TEMPLATE_ID } })
      await prisma.operationModule.deleteMany({ where: { id: 'e2e-module' } })
      await prisma.operationArea.deleteMany({ where: { id: 'e2e-area' } })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('owner closes a month and the next month inherits only the recurring tasks', async ({ page }) => {
    test.setTimeout(120_000)
    const previous = getPreviousMonthPeriod()
    const previousLabel = formatClosingPeriod(previous.periodYear, previous.periodMonth)
    const earlier =
      previous.periodMonth === 1
        ? { periodYear: previous.periodYear - 1, periodMonth: 12 }
        : { periodYear: previous.periodYear, periodMonth: previous.periodMonth - 1 }

    await login(page)

    // Navigation: one clear entry, no hub.
    await page.goto('/operations')
    await expect(page).toHaveURL(/\/operations\/runs$/)
    await expect(page.getByRole('heading', { name: 'Zamknięcie miesiąca' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Centrum', exact: true })).toHaveCount(0)

    // The previous month has no run yet: the banner starts it.
    await page.getByRole('button', { name: `Rozpocznij zamknięcie: ${previousLabel}` }).click()
    await expect(page).toHaveURL(/\/operations\/runs\/.+/)
    await expect(rowTitles(page)).toHaveText(TASKS)

    // One click marks a task as done.
    await page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` }).click()
    await expect(page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('1/3')).toBeVisible()

    // Add a one-off task.
    await page.getByRole('button', { name: '+ Dodaj zadanie' }).click()
    await page.getByLabel('Tytuł zadania').fill(ONE_OFF)
    await page.getByRole('switch', { name: 'Powtarzaj co miesiąc' }).click()
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await expect(rowTitles(page)).toHaveText([...TASKS, ONE_OFF])
    await expect(page.getByText('tylko ten miesiąc').first()).toBeVisible()

    // Reorder with the keyboard sensor: move the last task one position up, then reload to prove it was saved.
    const handle = page.getByRole('button', { name: `Przeciągnij zadanie: ${ONE_OFF}` })
    await handle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Space')
    await expect(rowTitles(page)).toHaveText([TASKS[0], TASKS[1], ONE_OFF, TASKS[2]])
    await page.reload()
    await expect(rowTitles(page)).toHaveText([TASKS[0], TASKS[1], ONE_OFF, TASKS[2]])

    // Closing is never blocked, even with unfinished tasks.
    await page.getByRole('button', { name: 'Zamknij miesiąc' }).click()
    await expect(page.getByText('Zamknięte', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Dodaj zadanie' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Otwórz ponownie' })).toBeVisible()

    // The closed run is listed under "Zamknięte".
    await page.goto('/operations/runs')
    await expect(page.getByRole('heading', { name: 'Zamknięte' })).toBeVisible()

    // Start another month: only recurring tasks come along, with progress reset.
    await page.getByRole('button', { name: '+ Rozpocznij miesiąc' }).click()
    await page.getByLabel('Miesiąc').selectOption({ index: earlier.periodMonth - 1 })
    await page.getByLabel('Rok').fill(String(earlier.periodYear))
    await page
      .getByRole('button', { name: new RegExp(`^Utwórz wykonanie: .* ${earlier.periodYear}$`) })
      .click()
    await expect(page).toHaveURL(/\/operations\/runs\/.+/)
    await expect(rowTitles(page)).toHaveText(TASKS)
    await expect(page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText('0/3')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- e2e/operations-month-closing.spec.ts`
Expected: 1 test PASS. If Playwright cannot start the dev server in this environment, run it where the other specs (`e2e/hr-payroll.spec.ts`) run and report that the spec could not be executed here.

- [ ] **Step 3: Commit**

```bash
git add e2e/operations-month-closing.spec.ts
git commit -m "test(operations): e2e for closing a month and inheriting recurring tasks"
```

---

### Task 11: Documentation and final verification

**Files:**
- Modify: `architecture.md`
- Modify: `project_status.md`

- [ ] **Step 1: Document the new field in `architecture.md`**

In the `ChecklistRunItem` model block (section "Operations Playbook"), replace:

```
  status         String @default("todo") // todo | in_progress | blocked | done
  note           String?
```

with:

```
  status         String @default("todo") // todo | in_progress | blocked | done
  note           String?
  recurring      Boolean @default(true) // false = zadanie jednorazowe, nie kopiuje się do następnego miesiąca
```

Then, directly under the line `Pierwszy seed: ...` add:

```
Nowe wykonanie (`POST /api/operations/runs`) kopiuje zadania z ostatniego wykonania tego samego szablonu (tylko `recurring = true`, status i notatki wyzerowane). Szablon jest użyty tylko, gdy nie ma jeszcze żadnego wykonania. Duplikat (ten sam szablon i miesiąc) zwraca 409 z `runId` istniejącego wykonania — sprawdzany w kodzie, bez unikalnego indeksu (`periodMonth` bywa NULL, a dane produkcyjne mogą już zawierać duplikaty).
```

- [ ] **Step 2: Update the API table in `project_status.md`**

In the table "API — Operacje":

1. Replace the row that starts with `| /api/operations/runs | GET, POST |` with:

```
| /api/operations/runs | GET, POST | Lista wykonań / start miesiąca (kopia z poprzedniego wykonania, 409 przy duplikacie) | GET: zalogowani; POST: ADMIN, MANAGER |
```

2. Replace the row that starts with `| /api/operations/runs/[id] | GET |` and the row that starts with `| /api/operations/runs/[id]/items/[itemId] | PATCH |` with these four rows:

```
| /api/operations/runs/[id] | GET, PATCH | Szczegóły wykonania / zmiana okresu i statusu (open ↔ closed, bez blokady) | GET: ADMIN/MANAGER całość, EMPLOYEE własne zadania; PATCH: ADMIN, MANAGER |
| /api/operations/runs/[id]/items | POST | Dodanie zadania do otwartego wykonania | ADMIN, MANAGER |
| /api/operations/runs/[id]/items/[itemId] | PATCH, DELETE | Status i notatka zadania (ADMIN/MANAGER lub właściciel); tytuł, opis, procedura, `recurring` i usunięcie tylko ADMIN/MANAGER; zamknięte wykonanie → 409 | j.w. |
| /api/operations/runs/[id]/items/order | PUT | Nowa kolejność zadań (lista id) | ADMIN, MANAGER |
```

- [ ] **Step 3: Add a status section and bump the date in `project_status.md`**

Replace this line near the top of the file:

```
**Ostatnia aktualizacja:** 2026-10-01 (umowy kosztowe — #25, gałąź `cost-contracts`)
```

with:

```
**Ostatnia aktualizacja:** 2026-10-02 (Zamknięcie miesiąca — przebudowa UX modułu Wykonania, gałąź `improve-module-ux`)
```

Then insert the following section directly below that line, above the existing `## Umowy kosztowe` section (the fence below uses four backticks because the section itself contains a three-backtick block):

````markdown
## Zamknięcie miesiąca (dawniej Wykonania) — 02.10.2026 (gałąź `improve-module-ux`)

```
[x] Migracja 20261002090000_run_item_recurring: ChecklistRunItem.recurring (domyślnie true)
[x] Lista /operations/runs: przycisk „+ Rozpocznij miesiąc", baner „<miesiąc> nie ma jeszcze zamknięcia", sekcje „Do zrobienia" / „Zamknięte", linijka „Następne: …", status „Gotowe do zamknięcia" (podpowiedź), „Zamknij miesiąc"
[x] Nowe wykonanie = kopia zadań z poprzedniego miesiąca (tylko „powtarzaj co miesiąc"); 409 przy duplikacie miesiąca
[x] Szczegół wykonania: pole wyboru „Gotowe" (1 klik), dodawanie / edycja / usuwanie zadań, przełącznik „Powtarzaj co miesiąc", przeciąganie (dnd-kit), „Zamknij miesiąc" bez blokady, „Otwórz ponownie"; zamknięte wykonanie tylko do odczytu
[x] Menu: „Wykonania" → „Zamknięcie miesiąca", usunięto „Centrum"; /operations przekierowuje na /operations/runs; Szablony poza menu (strona działa pod adresem)
```

Spec: `docs/superpowers/specs/2026-10-02-month-closing-ux-design.md`. Plan: `docs/superpowers/plans/2026-10-02-month-closing-ux.md`.

**Następna sesja:** zebrać uwagi po pierwszym użyciu w miesiącu (listopad 2026) — ewentualnie przypisywanie osób do zadań z poziomu wykonania.

---
````

- [ ] **Step 4: Full verification**

Run each command and read the output:

```bash
npm test
npm run typecheck:app
npm run lint
npm run build
```
Expected: all unit and integration tests PASS (the known unrelated failure `ksef-sync.test.ts` also fails on `main` — compare with `main` before treating it as a regression); typecheck clean; lint clean; build succeeds (build is the only check that catches `params` typing mistakes in route handlers).

- [ ] **Step 5: Commit**

```bash
git add architecture.md project_status.md
git commit -m "docs: document month closing UX redesign"
```

- [ ] **Step 6: Update project memory and ask before pushing**

Per `CLAUDE.md`, update the project memory file for WallDecor (milestone M10 follow-up: month closing UX, `recurring` field, copy-from-previous-run rule, 409 duplicate guard) if the memory file exists on this machine. Then ask the user: **"Czy mam zrobić push na git i otworzyć PR?"** — do not push without confirmation.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| "+ Rozpocznij miesiąc" on the list, previous month default, template auto-chosen | 6 (`getDefaultRunTemplateId`), 7 |
| Banner when previous month has no run | 2 (`findRunForPeriod`), 7 |
| 409 on duplicate, UI opens the existing run | 4, 5, 7 |
| Sections "Do zrobienia" / "Zamknięte", "W toku" label, "Gotowe do zamknięcia" hint | 2, 6, 7 |
| "Następne: …" line, close button on ready cards | 2, 6, 7 |
| Detail: close (always enabled), reopen, checkbox, add / edit / delete, drag, ↻ and "tylko ten miesiąc" | 8 |
| Closed run read-only | 4 (`assertRunIsOpen`), 5, 8 |
| Owner keeps status/note only | 5 (PATCH structure check) |
| `recurring` field + copy from previous run + template fallback | 1, 2, 4 |
| Templates out of menu, `/operations` redirect, sidebar rename | 9 |
| API table (POST/PATCH/DELETE/PUT) | 5 |
| Unit / integration / E2E tests | 2, 3, 4, 5, 10 |
| Migration (SQL file, not `db push`) + `architecture.md` | 1, 11 |
| Out of scope: owners assignment, template editing, other processes, closed-run editing | not implemented (by design) |
