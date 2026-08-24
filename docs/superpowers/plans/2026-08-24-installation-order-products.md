# Installation Order Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global SKU workflow with configurable work types and optional order-scoped products, while storing rectangle and linear/count measurements directly under each work scope.

**Architecture:** Keep the historical catalog tables and snapshots readable, but use `InstallationCatalogCategory` as the active work-type dictionary. Extend the order-owned scope, product, and measurement records additively, then update only the installation catalog/API/editor/presenter paths that consume those records. Existing public-form logic, calendar logic, CRM, HR, finance, and unrelated pages remain unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 5 with SQLite, Zod 4, Vitest, Testing Library.

---

## File map and ownership

- `prisma/schema.prisma` — additive relations and optional order-product/rectangle fields.
- `prisma/migrations/20260824230000_installation_order_products/migration.sql` — data-preserving SQLite migration.
- `src/lib/installations/catalog-service.ts` — work-type scope creation, direct order products, measurement validation and audit.
- `src/app/api/installations/[id]/rooms/[roomId]/scopes/[scopeId]/products/[scopeProductId]/route.ts` — add product editing without changing unrelated route contracts.
- `src/lib/installations/installer-room-presenter.ts` — expose only the new work-safe product and measurement fields to assigned installers.
- `src/lib/installations/client-link.ts` — keep the existing read-only public context valid when a product has no name.
- `src/components/installations/catalog-manager.tsx` — flat work-type dictionary UI; no global SKU editor.
- `src/components/installations/room-scope-editor.tsx` — work-type selection, direct product fields and measurements nested inside scopes.
- `__tests__/integration/installations/installation-order-products.test.ts` — focused service and persistence behavior.
- `__tests__/integration/installations/installation-order-products-migration.test.ts` — old-data migration and SQLite integrity.
- `__tests__/unit/installations/room-scope-editor.test.tsx` — focused user-flow assertions for the changed editor.
- `__tests__/unit/installations/catalog-work-types-ui.test.tsx` — focused assertions for the simplified catalog.
- `__tests__/unit/installations/scope-product-routes.test.ts` — focused authorization, membership and PATCH response behavior.
- Existing installation tests are changed only where their fixture types must include the new nullable fields.

Do not edit or retest calendar synchronization, client reminders, CRM, HR,
finance, media storage, completion protocols, or unrelated application pages.

### Task 1: Add the compatible persistence model

**Owner:** Terra

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260824230000_installation_order_products/migration.sql`
- Create: `__tests__/integration/installations/installation-order-products-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create a temporary SQLite database from migrations ending immediately before
the new migration. Seed one category/type/catalog product, one room/scope,
one `InstallationScopeProduct` with all historical snapshot fields, and one
single measurement. Apply the new migration and assert:

```ts
expect(migratedScope).toMatchObject({
  name: 'Tapetowanie',
  catalogCategoryId: null,
})
expect(migratedProduct).toMatchObject({
  catalogProductId: legacyCatalogProductId,
  productNameSnapshot: 'Legacy Tapeta',
  batchSnapshot: null,
})
expect(migratedMeasurement).toMatchObject({
  kind: 'SINGLE',
  secondaryValue: null,
})
expect(integrityCheck).toEqual([{ integrity_check: 'ok' }])
expect(foreignKeyCheck).toEqual([])
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
npm test -- __tests__/integration/installations/installation-order-products-migration.test.ts
```

Expected: failure because the migration, `catalogCategoryId`, `batchSnapshot`,
`kind`, and `secondaryValue` do not exist.

- [ ] **Step 3: Extend the Prisma schema additively**

Add the following relationships and fields without deleting legacy models:

Add these exact fields to the named existing models:

```prisma
// InstallationCatalogCategory
scopes InstallationScope[]

// InstallationScope
catalogCategoryId String?
catalogCategory   InstallationCatalogCategory? @relation(fields: [catalogCategoryId], references: [id], onDelete: SetNull)
@@index([catalogCategoryId])

// InstallationScopeProduct: replace the two required declarations
catalogProductId    String?
catalogProduct      InstallationCatalogProduct? @relation(fields: [catalogProductId], references: [id], onDelete: Restrict)
productNameSnapshot String?
batchSnapshot       String?

// InstallationMeasurement
kind           String  @default("SINGLE")
secondaryValue Decimal?
```

- [ ] **Step 4: Create and inspect the SQLite migration**

Create `20260824230000_installation_order_products/migration.sql`. Because
SQLite may rebuild tables to loosen `NOT NULL`, the SQL must copy every old
column and row into the replacement tables, preserve foreign keys and indexes,
set existing measurements to `SINGLE`, and leave every old
`catalogProductId` intact. The migration must not drop catalog category, type,
or product data.

Run:

```bash
npx prisma generate
npx prisma validate
npm test -- __tests__/integration/installations/installation-order-products-migration.test.ts
```

Expected: Prisma validation succeeds and the focused migration test passes with
`integrity_check=ok` and no foreign-key violations.

- [ ] **Step 5: Commit the persistence task**

```bash
git add prisma/schema.prisma prisma/migrations/20260824230000_installation_order_products/migration.sql __tests__/integration/installations/installation-order-products-migration.test.ts
git commit -m "feat: add order-owned installation products"
```

### Task 2: Implement work-type, product and measurement behavior

**Owner:** Terra

**Files:**
- Modify: `src/lib/installations/catalog-service.ts`
- Modify: `src/app/api/installations/[id]/rooms/[roomId]/scopes/[scopeId]/products/[scopeProductId]/route.ts`
- Modify: `src/lib/installations/installer-room-presenter.ts`
- Modify: `src/lib/installations/client-link.ts`
- Create: `__tests__/integration/installations/installation-order-products.test.ts`
- Create: `__tests__/unit/installations/scope-product-routes.test.ts`
- Modify only fixture contracts as necessary in:
  - `__tests__/unit/installations/measurement-routes.test.ts`
  - `__tests__/unit/installations/installer-room-presenter.test.ts`
  - `__tests__/unit/installations/installer-privacy-routes.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover these exact behaviors:

```ts
it('creates a scope from an active work type and snapshots its name')
it('rejects an archived work type for a new scope')
it('creates an order product without a catalog product')
it('accepts any one non-empty product field and trims empty fields to null')
it('does not create a record for a completely empty product form')
it('updates order product fields including batch and audits before and after')
it('rejects an update based on a stale product updatedAt value')
it('keeps creating legacy products from catalogProductId for compatibility')
it('stores width and height in one RECTANGLE measurement')
it('rejects a RECTANGLE without height or with M2, MB or SZT')
it('stores MB and SZT only for SINGLE measurements')
it('moves a legacy room measurement into a scope in the same room')
it('rejects a measurement scope from another room')
it('PATCH authorizes the editor, verifies scope membership and surfaces 409')
```

Representative assertions:

```ts
expect(product).toMatchObject({
  catalogProductId: null,
  productNameSnapshot: 'Archipel',
  manufacturerSnapshot: 'Casamance',
  productCodeSnapshot: '70070070',
  collectionSnapshot: 'Archipel',
  batchSnapshot: '000392829',
})
expect(rectangle).toMatchObject({
  kind: 'RECTANGLE',
  unit: 'CM',
  scopeId: scope.id,
})
expect(rectangle.value.toString()).toBe('400')
expect(rectangle.secondaryValue?.toString()).toBe('320')
```

- [ ] **Step 2: Run the service tests and verify RED**

```bash
npm test -- __tests__/integration/installations/installation-order-products.test.ts
```

Expected: failures from the old required `catalogProductId`, missing product
update, missing work-type relation, and missing rectangle fields.

- [ ] **Step 3: Implement scope and direct-product validation**

`createInstallationScope` accepts either the legacy `name` or an active
`catalogCategoryId`. For the new path it reads the category inside the same
transaction and writes both `catalogCategoryId` and the normalized category
name snapshot. It rejects missing/inactive categories.

`addInstallationScopeProduct` accepts either the legacy `catalogProductId` or
these nullable order fields:

```ts
{
  productNameSnapshot?: string | null
  productCodeSnapshot?: string | null
  manufacturerSnapshot?: string | null
  collectionSnapshot?: string | null
  batchSnapshot?: string | null
  sortOrder?: number
}
```

Trim whitespace and convert empty strings to `null`. If every order field and
`catalogProductId` is empty, return `null` before creating or auditing a row.
Keep the existing legacy snapshot behavior when `catalogProductId` is present.

Add `updateInstallationScopeProduct`, validating the final merged state so an
existing row cannot become completely empty. Its input includes the last
`updatedAt` seen by the editor. Update with an `id + updatedAt` guard; zero
updated rows produces status 409 with `Karta została zmieniona. Odśwież dane i
spróbuj ponownie.` Audit full before/after product snapshots including batch.

- [ ] **Step 4: Add the product PATCH route**

In the existing dynamic product route, keep Next.js 16 params as a Promise and
add:

Update the route import to include `InstallationCatalogValidationError` and
`updateInstallationScopeProduct`, then add this handler:

```ts
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId, scopeId, scopeProductId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  const room = await roomInInstallationOrder(id, roomId)
  const scope = room?.scopes.find((candidate) => candidate.id === scopeId)
  if (!scope?.scopeProducts.some((product) => product.id === scopeProductId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    return NextResponse.json(await updateInstallationScopeProduct(
      prisma,
      scopeProductId,
      await req.json(),
      session.user.id,
    ))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    }
    throw error
  }
}
```

Return the existing Polish validation-error shape and do not broaden role
permissions.

- [ ] **Step 5: Implement measurement variants**

Accept canonical values:

```ts
type SingleMeasurementInput = {
  kind?: 'SINGLE'
  elementName: string
  value: string
  secondaryValue?: null
  unit: 'MM' | 'CM' | 'M' | 'M2' | 'MB' | 'SZT'
  scopeId?: string | null
}

type RectangleMeasurementInput = {
  kind: 'RECTANGLE'
  elementName: string
  value: string
  secondaryValue: string
  unit: 'MM' | 'CM' | 'M'
  scopeId?: string | null
}
```

Every numeric value must be a positive decimal text without exponent notation.
On update, validate the complete resulting record. Switching to `SINGLE` clears
`secondaryValue`; switching to `RECTANGLE` requires it. Extend audit snapshots
with `kind` and `secondaryValue`.

- [ ] **Step 6: Update the installer presenter allowlist**

Expose only work-safe fields:

```ts
product: {
  id, productNameSnapshot, productCodeSnapshot,
  manufacturerSnapshot, collectionSnapshot, batchSnapshot, sortOrder
}
measurement: {
  id, elementName, kind, value, secondaryValue, unit
}
```

Do not expose catalog IDs, provenance, actors, prices, CRM data, or unrelated
room data. Update only tests whose typed fixtures need these fields.

In `loadPublicInstallationProjection`, keep the existing read-only product
context but guarantee its public `name` remains a string:

```ts
name: product.productNameSnapshot
  ?? product.productCodeSnapshot
  ?? product.manufacturerSnapshot
  ?? 'Produkt bez nazwy',
```

- [ ] **Step 7: Run focused backend tests**

```bash
npm test -- __tests__/integration/installations/installation-order-products.test.ts __tests__/unit/installations/scope-product-routes.test.ts __tests__/unit/installations/measurement-routes.test.ts __tests__/unit/installations/installer-room-presenter.test.ts __tests__/unit/installations/installer-privacy-routes.test.ts
```

Expected: all listed tests pass; no other suites are run.

- [ ] **Step 8: Commit the backend task**

```bash
git add src/lib/installations/catalog-service.ts src/app/api/installations/[id]/rooms/[roomId]/scopes/[scopeId]/products/[scopeProductId]/route.ts src/lib/installations/installer-room-presenter.ts src/lib/installations/client-link.ts __tests__/integration/installations/installation-order-products.test.ts __tests__/unit/installations/scope-product-routes.test.ts __tests__/unit/installations/measurement-routes.test.ts __tests__/unit/installations/installer-room-presenter.test.ts __tests__/unit/installations/installer-privacy-routes.test.ts
git commit -m "feat: manage products and measurements per work scope"
```

### Task 3: Build the approved catalog and order-card interface

**Owner:** Luna

**Files:**
- Modify: `src/components/installations/catalog-manager.tsx`
- Modify: `src/components/installations/room-scope-editor.tsx`
- Create: `__tests__/unit/installations/catalog-work-types-ui.test.tsx`
- Create: `__tests__/unit/installations/room-scope-editor.test.tsx`
- Modify only directly affected assertions in `__tests__/unit/installations/task2-corrective-ui.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Catalog test assertions:

```ts
expect(screen.getByRole('heading', { name: 'Rodzaje prac' })).toBeInTheDocument()
expect(screen.getByLabelText('Nowy rodzaj pracy')).toBeInTheDocument()
expect(screen.queryByPlaceholderText('Nazwa produktu')).not.toBeInTheDocument()
expect(screen.queryByText('Dodaj typ')).not.toBeInTheDocument()
```

Room editor test assertions:

```ts
expect(screen.getByRole('option', { name: 'Tapetowanie' })).toBeInTheDocument()
expect(screen.getByLabelText('Nazwa produktu w Tapetowanie')).toBeInTheDocument()
expect(screen.getByLabelText('Numer partii w Tapetowanie')).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Szerokość × wysokość' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Długość / ilość' })).toBeInTheDocument()
```

Use `userEvent` to verify the outgoing request bodies for a direct product,
`RECTANGLE`, and `SINGLE` with `MB`. Also render one legacy room measurement
and assert it appears under `Pomiary ogólne pomieszczenia`.

- [ ] **Step 2: Run the UI tests and verify RED**

```bash
npm test -- __tests__/unit/installations/catalog-work-types-ui.test.tsx __tests__/unit/installations/room-scope-editor.test.tsx
```

Expected: failures because the old global product picker and room-level
measurement form are still rendered.

- [ ] **Step 3: Simplify the catalog UI**

Render active categories as the flat `Rodzaje prac` list. Keep add, rename,
reorder and archive actions for categories. Do not render type/product forms or
legacy SKU rows in the normal catalog view. Keep the incoming nested data type
compatible so old database rows remain readable elsewhere.

Use the existing warm WallDecor surfaces, amber action color, spacing, focus
states and typography. Do not redesign the page shell or unrelated form
designer.

- [ ] **Step 4: Replace scope free text with work-type selection**

The new-scope control chooses an active category and posts:

```json
{ "catalogCategoryId": "category-id" }
```

Existing scopes remain editable/readable. The editor heading becomes
`Pokoje, zakresy, produkty i pomiary` and explains that product data belongs to
the order, not the global catalog. Deleting a scope that already contains
products or measurements requires an explicit confirmation.

- [ ] **Step 5: Add the optional direct-product editor**

Inside each scope render `Produkty` with five labelled fields: name,
manufacturer, code/SKU, collection/series and batch. Keep all fields optional.
Disable or no-op the add action while all fields are blank. Support multiple
saved rows, compact display, editing through PATCH with the row's `updatedAt`,
reordering and deletion. A 409 keeps the local values visible and tells the
user to refresh instead of silently overwriting a newer change.

Use fallback display order `name → code → manufacturer → Produkt bez nazwy`.
Do not show the old `Wybierz aktywny produkt` select.

- [ ] **Step 6: Nest the two measurement editors under each scope**

Each scope renders its own measurements immediately after products. The
default mode is `Szerokość × wysokość` with fields `Nazwa elementu`,
`Szerokość`, `Wysokość`, and one of `MM/CM/M`. The second mode is
`Długość / ilość` with one value and `MM/CM/M/M2/MB/SZT`.

Creation always sends the enclosing `scopeId`. Editing displays and updates the
correct variant. A rectangle is rendered as one line, for example
`Ściana za sofą — 400 × 320 CM`. Do not calculate or display derived m².

Render `room.measurements` only in a separate
`Pomiary ogólne pomieszczenia` section at the end of the room. Its editor may
assign an existing legacy measurement to one of the room scopes.

- [ ] **Step 7: Verify the responsive focused UI tests**

```bash
npm test -- __tests__/unit/installations/catalog-work-types-ui.test.tsx __tests__/unit/installations/room-scope-editor.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx
```

Expected: all listed tests pass, direct product and both measurement payloads
match the API contract, and no unrelated test suite is run.

- [ ] **Step 8: Commit the UI task**

```bash
git add src/components/installations/catalog-manager.tsx src/components/installations/room-scope-editor.tsx __tests__/unit/installations/catalog-work-types-ui.test.tsx __tests__/unit/installations/room-scope-editor.test.tsx __tests__/unit/installations/task2-corrective-ui.test.tsx
git commit -m "feat: simplify installation scope editor"
```

### Task 4: Integrate and perform short functional verification

**Owner:** Sol orchestration only

**Files:**
- No feature files edited by Sol.
- Update this plan's checkboxes only after evidence exists.

- [ ] **Step 1: Review the combined diff against the accepted design**

Confirm there are no edits outside the file map except generated Prisma client
artifacts required by this schema. Remove no user-owned or unrelated changes.

- [ ] **Step 2: Validate schema and migration**

```bash
npx prisma validate
npm test -- __tests__/integration/installations/installation-order-products-migration.test.ts
```

- [ ] **Step 3: Run only the focused changed-module tests**

```bash
npm test -- __tests__/integration/installations/installation-order-products.test.ts __tests__/unit/installations/scope-product-routes.test.ts __tests__/unit/installations/catalog-work-types-ui.test.tsx __tests__/unit/installations/room-scope-editor.test.tsx __tests__/unit/installations/measurement-routes.test.ts __tests__/unit/installations/installer-room-presenter.test.ts __tests__/unit/installations/installer-privacy-routes.test.ts __tests__/unit/installations/task2-corrective-ui.test.tsx
```

- [ ] **Step 4: Check changed files without running unrelated suites**

```bash
npx eslint src/components/installations/catalog-manager.tsx src/components/installations/room-scope-editor.tsx src/lib/installations/catalog-service.ts src/lib/installations/installer-room-presenter.ts 'src/app/api/installations/[id]/rooms/[roomId]/scopes/[scopeId]/products/[scopeProductId]/route.ts' __tests__/integration/installations/installation-order-products.test.ts __tests__/unit/installations/catalog-work-types-ui.test.tsx __tests__/unit/installations/room-scope-editor.test.tsx
git diff --check origin/main...HEAD
```

- [ ] **Step 5: Perform one short functional smoke flow**

On a disposable test database, verify this sequence through the real service/UI
boundary: create `Tapetowanie`, create `Salon → Tapetowanie`, add a product with
SKU and batch, add `400 × 320 CM`, add `18 MB`, reload, edit the batch, and
confirm all values remain nested under the correct scope. Verify that leaving
the product section empty creates no row and does not block the card.

Do not retest calendar, mail, CRM, HR, finance, media, protocols, or other
unmodified application functions.
