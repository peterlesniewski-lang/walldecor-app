# HR Leave Administration And Monthly Time Tracking Design

## Context

WallDecor CEO already supports employee records, leave requests, leave approvals, weekly time tracking, schedules, and reports. Two operational gaps remain:

1. Paid-leave balances are initialized too broadly and cannot be configured simply per employee.
2. Administrators and managers can review time only one week at a time, which makes entering historical gaps inefficient.

This project extends the existing HR module. It does not replace its navigation, visual system, permission model, or employee time-tracking dashboard.

## Job And Audience

The primary users are ADMIN users and MANAGER users working within their existing employee scope.

- ADMIN configures annual paid-leave entitlement and employment fraction, records justified balance corrections, and can edit time entries.
- MANAGER reviews and corrects time entries for employees already visible under the existing organizational access policy.
- EMPLOYEE continues to submit leave requests and register personal time through the current workflows.

The visitor mode is operational: users arrive to complete or correct records quickly. The interface must favor scanning, compact comparison, and direct action over explanation.

## Outcomes

The project is successful when:

- an administrator can set an employee's annual paid-leave basis to 20 days, 26 days, or a custom value without using a legal seniority calculator;
- employment fraction and effective date are recorded explicitly;
- unpaid leave can be requested without a balance while still requiring approval;
- leave on demand uses the regular vacation pool and enforces its separate 4-day annual limit;
- historical requests and used balances remain intact;
- an administrator or manager can switch between weekly and monthly time views;
- the monthly team view makes gaps across an entire month visible;
- the monthly employee view allows fast inline correction of multiple days and one batch save;
- bulk filling does not overwrite data or create entries on non-working or approved-leave days without an explicit user decision.

## Product Direction

### Leave Entitlement

The application will use a deliberately simple administrative model rather than deriving entitlement from education and employment history.

Each employee can have a paid-vacation entitlement configuration with:

- entitlement mode: `20`, `26`, or `custom`;
- custom annual days when the mode is `custom`;
- employment fraction;
- effective-from date;
- administrative note.

ADMIN edits this configuration on the employee profile in an `Wymiar urlopu` section. The section shows the active configuration, calculated annual result, current balance, and correction history. Employees without a configuration are visibly marked `Do weryfikacji`; the application does not guess their legal entitlement.

The resulting annual base is proportional to employment fraction and is rounded up to a full day. Existing partial-year behavior remains applicable when employment starts during a year. The interface shows the calculated annual result before the administrator saves it.

Configuration changes apply from their effective date. They do not silently rewrite already approved requests or usage. When a change affects an existing balance, the application shows the proposed difference and requires the administrator to confirm a balance correction with a reason.

### Balance Corrections

Paid-vacation balance adjustments are explicit events, not direct silent edits.

Each correction records:

- employee;
- year;
- affected leave pool;
- previous value;
- new value or adjustment;
- required reason;
- administrator identity;
- timestamp.

The current balance view shows the effective total and exposes correction history. Corrections do not delete, recreate, or detach existing leave requests.

### Unpaid Leave

The active leave-type catalog gains `UB — Urlop bezpłatny` with these fixed behaviors:

- unpaid;
- does not track a balance;
- no annual day limit;
- always requires approval;
- appears in calendars, employee history, and approved-leave overlays in time tracking.

The request form must not show a zero-balance error for this type. Approval remains an explicit manager/admin action.

### Leave On Demand

`VLD — Urlop na żądanie` remains a distinct selectable type for reporting and workflow clarity, but it consumes the employee's `VL — Urlop wypoczynkowy` balance.

Validation checks both:

- sufficient remaining `VL` balance;
- a maximum of 4 VLD days in the calendar year, including approved and pending requests according to the same reservation rules as normal leave.

The system must not create or require a separate annual VLD balance. Existing VLD requests are preserved and count toward the sublimit. Existing erroneous VLD balance rows may remain for historical safety but are no longer used as the source of truth.

### Other Leave Types

Only leave types with `tracksBalance = true` participate in balance validation. Sick leave and unpaid leave never fail because their available balance is zero. The leave-type administration screen exposes the relevant behavior flags so the configured catalog is understandable.

## Monthly Time Tracking

### View Navigation

The ADMIN/MANAGER time-tracking page gains a segmented `Tydzień / Miesiąc` control. Monthly mode gains a second segmented `Zespół / Pracownik` control.

State is reflected in the URL:

- `view=week|month`;
- `mode=team|employee` in monthly view;
- `week=YYYY-Www` for weekly view;
- `month=YYYY-MM` for monthly view;
- `employeeId=<id>` for monthly employee view;
- the existing `divisionId` filter remains supported.

Reloading, sharing, and browser back/forward navigation preserve the selected period and mode.

### Monthly Team Mode

The team mode presents:

- one row per visible employee;
- one compact column for every calendar day in the selected month;
- a fixed employee column;
- horizontal scrolling for 28–31 day columns;
- day headers with weekday and date;
- weekend, holiday, approved leave, missing entry, pending entry, and approved entry states;
- a monthly total column;
- the existing division filter and existing ADMIN/MANAGER scope.

A time-entry cell shows a compact duration and status. Clicking a workable day opens the existing time-entry edit modal. Approved leave is shown as leave and is not editable as a time entry from that cell. The grid does not expand cards or duplicate employee details.

### Monthly Employee Mode

The employee mode presents one selected employee and a vertical table containing every day in the selected month.

Each row shows:

- date and weekday;
- day state;
- clock-in;
- clock-out;
- break duration;
- net duration;
- entry status;
- validation feedback.

Clock-in and clock-out are directly editable in the table. Edits remain local until the user selects `Zapisz zmiany (N)`. Only changed rows are submitted. A successful batch save clears the dirty state and refreshes monthly totals. A partial failure identifies failed rows and retains their unsaved values while confirmed rows are refreshed.

For actions not suited to inline editing, such as approval, rejection, notes, or deletion, the row can open the existing edit modal. Inline editing must not bypass the current role and status rules.

### Fill Working Days

Monthly employee mode includes `Wypełnij dni robocze`.

The action collects:

- date range, defaulting to the visible month;
- default clock-in and clock-out;
- default break duration when applicable;
- overwrite mode, disabled by default.

Before writing, the application shows a preview with counts for:

- entries to create;
- existing entries to skip;
- weekends to skip;
- public/custom holidays to skip;
- approved-leave days to skip.

By default the action fills only empty workable days. Existing entries are never overwritten without selecting overwrite mode. Approved leave is always skipped. The final operation uses one batch request and returns per-day results.

## Interaction And Visual Direction

The implementation inherits the existing WallDecor dashboard identity:

- current warm neutral tokens and typography;
- compact data tables;
- existing button, form, modal, avatar, and status treatments;
- Lucide icons for icon actions;
- restrained borders and existing radius conventions;
- tabular numeric time values.

The page remains a work surface, not a landing page. Controls form one compact toolbar above the data. No decorative sections, nested cards, gradients, oversized headings, or explanatory feature copy are added.

On smaller screens:

- the toolbar wraps without overlapping;
- the team grid retains a fixed employee column and horizontal scrolling;
- the employee table prioritizes date and time inputs, with secondary values wrapping or moving below the primary row where necessary;
- touch targets remain usable without making every grid cell oversized.

Loading keeps table dimensions stable. Empty states identify whether there are no visible employees or no entries. Errors appear near the failed operation and do not discard unsaved edits.

## Architecture

### Shared Monthly Range Data

Weekly and monthly views should use one server-side range-loading boundary for:

- role and organizational employee scope;
- employees and division metadata;
- time entries;
- approved-leave overlays;
- holidays and Saturday-workability rules;
- per-day and per-employee totals.

The existing weekly API contract remains unchanged while its internals call the shared loader. A monthly endpoint returns only the selected month and scoped employees; it does not expose confidential employee data.

### Batch Time Mutation

Inline saves and `Wypełnij dni robocze` use dedicated batch validation and mutation boundaries.

The server validates every requested day for:

- authentication and ADMIN/MANAGER scope;
- valid employee and date;
- clock-out after clock-in;
- uniqueness of employee/date;
- holiday, weekend, and approved-leave conflicts;
- overwrite intent;
- current entry status and permitted transitions.

Batch operations return per-row success or failure. Database writes that form one all-or-nothing administrative correction should be transactional. Preview and save use the same eligibility rules so displayed counts match the committed operation.

### Leave Configuration And Audit

The data model gains an effective-dated employee entitlement configuration and an append-only leave-balance correction record. Existing `LeaveBalanceNew` and `LeaveRequestNew` identities remain unchanged.

The leave service owns:

- resolving the effective entitlement;
- calculating the annual paid-vacation base;
- selecting the balance pool for a leave type;
- checking shared-pool and subtype limits;
- deciding whether a type requires balance validation;
- applying and auditing corrections.

Routes and forms consume this service rather than repeating balance rules.

## Data Preservation And Migration

Database migration is additive:

- no existing leave request, balance, or time entry is deleted;
- no existing primary identifier changes;
- current paid-vacation totals are retained as the initial effective state;
- existing VLD requests are mapped logically to the VL pool without changing their request type;
- UB is inserted idempotently by code;
- employee entitlement configuration can be added gradually by ADMIN.

Employees without a new configuration continue to use their current paid-vacation balance. The UI marks the configuration as requiring review instead of guessing 20 or 26 days from incomplete history.

The implementation must include a migration review that shows how many employees, balances, and requests are affected before production deployment.

## Permissions

- ADMIN can configure entitlement, create balance corrections, use monthly views, and edit scoped time data.
- MANAGER can use both monthly time modes only for employees already visible under the existing HR access policy.
- MANAGER cannot change entitlement configuration or create leave-balance corrections.
- EMPLOYEE behavior and routes remain unchanged except that valid UB/VLD requests follow the corrected leave rules.
- APIs enforce permissions independently of UI visibility.

## Validation And Failure Handling

- A custom entitlement must be a whole number from 1 to 365, enforced consistently by UI and API.
- Employment fraction must be greater than zero and no greater than one.
- Effective dates must be valid calendar dates.
- A balance correction requires a non-empty reason.
- UB never triggers insufficient-balance validation.
- VLD cannot exceed four days per calendar year and cannot exceed the available VL pool.
- Batch time operations report conflicts per date.
- Unsaved monthly employee edits trigger a confirmation before period, employee, or mode changes.
- Duplicate submissions never create a second employee/date time entry. The API updates the intended existing entry or returns a row-level conflict.

## Testing

### Leave Unit And Route Tests

- entitlement resolution for 20, 26, custom, fractions, effective dates, and rounding;
- behavior for employees without a configuration;
- corrections require reason and preserve requests;
- correction audit records include before/after values and actor;
- UB bypasses balance checks but requires approval;
- sick leave bypasses balance checks;
- VLD consumes VL and enforces the four-day annual sublimit;
- pending and approved requests reserve the correct pool;
- ADMIN versus MANAGER permission boundaries.

### Time Tracking Unit And Route Tests

- month range generation across 28, 29, 30, and 31-day months;
- ADMIN and MANAGER employee scoping;
- leave and holiday overlays;
- batch inline edits with full and partial success;
- fill preview and save use identical eligibility rules;
- existing-entry, weekend, holiday, and approved-leave skip behavior;
- overwrite mode remains explicit;
- employee/date uniqueness.

### UI And End-To-End Checks

- URL state survives refresh and browser navigation;
- week/month and team/employee controls work;
- 31-day team grid scrolls with the employee column fixed;
- inline dirty state, save count, validation, partial error, and navigation warning work;
- existing modal still opens from weekly and monthly cells;
- responsive checks cover desktop and mobile widths without overlap or clipped control text;
- current weekly ADMIN/MANAGER and EMPLOYEE workflows remain functional.

Before completion, run focused HR tests, the full test suite, production build, the Impeccable detector against changed UI targets, and Playwright visual checks for monthly team and employee modes.

## Acceptance Criteria

1. ADMIN can configure 20, 26, or custom paid-vacation entitlement, fraction, effective date, and note for an employee.
2. Any balance-changing correction records a required reason, actor, timestamp, and before/after values.
3. Existing leave requests and balances survive migration.
4. UB can be requested with zero balance and always enters the approval workflow.
5. VLD consumes VL and is blocked after the annual 4-day sublimit or when VL is insufficient.
6. ADMIN and MANAGER can switch between weekly and both monthly views without losing URL state.
7. Monthly team mode displays the entire month with scoped employees and opens the existing edit modal.
8. Monthly employee mode supports direct multi-row time editing and one batch save.
9. `Wypełnij dni robocze` previews changes, fills empty eligible days, and skips weekends, holidays, approved leave, and existing entries by default.
10. Existing permission boundaries, employee dashboard, weekly view, and production records do not regress.

## Anti-Goals

- No automatic legal seniority calculator based on education, previous employment, B2B, or civil contracts.
- No redesign of the HR navigation or the WallDecor dashboard identity.
- No replacement of the existing time-entry modal, approvals, reports, or employee clock workflow.
- No silent recalculation of historical leave usage.
- No automatic overwrite of existing time entries.
- No payroll calculation or employment-law advisory engine.
