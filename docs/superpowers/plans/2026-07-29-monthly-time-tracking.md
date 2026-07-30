# Monthly Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly team and employee time-tracking modes with direct multi-row editing and safe working-day fill while preserving the weekly and employee dashboards.

**Architecture:** Extract the existing weekly data assembly into a scoped range loader, then expose a monthly read endpoint over the same response model. Add focused monthly presentation components and two mutation boundaries: one for changed rows and one shared preview/apply service for filling working days. Keep all permissions server-enforced and preserve existing time-entry identifiers.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 5, NextAuth role checks, Zod, React 19, Vitest, Testing Library, Playwright, Tailwind CSS, Lucide icons.

**Source Spec:** `docs/superpowers/specs/2026-07-29-hr-leave-and-monthly-time-tracking-design.md`

---

## File Structure

**Create:**

- `src/lib/hr/time-tracking/month.ts` — month parsing, navigation, and date-key helpers.
- `src/lib/hr/time-tracking/types.ts` — stable range and mutation response contracts.
- `src/lib/hr/time-tracking/range-loader.ts` — scoped employee/time/leave/holiday loader.
- `src/lib/hr/time-tracking/batch-policy.ts` — pure row and fill eligibility validation.
- `src/app/api/hr/time-tracking/monthly/route.ts` — scoped monthly read endpoint.
- `src/app/api/hr/time-tracking/batch/route.ts` — direct inline create/update endpoint.
- `src/app/api/hr/time-tracking/monthly/fill/route.ts` — preview/apply working-day fill endpoint.
- `src/components/hr/time-tracking/manager-timesheet.tsx` — week/month view switch and URL state.
- `src/components/hr/time-tracking/monthly-timesheet.tsx` — month toolbar, fetch, modal, and mode routing.
- `src/components/hr/time-tracking/monthly-team-grid.tsx` — employee-by-day grid.
- `src/components/hr/time-tracking/monthly-employee-table.tsx` — one employee, dirty rows, batch save.
- `src/components/hr/time-tracking/fill-working-days-dialog.tsx` — fill input, preview, and apply.
- `__tests__/unit/hr/month-time-tracking.test.ts`
- `__tests__/unit/hr/time-tracking-range-loader.test.ts`
- `__tests__/unit/hr/monthly-time-tracking-route.test.ts`
- `__tests__/unit/hr/time-tracking-batch-policy.test.ts`
- `__tests__/unit/hr/time-tracking-batch-route.test.ts`
- `__tests__/unit/hr/time-tracking-fill-route.test.ts`
- `__tests__/unit/hr/monthly-timesheet-view.test.tsx`
- `e2e/hr-time-tracking.spec.ts`

**Modify:**

- `src/app/(dashboard)/hr/time-tracking/page.tsx`
- `src/app/api/hr/time-tracking/weekly/route.ts`
- `src/lib/hr/schemas.ts`
- `src/components/hr/time-tracking/weekly-timesheet.tsx`
- `__tests__/unit/hr/operational-access.test.ts`

---

### Task 1: Add Month And Date-Key Helpers

**Files:**

- Create: `src/lib/hr/time-tracking/month.ts`
- Create: `__tests__/unit/hr/month-time-tracking.test.ts`

- [ ] **Step 1: Write failing helper tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildMonthDateKeys,
  getAdjacentMonth,
  parseMonthParam,
} from '@/lib/hr/time-tracking/month'

describe('monthly time helpers', () => {
  it.each([
    ['2025-02', 28],
    ['2024-02', 29],
    ['2026-04', 30],
    ['2026-07', 31],
  ])('builds every day for %s', (month, expectedDays) => {
    expect(buildMonthDateKeys(month)).toHaveLength(expectedDays)
  })

  it('crosses year boundaries', () => {
    expect(getAdjacentMonth('2026-12', 1)).toBe('2027-01')
    expect(getAdjacentMonth('2026-01', -1)).toBe('2025-12')
  })

  it('rejects impossible months', () => {
    expect(parseMonthParam('2026-13')).toBeNull()
    expect(parseMonthParam('26-07')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/month-time-tracking.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement timezone-stable calendar helpers**

Export:

```ts
export function parseMonthParam(value: string): { year: number; month: number } | null
export function currentMonthParam(now = new Date()): string
export function getAdjacentMonth(value: string, delta: number): string
export function buildMonthDateKeys(value: string): string[]
export function dateKeyToLocalNoon(value: string): Date
export function formatDateKey(date: Date): string
```

Build date keys from integer year/month/day values. Use local noon only for weekday display and `Date.UTC` only when comparing plain calendar keys. Never parse a bare `YYYY-MM-DD` and then derive the day in another timezone.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm test -- __tests__/unit/hr/month-time-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit month helpers**

```bash
git add src/lib/hr/time-tracking/month.ts __tests__/unit/hr/month-time-tracking.test.ts
git commit -m "feat(hr): add monthly time calendar helpers"
```

### Task 2: Extract A Scoped Range Loader And Preserve Weekly API

**Files:**

- Create: `src/lib/hr/time-tracking/types.ts`
- Create: `src/lib/hr/time-tracking/range-loader.ts`
- Modify: `src/app/api/hr/time-tracking/weekly/route.ts`
- Create: `__tests__/unit/hr/time-tracking-range-loader.test.ts`
- Modify: `__tests__/unit/hr/operational-access.test.ts`

- [ ] **Step 1: Define the response contracts**

```ts
export interface TimeTrackingDayEntry {
  id?: string
  clockIn?: string
  clockOut?: string | null
  totalMinutes?: number | null
  breakMinutes?: number | null
  status?: string
  leaveType?: string
  leaveCode?: string
  leaveColor?: string
}

export interface TimeTrackingEmployeeRow {
  id: string
  firstName: string
  lastName: string
  divisionId: string | null
  divisionName: string | null
  avatarUrl: string | null
  entries: Record<string, TimeTrackingDayEntry>
}

export interface TimeTrackingRangeData {
  startDate: string
  endDate: string
  days: string[]
  employees: TimeTrackingEmployeeRow[]
  dailyTotals: Record<string, number>
  holidays: Array<{ date: string; name: string; divisionId: string | null }>
  saturdayWorkable: boolean
  standardClockIn: string
  standardClockOut: string
}
```

- [ ] **Step 2: Write failing loader tests**

Mock Prisma and cover:

```ts
it('scopes a manager to their division', async () => {
  const result = await loadTimeTrackingRange({
    session: session('MANAGER', 'manager-1'),
    start: new Date('2026-07-01T00:00:00'),
    end: new Date('2026-07-31T23:59:59.999'),
  })

  expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ active: true, divisionId: 'JAG' }),
  }))
  expect(result.employees).toEqual([])
})

it('overlays approved leave without replacing an existing time entry', async () => {
  // Mock one entry and one approved leave for the same date.
  expect(result.employees[0].entries['2026-07-02']).toMatchObject({
    id: 'entry-1',
    leaveCode: 'UB',
  })
})

it('returns global and division holidays in the selected range', async () => {
  expect(result.holidays).toEqual(expect.arrayContaining([
    { date: '2026-07-10', name: 'Dzień wolny', divisionId: 'JAG' },
  ]))
})
```

- [ ] **Step 3: Run the loader test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-range-loader.test.ts
```

Expected: FAIL because the loader does not exist.

- [ ] **Step 4: Implement `loadTimeTrackingRange`**

The loader accepts:

```ts
interface LoadTimeTrackingRangeInput {
  session: HrSessionLike
  start: Date
  end: Date
  divisionId?: string
  departmentId?: string
  employeeId?: string
}
```

It must:

1. reject EMPLOYEE callers at the route boundary;
2. load the manager employee record when required;
3. apply `getScopedEmployeeWhere`;
4. reject a MANAGER division filter outside their division with an empty scoped result;
5. load only minimal employee fields;
6. load time entries, approved leave overlaps, and custom holidays for the range;
7. load `getHrSettings()`;
8. return date-keyed entries and totals;
9. keep an existing time entry when leave overlaps, adding leave metadata to it.

- [ ] **Step 5: Refactor weekly route without changing its contract**

Keep `week`, `divisionId`, and `departmentId` inputs. Call the loader and map:

```ts
return NextResponse.json({
  weekStart: data.startDate,
  weekEnd: data.endDate,
  days: data.days,
  employees: data.employees,
  dailyTotals: data.dailyTotals,
})
```

Do not change weekly component behavior in this task.

- [ ] **Step 6: Run loader and operational-access tests**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-range-loader.test.ts __tests__/unit/hr/operational-access.test.ts
```

Expected: PASS, including the existing manager-without-profile behavior.

- [ ] **Step 7: Commit the shared loader**

```bash
git add src/lib/hr/time-tracking src/app/api/hr/time-tracking/weekly/route.ts __tests__/unit/hr/time-tracking-range-loader.test.ts __tests__/unit/hr/operational-access.test.ts
git commit -m "refactor(hr): share time tracking range loader"
```

### Task 3: Add The Monthly Read Endpoint

**Files:**

- Create: `src/app/api/hr/time-tracking/monthly/route.ts`
- Create: `__tests__/unit/hr/monthly-time-tracking-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:

```ts
it('rejects employee accounts', async () => {
  mockGetServerSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))
  const response = await GET(request('month=2026-07'))
  expect(response.status).toBe(403)
})

it('rejects invalid month input', async () => {
  mockGetServerSession.mockResolvedValue(session('ADMIN'))
  const response = await GET(request('month=2026-13'))
  expect(response.status).toBe(400)
})

it('loads exactly the requested month with filters', async () => {
  mockGetServerSession.mockResolvedValue(session('ADMIN'))
  await GET(request('month=2026-07&divisionId=JAG&employeeId=employee-1'))
  expect(mockLoadRange).toHaveBeenCalledWith(expect.objectContaining({
    divisionId: 'JAG',
    employeeId: 'employee-1',
  }))
})
```

- [ ] **Step 2: Run the route test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-time-tracking-route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement GET**

Parse `month`, `divisionId`, `departmentId`, and `employeeId`. Default `month` to `currentMonthParam()`. Resolve the first and last day with `getMonthRange`, call `loadTimeTrackingRange`, and return:

```ts
{
  month,
  monthStart: data.startDate,
  monthEnd: data.endDate,
  days: data.days,
  employees: data.employees,
  dailyTotals: data.dailyTotals,
  holidays: data.holidays,
  saturdayWorkable: data.saturdayWorkable,
  standardClockIn: data.standardClockIn,
  standardClockOut: data.standardClockOut,
}
```

- [ ] **Step 4: Run route tests**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-time-tracking-route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the monthly endpoint**

```bash
git add src/app/api/hr/time-tracking/monthly/route.ts __tests__/unit/hr/monthly-time-tracking-route.test.ts
git commit -m "feat(hr): expose monthly time tracking data"
```

### Task 4: Add Week/Month And Team/Employee URL Navigation

**Files:**

- Create: `src/components/hr/time-tracking/manager-timesheet.tsx`
- Create: `src/components/hr/time-tracking/monthly-timesheet.tsx`
- Modify: `src/app/(dashboard)/hr/time-tracking/page.tsx`
- Modify: `src/components/hr/time-tracking/weekly-timesheet.tsx`
- Create: `__tests__/unit/hr/monthly-timesheet-view.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Mock `next/navigation` and assert:

```ts
it('switches to monthly team mode and preserves division', async () => {
  render(<ManagerTimesheet {...props} initialView="week" initialMode="team" />)
  await user.click(screen.getByRole('button', { name: 'Miesiąc' }))
  expect(router.push).toHaveBeenCalledWith(expect.stringContaining(
    'view=month&mode=team&month=2026-07&divisionId=JAG'
  ))
})

it('switches monthly submode without losing month', async () => {
  render(<ManagerTimesheet {...props} initialView="month" initialMode="team" initialMonth="2026-07" />)
  await user.click(screen.getByRole('button', { name: 'Pracownik' }))
  expect(router.push).toHaveBeenCalledWith(expect.stringContaining(
    'view=month&mode=employee&month=2026-07'
  ))
})
```

- [ ] **Step 2: Run the view test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the manager wrapper**

`ManagerTimesheet` owns only top-level segmented controls and receives:

```ts
interface ManagerTimesheetProps {
  userRole: 'ADMIN' | 'MANAGER'
  divisions: Array<{ id: string; name: string }>
  initialView: 'week' | 'month'
  initialMode: 'team' | 'employee'
  initialWeek: string | null
  initialMonth: string | null
  initialEmployeeId: string | null
  saturdayWorkable: boolean
}
```

Render a compact `Tydzień / Miesiąc` segmented control. In monthly view render a second `Zespół / Pracownik` control. Update only relevant URL keys; preserve `divisionId`.

- [ ] **Step 4: Create the monthly controller shell**

`MonthlyTimesheet` owns:

- `month`, `mode`, `divisionId`, and `employeeId` URL state;
- month previous/next/current controls;
- division and employee filters;
- loading, error, and fetched monthly data;
- existing `TimeEntryEditModal`;
- a `refreshData()` callback.

Until the presentation components are added in Tasks 5 and 7, render a stable loading or empty-state region with `data-testid="monthly-mode-shell"`. Do not add explanatory feature copy.

- [ ] **Step 5: Integrate the page**

Extend `SearchParams`:

```ts
interface SearchParams {
  view?: 'week' | 'month'
  mode?: 'team' | 'employee'
  week?: string
  month?: string
  employeeId?: string
  divisionId?: string
}
```

Replace direct `WeeklyTimesheet` rendering with `ManagerTimesheet`. Update the subtitle to `Tygodniowa i miesięczna ewidencja czasu pracy`.

Update `WeeklyTimesheet` so its URL changes preserve `view=week`; do not remove monthly keys except when they conflict with weekly navigation.

- [ ] **Step 6: Run navigation tests**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit navigation**

```bash
git add src/components/hr/time-tracking/manager-timesheet.tsx src/components/hr/time-tracking/monthly-timesheet.tsx src/components/hr/time-tracking/weekly-timesheet.tsx 'src/app/(dashboard)/hr/time-tracking/page.tsx' __tests__/unit/hr/monthly-timesheet-view.test.tsx
git commit -m "feat(hr): add monthly time tracking navigation"
```

### Task 5: Build The Monthly Team Grid

**Files:**

- Create: `src/components/hr/time-tracking/monthly-team-grid.tsx`
- Modify: `src/components/hr/time-tracking/monthly-timesheet.tsx`
- Modify: `__tests__/unit/hr/monthly-timesheet-view.test.tsx`

- [ ] **Step 1: Add failing team-grid tests**

Render 31 days and two employees. Verify:

```ts
expect(screen.getAllByRole('columnheader')).toHaveLength(33) // employee + 31 days + total
expect(screen.getByText('Kowalski J.')).toBeTruthy()
expect(screen.getByText('UB')).toBeTruthy()
expect(screen.getByText('Święto')).toBeTruthy()
expect(screen.getByTestId('monthly-employee-header').className).toContain('sticky')
```

Click an editable cell and assert the controller receives `{ employeeId, employeeName, date, entry }`. Click approved leave and assert no edit callback.

- [ ] **Step 2: Run the view test and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: FAIL because the team grid does not exist.

- [ ] **Step 3: Implement the compact grid**

Props:

```ts
interface MonthlyTeamGridProps {
  days: string[]
  employees: TimeTrackingEmployeeRow[]
  holidays: TimeTrackingRangeData['holidays']
  saturdayWorkable: boolean
  onEditCell: (cell: {
    employeeId: string
    employeeName: string
    date: string
    entry: TimeTrackingDayEntry | null
  }) => void
}
```

Requirements:

- outer `overflow-x-auto`;
- root table wrapper has `data-testid="monthly-team-grid"` for visual verification;
- fixed table layout with explicit day width;
- employee `th` and first `td` use `position: sticky; left: 0; z-index`;
- compact cell duration and status icon;
- holiday/weekend/leave states;
- 31-day grid dimensions remain stable while loading or hovering;
- monthly total uses `formatDuration`;
- no checkbox selection in monthly team v1;
- approved leave cells do not open the time-entry modal;
- existing entry plus leave metadata remains editable and displays both indicators.

- [ ] **Step 4: Integrate the grid and modal**

Render the grid in `mode=team`. Pass cell clicks to the existing `TimeEntryEditModal`. On save, call `refreshData()`.

- [ ] **Step 5: Run component tests**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit team mode**

```bash
git add src/components/hr/time-tracking/monthly-team-grid.tsx src/components/hr/time-tracking/monthly-timesheet.tsx __tests__/unit/hr/monthly-timesheet-view.test.tsx
git commit -m "feat(hr): add monthly team time grid"
```

### Task 6: Add Batch Validation And Inline Mutation API

**Files:**

- Create: `src/lib/hr/time-tracking/batch-policy.ts`
- Modify: `src/lib/hr/schemas.ts`
- Create: `src/app/api/hr/time-tracking/batch/route.ts`
- Create: `__tests__/unit/hr/time-tracking-batch-policy.test.ts`
- Create: `__tests__/unit/hr/time-tracking-batch-route.test.ts`

- [ ] **Step 1: Write failing pure-policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { validateTimeMutationRow } from '@/lib/hr/time-tracking/batch-policy'

describe('validateTimeMutationRow', () => {
  it('rejects clock-out before clock-in', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T16:00:00.000Z',
      clockOut: '2026-07-02T08:00:00.000Z',
      breakMinutes: 0,
    })).toEqual({ valid: false, error: 'Godzina wyjścia musi być późniejsza niż wejścia' })
  })

  it('calculates total minutes and preserves break minutes', () => {
    expect(validateTimeMutationRow({
      date: '2026-07-02',
      clockIn: '2026-07-02T06:00:00.000Z',
      clockOut: '2026-07-02T14:00:00.000Z',
      breakMinutes: 30,
    })).toMatchObject({ valid: true, totalMinutes: 480, breakMinutes: 30 })
  })
})
```

- [ ] **Step 2: Add the batch schema**

```ts
export const timeEntryBatchMutationSchema = z.object({
  employeeId: z.string().min(1),
  rows: z.array(z.object({
    entryId: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clockIn: z.string().datetime(),
    clockOut: z.string().datetime(),
    breakMinutes: z.number().int().min(0).max(1440).default(0),
  })).min(1).max(31),
})
```

- [ ] **Step 3: Run policy tests and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-batch-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 4: Implement row validation**

Return a discriminated union:

```ts
type ValidatedTimeRow =
  | { valid: true; totalMinutes: number; breakMinutes: number }
  | { valid: false; error: string }
```

Require valid dates, matching row date for both timestamps, `clockOut > clockIn`, and `breakMinutes <= totalMinutes`.

- [ ] **Step 5: Write failing route tests**

Cover:

- EMPLOYEE gets `403`;
- MANAGER outside scope gets `403`;
- an `entryId` belonging to another employee returns a row conflict;
- duplicate date rows return row conflicts;
- valid creates and updates are written transactionally;
- invalid rows are returned as errors while valid rows are saved;
- existing approved leave blocks a create on that day.

Response contract:

```ts
{
  saved: Array<{ date: string; entryId: string }>,
  failed: Array<{ date: string; error: string }>,
}
```

- [ ] **Step 6: Implement POST batch route**

The route must:

1. require ADMIN or MANAGER;
2. validate target employee with `canViewEmployeeRecord`;
3. reject duplicate dates in the request;
4. load all referenced entries and verify employee ownership;
5. load approved leave overlapping requested dates;
6. validate every row with `validateTimeMutationRow`;
7. mark leave-conflicting creates as failed;
8. write valid rows in one `$transaction`;
9. update existing IDs or create by employee/date;
10. set `totalMinutes`, `breakMinutes`, `source: 'bulk'`, and keep existing status on updates while new rows start `pending`;
11. catch database uniqueness conflicts and return row-level failures.

- [ ] **Step 7: Run batch tests**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-batch-policy.test.ts __tests__/unit/hr/time-tracking-batch-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit batch mutation**

```bash
git add src/lib/hr/time-tracking/batch-policy.ts src/lib/hr/schemas.ts src/app/api/hr/time-tracking/batch/route.ts __tests__/unit/hr/time-tracking-batch-policy.test.ts __tests__/unit/hr/time-tracking-batch-route.test.ts
git commit -m "feat(hr): batch edit monthly time entries"
```

### Task 7: Build Monthly Employee Inline Editing

**Files:**

- Create: `src/components/hr/time-tracking/monthly-employee-table.tsx`
- Modify: `src/components/hr/time-tracking/monthly-timesheet.tsx`
- Modify: `__tests__/unit/hr/monthly-timesheet-view.test.tsx`

- [ ] **Step 1: Add failing inline-edit tests**

Cover:

```ts
it('tracks dirty rows and submits only changed dates', async () => {
  await user.clear(screen.getByLabelText('Wejście 2026-07-02'))
  await user.type(screen.getByLabelText('Wejście 2026-07-02'), '09:00')
  expect(screen.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (1)' }))
  expect(fetchMock).toHaveBeenCalledWith('/api/hr/time-tracking/batch', expect.objectContaining({
    method: 'POST',
  }))
})

it('keeps failed rows dirty after partial success', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    saved: [{ date: '2026-07-02', entryId: 'entry-1' }],
    failed: [{ date: '2026-07-03', error: 'Konflikt' }],
  })))
  expect(await screen.findByText('Konflikt')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeTruthy()
})
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: FAIL because the employee table does not exist.

- [ ] **Step 3: Implement the employee table**

Props:

```ts
interface MonthlyEmployeeTableProps {
  employee: TimeTrackingEmployeeRow
  days: string[]
  holidays: TimeTrackingRangeData['holidays']
  saturdayWorkable: boolean
  onSaved: () => Promise<void>
  onOpenEntry: (date: string, entry: TimeTrackingDayEntry | null) => void
  onDirtyChange: (dirty: boolean) => void
}
```

Behavior:

- root mode wrapper has `data-testid="monthly-employee-mode"` for visual verification;
- one row per calendar day;
- clock-in and clock-out are native `time` inputs;
- approved leave and blocked days are read-only;
- break minutes and net duration are displayed;
- edits are held in `Map<date, DraftRow>`;
- button label is exactly `Zapisz zmiany (N)`;
- submit only dirty rows with browser-generated ISO timestamps;
- successful rows are removed from the dirty map;
- failed rows retain values and show inline errors;
- notes/approve/reject/delete remain in `TimeEntryEditModal`;
- row dimensions do not shift when an error appears.

- [ ] **Step 4: Add dirty navigation protection**

In `MonthlyTimesheet`, before changing `month`, `mode`, `divisionId`, or `employeeId`, call:

```ts
function confirmDiscard(): boolean {
  return !hasDirtyRows || window.confirm('Masz niezapisane zmiany. Odrzucić je?')
}
```

Also register `beforeunload` while dirty and remove it on cleanup.

- [ ] **Step 5: Integrate employee selection and table**

Select the first visible employee only when `employeeId` is absent. Write the selected ID to the URL. If the URL employee is outside scope, show `Pracownik nie jest dostępny w bieżącym zakresie` and do not fall back silently.

- [ ] **Step 6: Run component tests**

Run:

```bash
npm test -- __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit employee mode**

```bash
git add src/components/hr/time-tracking/monthly-employee-table.tsx src/components/hr/time-tracking/monthly-timesheet.tsx __tests__/unit/hr/monthly-timesheet-view.test.tsx
git commit -m "feat(hr): add monthly inline employee editing"
```

### Task 8: Add Working-Day Fill Preview And Apply

**Files:**

- Modify: `src/lib/hr/schemas.ts`
- Modify: `src/lib/hr/time-tracking/batch-policy.ts`
- Create: `src/app/api/hr/time-tracking/monthly/fill/route.ts`
- Create: `src/components/hr/time-tracking/fill-working-days-dialog.tsx`
- Modify: `src/components/hr/time-tracking/monthly-employee-table.tsx`
- Create: `__tests__/unit/hr/time-tracking-fill-route.test.ts`
- Modify: `__tests__/unit/hr/monthly-timesheet-view.test.tsx`

- [ ] **Step 1: Add the fill schema**

```ts
export const timeEntryFillSchema = z.object({
  employeeId: z.string().min(1),
  rows: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clockIn: z.string().datetime(),
    clockOut: z.string().datetime(),
    breakMinutes: z.number().int().min(0).max(1440).default(0),
  })).min(1).max(31),
  overwrite: z.boolean().default(false),
  preview: z.boolean().default(true),
})
```

- [ ] **Step 2: Write failing fill route tests**

Cover:

- preview performs no writes;
- weekends are skipped;
- Saturday follows `hr_saturday_workable`;
- global and employee-division custom holidays are skipped;
- another division's custom holiday does not skip;
- approved leave is skipped;
- existing entries are skipped by default;
- `overwrite=true` updates existing entries but still skips approved leave;
- preview and apply return identical eligibility counts for unchanged data.

Response:

```ts
{
  preview: boolean,
  counts: {
    eligible: number,
    existing: number,
    weekends: number,
    holidays: number,
    approvedLeave: number,
    invalid: number,
  },
  rows: Array<{
    date: string,
    action: 'create' | 'update' | 'skip',
    reason?: 'existing' | 'weekend' | 'holiday' | 'approved_leave' | 'invalid',
  }>,
  saved: Array<{ date: string; entryId: string }>,
}
```

- [ ] **Step 3: Run fill route tests and verify failure**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-fill-route.test.ts
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 4: Implement one shared evaluator for preview and apply**

Add:

```ts
export type FillSkipReason =
  | 'existing'
  | 'weekend'
  | 'holiday'
  | 'approved_leave'
  | 'invalid'

export function evaluateFillDay(input: {
  date: string
  saturdayWorkable: boolean
  isHoliday: boolean
  hasApprovedLeave: boolean
  hasExistingEntry: boolean
  overwrite: boolean
}): { action: 'create' | 'update' | 'skip'; reason?: FillSkipReason }
```

The route loads employee scope, entries, approved leave, custom holidays, and HR settings once. It maps every submitted row through `evaluateFillDay`.

When `preview=false`, write only `create` and `update` rows in one transaction. Use the exact same evaluated array; do not recompute eligibility in a second branch.

- [ ] **Step 5: Implement the dialog**

The dialog fields are:

- date from/to, default full visible month;
- clock-in/out, default from HR settings returned by monthly API;
- break minutes;
- `Nadpisz istniejące wpisy` checkbox, off by default.

The browser creates one ISO row per date so DST offsets are correct for the user's Europe/Warsaw timezone. First submit uses `preview=true` and displays all count groups. The primary action becomes `Zastosuj`, sends the same rows with `preview=false`, then refreshes monthly data.

- [ ] **Step 6: Add dialog component tests**

Verify:

- the first click previews and does not apply;
- count labels render;
- apply uses the same rows and overwrite value;
- successful apply closes and refreshes;
- an API error remains visible without losing the preview.

- [ ] **Step 7: Run fill and view tests**

Run:

```bash
npm test -- __tests__/unit/hr/time-tracking-fill-route.test.ts __tests__/unit/hr/monthly-timesheet-view.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit fill workflow**

```bash
git add src/lib/hr/schemas.ts src/lib/hr/time-tracking/batch-policy.ts src/app/api/hr/time-tracking/monthly/fill/route.ts src/components/hr/time-tracking/fill-working-days-dialog.tsx src/components/hr/time-tracking/monthly-employee-table.tsx __tests__/unit/hr/time-tracking-fill-route.test.ts __tests__/unit/hr/monthly-timesheet-view.test.tsx
git commit -m "feat(hr): safely fill monthly working days"
```

### Task 9: Complete Verification And Visual QA

**Files:**

- Create: `e2e/hr-time-tracking.spec.ts`
- Modify only monthly time-tracking source or test files when verification exposes a defect.

- [ ] **Step 1: Run focused monthly time tests**

Run:

```bash
npm test -- __tests__/unit/hr/month-time-tracking.test.ts __tests__/unit/hr/time-tracking-range-loader.test.ts __tests__/unit/hr/monthly-time-tracking-route.test.ts __tests__/unit/hr/time-tracking-batch-policy.test.ts __tests__/unit/hr/time-tracking-batch-route.test.ts __tests__/unit/hr/time-tracking-fill-route.test.ts __tests__/unit/hr/monthly-timesheet-view.test.tsx __tests__/unit/hr/operational-access.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full tests and production build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and Next.js production build exits `0`.

- [ ] **Step 3: Run the Impeccable detector once**

Run only after all monthly UI files are complete:

```bash
node /Users/piotr/.agents/skills/impeccable/scripts/detect.mjs --json src/components/hr/time-tracking/manager-timesheet.tsx src/components/hr/time-tracking/monthly-timesheet.tsx src/components/hr/time-tracking/monthly-team-grid.tsx src/components/hr/time-tracking/monthly-employee-table.tsx src/components/hr/time-tracking/fill-working-days-dialog.tsx
```

Expected: review every high-confidence finding and fix real overlap, text-fit, nested-card, icon, control, and responsive issues.

- [ ] **Step 4: Verify authenticated desktop behavior**

Start the app and log in as ADMIN. At a 1440x900 viewport verify:

1. weekly mode still loads and edits;
2. `Miesiąc` preserves the division filter;
3. team mode shows all 31 days, sticky employee names, holidays, leave, and totals;
4. a normal cell opens the existing modal;
5. employee mode edits two rows and submits one batch;
6. partial errors remain visible and dirty;
7. the fill preview count matches the applied rows;
8. browser back/forward restores mode, month, and employee.

- [ ] **Step 5: Verify authenticated mobile behavior**

At 390x844 verify:

- toolbars wrap without overlap;
- segmented labels fit;
- team grid scrolls horizontally while employee names remain visible;
- time inputs remain tappable;
- the save button and dialog footer are reachable;
- no text occludes adjacent rows.

- [ ] **Step 6: Add authenticated Playwright visual coverage**

Create:

```ts
import { test, expect } from '@playwright/test'

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name="username"]', process.env.ADMIN_USERNAME ?? 'admin')
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/dashboard/)
}

test.describe('Monthly time tracking', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('renders the monthly team grid on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/hr/time-tracking?view=month&mode=team&month=2026-07')
    await expect(page.getByRole('button', { name: 'Miesiąc' })).toBeVisible()
    await expect(page.getByTestId('monthly-team-grid')).toBeVisible()
    await page.screenshot({
      path: 'test-results/hr-month-team-desktop.png',
      fullPage: true,
    })
  })

  test('renders monthly employee mode on mobile without overlap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/hr/time-tracking?view=month&mode=employee&month=2026-07')
    await expect(page.getByRole('button', { name: 'Pracownik' })).toBeVisible()
    await expect(page.getByTestId('monthly-employee-mode')).toBeVisible()
    await page.screenshot({
      path: 'test-results/hr-month-employee-mobile.png',
      fullPage: true,
    })
  })
})
```

Run:

```bash
npx playwright test e2e/hr-time-tracking.spec.ts --project=chromium
```

Expected: both tests pass and write screenshots under `test-results/`. Inspect both images. Do not commit screenshot output.

- [ ] **Step 7: Commit verification fixes**

```bash
git status --short
git add src/app/api/hr/time-tracking src/components/hr/time-tracking src/lib/hr/time-tracking src/lib/hr/schemas.ts 'src/app/(dashboard)/hr/time-tracking/page.tsx' __tests__/unit/hr e2e/hr-time-tracking.spec.ts
git commit -m "fix(hr): polish monthly time tracking"
```

Do not push or deploy until both the leave migration audit and the final full build have been reviewed.
