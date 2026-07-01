# Cost Control And Break-Even Design

## Context

WallDecor App has an existing finance area with cost assumptions, actuals, company health reporting, and a KSeF inbox. The current cost assumptions model started as a replacement for Excel: categories, subcategories, monthly planned values, and monthly actual values.

That model is no longer the right foundation. The business needs control over real costs, supplier behavior, unpaid invoices, and salon-level break-even. Many costs cannot be usefully forecast month by month because they depend on real turnover: contractors, installation work, goods, transport, commissions, and other variable costs.

The product direction is to replace "monthly cost planning" as the center of the module with cost control based on real events.

## Product Direction

The redesigned finance cost module should answer these questions:

- How much does Jagiellońska cost in a selected period?
- How much does Puławska cost in a selected period?
- What turnover does each salon need to reach break-even?
- Which suppliers and contractors generate the most cost?
- How much did we buy from a specific supplier?
- Which KSeF invoices still need classification?
- Which invoices remain unpaid?
- Which costs are fixed, variable, COGS, one-off, or operational?

The module should become a cost control and financial condition tool, not a manual monthly forecasting spreadsheet.

## Decisions

- Source of truth: invoices and manual cost events, not monthly aggregate tables.
- Cost classification: dimensional tags plus reporting rules.
- Salon split: a separate allocation mechanism, not ordinary tags.
- Invoice detail: whole invoices have default classification, but invoices can be manually split into cost parts.
- Planning: remove monthly cost budget as a v1 core concept. Keep reporting and break-even based on actual costs.
- Salons: use full names in the UI: `Jagiellońska` and `Puławska`. Technical codes may remain `JAG` and `PUL`.
- Payments: allow invoices to be marked as paid so KSeF can show total invoices and remaining amount to pay.

## Source Of Truth

The source of truth for costs is:

- KSeF invoices.
- Manual cost events, such as payroll, stock adjustments, card expenses, costs without KSeF invoices, or accounting corrections.
- Supplier rules and classification rules.
- Payment state for invoices.

Existing monthly `BudgetEntry` and `ActualEntry` style aggregates should stop being the primary model for cost control. If monthly numbers are needed, they should be computed from cost events and their allocations.

## Cost Event Model

A cost event is one financial event that affects cost reporting. It can come from KSeF or be entered manually.

Each cost event should have:

- Date.
- Source: KSeF or manual.
- Supplier or source name.
- Supplier NIP when available.
- Invoice number or manual reference.
- Gross, net, VAT, and currency where available.
- Payment status.
- Payment due date when available.
- Classification status.
- Tags.
- Allocation to salons.
- Optional parts when the event needs to be split.

Classification statuses:

- `needs_decision`: imported or entered, but not fully classified.
- `approved`: classified and included in reporting.
- `ignored`: excluded from normal reporting.

Payment statuses:

- `unpaid`: default for imported invoices.
- `paid`: user marked the invoice as paid.

V1 should keep payment handling intentionally simple: a paid/unpaid toggle, optional paid date, and optional due date. Partial payments can be added later if needed.

Payment due date should be extracted from KSeF invoice XML when available. If the app cannot extract it confidently, the user should be able to enter or edit it manually.

Unpaid invoices should be grouped into payment aging buckets:

- Overdue.
- Due in 0-7 days.
- Due in 8-14 days.
- Due in 15-30 days.
- Later than 30 days.
- Missing due date.

Each bucket should show both invoice count and gross amount.

## Invoice Parts

Most invoices should be classified as a whole. When an invoice is mixed, the user can split it manually into parts.

Example:

| Part | Amount | Tags | Allocation |
| --- | ---: | --- | --- |
| Goods | 7000 PLN | `cost`, `wallpapers`, `goods` | Jagiellońska 50% / Puławska 50% |
| Installation | 2000 PLN | `cost`, `stucco`, `contractors` | Jagiellońska 100% |
| Transport | 1000 PLN | `cost`, `transport` | Jagiellońska 50% / Puławska 50% |

The sum of parts must equal the invoice amount. If an invoice is split, reporting should use the parts instead of the invoice-level classification.

## Dimensional Tags

Tags should be controlled by groups. The system should not become one flat tag bag.

Initial tag groups:

- Cost behavior: fixed, variable, COGS, one-off.
- Area: wallpapers, stucco, rugs, installation, administration.
- Role: contractors, goods, marketing, rent, transport, payroll.
- Supplier group: optional grouping for contractors, strategic suppliers, or specific reporting needs.

Tags describe what the cost is. They do not describe salon allocation.

## Allocation

Allocation decides how a cost affects salons.

V1 allocation methods:

- Jagiellońska 100%.
- Puławska 100%.
- Fixed percentage split, for example 70/30 or 50/50.
- Revenue-based split.
- Manual split on invoice parts.

Default allocation can come from a supplier rule or tag rule. Individual invoices and invoice parts can override the default.

## Supplier Rules

Supplier rules classify future invoices automatically.

A supplier rule should match by:

- Supplier NIP.
- Supplier name pattern.

A supplier rule can set:

- Default tags.
- Default allocation.
- Optional default note.
- Whether to apply the rule to existing unapproved invoices from the same supplier.

When a new supplier appears in KSeF, the user should be able to create a rule from the inbox instead of leaving the screen.

## Reporting Rules

Reporting rules translate tags and allocations into business reports.

Examples:

- COGS = approved cost events tagged `COGS`.
- Fixed costs = approved cost events tagged `fixed`, excluding `one-off`.
- Contractors = approved cost events tagged `contractors`.
- Supplier spend = approved cost events grouped by supplier name or NIP.
- Jagiellońska break-even = Jagiellońska fixed costs divided by contribution margin assumptions.
- Puławska break-even = Puławska fixed costs divided by contribution margin assumptions.

One invoice can contribute to multiple views because tags are dimensions, not a single category.

## Filtering Strategy

Filtering should be a first-class part of the module. The same filter model should power KSeF inbox, approved cost events, and reporting drill-downs.

Core filters:

- Period: date range and month shortcuts.
- Supplier: search by supplier name or NIP.
- Payment: paid, unpaid, all.
- Payment deadline: overdue, 0-7 days, 8-14 days, 15-30 days, later, missing due date.
- Classification: needs decision, approved, ignored, all.
- Amount: gross amount from/to.
- Source: KSeF or manual.
- Tags: multi-select by tag group.
- Allocation: Jagiellońska, Puławska, shared, revenue-based, manual.
- Rule source: auto-classified, manually edited, no rule.

Fast use cases:

- "How much cost does contractor X generate?"
  - Filter supplier or supplier group, tag `contractors`, selected period.
- "How much did we buy from supplier X?"
  - Filter supplier name or NIP, selected period.
- "What remains unpaid?"
  - Filter payment `unpaid`, selected period.
- "What payments are urgent?"
  - Filter payment `unpaid` and deadline bucket `overdue`, `0-7 days`, `8-14 days`, or `15-30 days`.
- "Which invoices still need attention?"
  - Filter classification `needs_decision`.
- "How much did Jagiellońska absorb?"
  - Filter allocation includes Jagiellońska and show allocated totals.

Filtered lists should always show totals for the active filter. If no filter is active, totals represent the current selected period.

## KSeF Inbox UI

The KSeF inbox remains the operational screen for imported invoices.

It should support:

- Pagination and page size controls.
- Search by supplier name or NIP.
- Amount range filters.
- Classification filters.
- Payment filters.
- Payment deadline filters.
- Tag filters.
- Invoice preview.
- Supplier rule creation.
- Inline classification.
- Manual split into parts.
- Paid/unpaid toggle.

Bottom summary bar:

- Total invoice amount for the active filter.
- Remaining unpaid amount for the active filter.
- Unpaid aging buckets for the active filter: overdue, 0-7 days, 8-14 days, 15-30 days.

These summaries give a quick view of current invoice load and short-term cash pressure without requiring access to Subiekt GT.
The aging buckets add operational visibility: how many invoices and how much value is overdue or coming due soon.

## Approved Cost Events UI

The approved cost events screen should show the clean ledger of real costs after classification.

It should support:

- The same filters as KSeF.
- Group by supplier, tag, salon, month, or payment status.
- Drill-down from report totals to source events.
- Editing tags and allocation when corrections are needed.
- Adding manual cost events.

This screen replaces the mental model of monthly actual-entry aggregates.

## Break-Even UI

Break-even should compare salons using real allocated costs.

For each selected period, show:

- Revenue by salon.
- Fixed costs by salon.
- Variable costs by salon.
- COGS by salon.
- Contribution margin.
- Break-even turnover.
- Actual turnover above or below break-even.
- One-off costs separately, so they do not distort normal operating view.

The first version should focus on Jagiellońska and Puławska, but the data model should allow more salons later.

## Non-Goals For V1

- No detailed monthly cost forecasting grid as a primary workflow.
- No automatic bank reconciliation.
- No Subiekt GT integration for payment state.
- No mandatory line-by-line KSeF item classification.
- No complex partial payment ledger unless it becomes necessary after using the paid/unpaid toggle.

## Migration Strategy

The existing KSeF invoices should be preserved.

Existing category/subcategory mappings can be converted into initial tags where practical:

- Account category becomes a high-level tag or reporting rule.
- Subcategory becomes an area or role tag.
- Existing supplier rules become supplier classification rules with default tags and allocation.

Existing actual entries should be treated as historical aggregates. New reporting should prefer event-based data from KSeF and manual cost events.

## Testing Strategy

Unit tests should cover:

- Tag matching and reporting-rule calculations.
- Supplier rule matching by NIP and name.
- Allocation calculations.
- Invoice split validation.
- Paid/unpaid totals.
- Filtering logic.

Integration tests should cover:

- KSeF invoice import preserving payment and classification defaults.
- Applying a supplier rule to existing unapproved invoices.
- Approving an invoice and seeing it appear in cost events and break-even totals.
- Marking invoices as paid and verifying unpaid totals.
- Payment aging buckets based on due date.

UI tests should cover:

- Filtering by supplier name and NIP.
- Filtering unpaid invoices.
- Editing classification.
- Splitting an invoice.
- Bottom summary totals in KSeF.

## Open Implementation Notes

- Use event-based reporting for new cost-control views.
- Keep existing KSeF inbox improvements and extend them instead of rebuilding from scratch.
- Preserve existing cost center models where possible, but rename presentation to Jagiellońska and Puławska.
- Avoid destructive migration of historical budget data until the new event model is validated in use.
