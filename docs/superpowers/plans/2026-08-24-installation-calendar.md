# Installation Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać do kart montażu wiele wizyt, przypisania instalatorów do zakresów oraz niezawodną, jednokierunkową synchronizację wizyt z firmowym Google Calendar `info@walldecor.pl`.

**Architecture:** Aplikacja i SQLite są źródłem prawdy. Każda potwierdzona zmiana wizyty zapisuje w tej samej transakcji trwały wpis outboxa; osobny worker przetwarza go przez wymienny adapter `fake` albo `google`. Google przechowuje jedno wydarzenie na wizytę, aktualizowane w miejscu z kontrolą `etag`, natomiast UI pokazuje status synchronizacji i jawne akcje naprawcze.

**Tech Stack:** Next.js 16.1, React 19, TypeScript strict, Prisma 5.22 + SQLite, Zod 4, Google Calendar API przez `googleapis`, `date-fns`/`date-fns-tz`, Vitest, Testing Library, Playwright, Coolify.

---

## Granice plików

- `visit-constants.ts` — literały stanów wizyty i synchronizacji.
- `visit-time.ts` — jedyna granica konwersji czasu lokalnego Warszawy i UTC.
- `visit-schemas.ts` — walidacja wejścia API bez dostępu do bazy.
- `scope-assignment-service.ts` — przypisania instalatorów do zakresów.
- `visit-service.ts` — transakcyjny cykl życia wizyty i zapis outboxa.
- `calendar-event.ts` — czysta projekcja wizyty do wydarzenia, bez I/O.
- `calendar-adapter.ts` — kontrakt adaptera oraz typowane błędy.
- `fake-calendar-adapter.ts` — deterministyczny adapter dla testów.
- `google-calendar-adapter.ts` — jedyne miejsce wywołań Google API.
- `calendar-config.ts` — walidacja zmiennych środowiskowych i readiness.
- `integration-outbox.ts` — claim/lease/retry/dead/requeue w SQLite.
- `calendar-worker.ts` — orkiestracja pojedynczego lub całego batcha.
- `installation-visits-panel.tsx` — formularze i lista wizyt na karcie.
- `installation-calendar-status.tsx` — mały, współdzielony status bez logiki I/O.

Nie przenosić wysyłki Gmail ani historii korespondencji do tych plików.

### Task 1: Trwały model wizyt, przypisań i outboxa

**Files:**
- Create: `prisma/migrations/20260824090000_installation_visits_calendar/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `__tests__/integration/installations/calendar-schema.test.ts`

- [ ] **Step 1: Napisać test migracji, który najpierw nie znajduje nowych tabel**

Test ma uruchomić pełny łańcuch `migration.sql` na tymczasowej bazie i sprawdzić dokładnie:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  'InstallationVisit',
  'InstallationVisitScope',
  'InstallationScopeAssignment',
  'IntegrationSyncState',
  'IntegrationOutbox',
  'IntegrationAttempt',
]))
expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
```

Test ma też spróbować zapisać wizytę z `endsAt <= startsAt` i oczekiwać błędu `CHECK constraint failed`.

- [ ] **Step 2: Uruchomić test i potwierdzić właściwy czerwony wynik**

Run:

```bash
npm test -- __tests__/integration/installations/calendar-schema.test.ts
```

Expected: FAIL, ponieważ tabela `InstallationVisit` jeszcze nie istnieje.

- [ ] **Step 3: Dodać modele Prisma**

Relacje w `prisma/schema.prisma` mają odpowiadać temu kontraktowi:

```prisma
model InstallationVisit {
  id          String   @id @default(cuid())
  orderId     String
  order       InstallationOrder @relation(fields: [orderId], references: [id], onDelete: Restrict)
  status      String   @default("DRAFT")
  startsAt    DateTime?
  endsAt      DateTime?
  timezone    String   @default("Europe/Warsaw")
  note        String?
  revision    Int      @default(1)
  confirmedAt DateTime?
  cancelledAt DateTime?
  completedAt DateTime?
  scopes      InstallationVisitScope[]
  syncStates  IntegrationSyncState[]
  outbox      IntegrationOutbox[]
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([orderId, status, startsAt])
}

model InstallationVisitScope {
  id      String @id @default(cuid())
  visitId String
  visit   InstallationVisit @relation(fields: [visitId], references: [id], onDelete: Restrict)
  orderId String
  order   InstallationOrder @relation(fields: [orderId], references: [id], onDelete: Restrict)
  scopeId String
  scope   InstallationScope @relation(fields: [scopeId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now())

  @@unique([visitId, scopeId])
  @@index([orderId, scopeId])
}

model InstallationScopeAssignment {
  id         String @id @default(cuid())
  orderId    String
  order      InstallationOrder @relation(fields: [orderId], references: [id], onDelete: Restrict)
  scopeId    String
  scope      InstallationScope @relation(fields: [scopeId], references: [id], onDelete: Restrict)
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  createdById String
  createdAt   DateTime @default(now())

  @@unique([scopeId, employeeId])
  @@index([orderId, employeeId])
}

model IntegrationSyncState {
  id             String @id @default(cuid())
  visitId        String
  visit          InstallationVisit @relation(fields: [visitId], references: [id], onDelete: Restrict)
  kind           String @default("GOOGLE_CALENDAR")
  status         String @default("NOT_REQUESTED")
  externalId     String?
  externalUrl    String?
  externalEtag   String?
  lastErrorCode  String?
  lastErrorMessage String?
  lastAttemptAt  DateTime?
  lastSyncedAt   DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([visitId, kind])
  @@unique([kind, externalId])
  @@index([status, updatedAt])
}

model IntegrationOutbox {
  id             String @id @default(cuid())
  visitId        String
  visit          InstallationVisit @relation(fields: [visitId], references: [id], onDelete: Restrict)
  operation      String
  revision       Int
  idempotencyKey String @unique
  status         String @default("PENDING")
  forceOverwrite Boolean @default(false)
  attemptCount   Int @default(0)
  availableAt    DateTime @default(now())
  lockedUntil    DateTime?
  completedAt    DateTime?
  lastErrorCode  String?
  lastErrorMessage String?
  attempts       IntegrationAttempt[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, availableAt, lockedUntil])
  @@index([visitId, revision])
}

model IntegrationAttempt {
  id          String @id @default(cuid())
  outboxId    String
  outbox      IntegrationOutbox @relation(fields: [outboxId], references: [id], onDelete: Restrict)
  number      Int
  outcome     String
  errorCode   String?
  durationMs  Int
  createdAt   DateTime @default(now())

  @@unique([outboxId, number])
  @@index([outboxId, createdAt])
}
```

Dodać odwrotne relacje do `Employee`, `InstallationOrder` i `InstallationScope`.

- [ ] **Step 4: Dodać SQL z kontrolą spójności między order/room/scope**

Migracja ma zawierać indeksy i triggery blokujące:

```sql
CREATE TRIGGER "InstallationVisit_time_insert_guard"
BEFORE INSERT ON "InstallationVisit"
WHEN ((NEW."startsAt" IS NULL) <> (NEW."endsAt" IS NULL))
  OR (NEW."startsAt" IS NOT NULL AND NEW."endsAt" <= NEW."startsAt")
BEGIN
  SELECT RAISE(ABORT, 'installation visit time range is invalid');
END;
```

Analogiczny trigger `BEFORE UPDATE` ma chronić edycję. Triggery dla
`InstallationVisitScope` i `InstallationScopeAssignment` mają porównać
`NEW.orderId` z `InstallationRoom.orderId` osiąganym przez `InstallationScope.roomId`.

- [ ] **Step 5: Wygenerować klienta i uruchomić test migracji**

Run:

```bash
npx prisma generate
npm test -- __tests__/integration/installations/calendar-schema.test.ts
```

Expected: PASS, `foreign_key_check=[]`, `integrity_check=ok`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260824090000_installation_visits_calendar/migration.sql __tests__/integration/installations/calendar-schema.test.ts
git commit -m "feat: add installation visit calendar schema"
```

### Task 2: Literały, czas Warszawy i walidacja wejścia

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/installations/visit-constants.ts`
- Create: `src/lib/installations/visit-time.ts`
- Create: `src/lib/installations/visit-schemas.ts`
- Create: `__tests__/unit/installations/visit-schemas.test.ts`
- Create: `__tests__/unit/installations/visit-time.test.ts`

- [ ] **Step 1: Zainstalować biblioteki czasu z zapisem w lockfile**

```bash
npm install date-fns date-fns-tz
```

- [ ] **Step 2: Napisać czerwone testy stałych i czasu**

Testy mają wymagać:

```ts
expect(INSTALLATION_VISIT_STATUSES).toEqual(['DRAFT', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
expect(INTEGRATION_SYNC_STATUSES).toEqual(['NOT_REQUESTED', 'PENDING', 'SYNCED', 'ATTENTION'])
expect(INTEGRATION_OUTBOX_STATUSES).toEqual(['PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD'])
expect(INTEGRATION_OUTBOX_OPERATIONS).toEqual(['CALENDAR_UPSERT', 'CALENDAR_CANCEL'])
expect(parseWarsawLocalDateTime('2026-07-15T08:00').toISOString()).toBe('2026-07-15T06:00:00.000Z')
expect(formatWarsawDateTime(new Date('2026-12-15T07:00:00.000Z'))).toBe('15.12.2026, 08:00')
```

Walidacja ma odrzucać: tylko jedną datę, `endsAt <= startsAt`, pustą listę
zakresów przy potwierdzeniu, nieznaną akcję i dodatkowe pola.

- [ ] **Step 3: Uruchomić testy i potwierdzić brak modułów**

```bash
npm test -- __tests__/unit/installations/visit-time.test.ts __tests__/unit/installations/visit-schemas.test.ts
```

Expected: FAIL z błędem importu nowych plików.

- [ ] **Step 4: Zaimplementować jedną granicę czasu i ścisłe schematy**

Eksportowane API ma mieć dokładnie te podpisy:

```ts
export const INSTALLATION_TIMEZONE = 'Europe/Warsaw' as const
export function parseWarsawLocalDateTime(value: string): Date
export function formatWarsawDateTime(value: Date | string): string
export function formatWarsawDateTimeInput(value: Date | string): string

export const createVisitSchema: z.ZodType<{
  startsAt?: Date
  endsAt?: Date
  note?: string
  scopeIds: string[]
}>

export const updateVisitActionSchema: z.DiscriminatedUnion<'action', [
  z.ZodObject<{ action: z.ZodLiteral<'SAVE_DRAFT'> }>,
  z.ZodObject<{ action: z.ZodLiteral<'CONFIRM'> }>,
  z.ZodObject<{ action: z.ZodLiteral<'CANCEL'> }>,
  z.ZodObject<{ action: z.ZodLiteral<'COMPLETE'> }>,
]>
```

`parseWarsawLocalDateTime` używa `fromZonedTime(value, INSTALLATION_TIMEZONE)` i
rzuca `InstallationVisitValidationError`, jeśli wejście nie przechodzi ścisłego
round-trip przez `formatInTimeZone`.

- [ ] **Step 5: Uruchomić testy**

```bash
npm test -- __tests__/unit/installations/visit-time.test.ts __tests__/unit/installations/visit-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/installations/visit-constants.ts src/lib/installations/visit-time.ts src/lib/installations/visit-schemas.ts __tests__/unit/installations/visit-time.test.ts __tests__/unit/installations/visit-schemas.test.ts
git commit -m "feat: validate installation visit scheduling"
```

### Task 3: Instalatorzy przypisani do zakresów

**Files:**
- Create: `src/lib/installations/scope-assignment-service.ts`
- Modify: `src/lib/installations/access.ts`
- Modify: `src/lib/installations/order-service.ts`
- Create: `__tests__/integration/installations/scope-assignments.test.ts`
- Modify: `__tests__/unit/installations/order-rules.test.ts`

- [ ] **Step 1: Napisać test przypisania i dostępu**

Scenariusz tworzy dwa zakresy i trzech pracowników, po czym wymaga:

```ts
await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerA.id], 'actor-1')
await setScopeInstallerAssignments(db, order.id, plasterScope.id, [installerB.id, installerC.id], 'actor-1')

expect(await listScopeInstallerAssignments(db, order.id)).toMatchObject([
  { scopeId: wallpaperScope.id, employeeIds: [installerA.id] },
  { scopeId: plasterScope.id, employeeIds: [installerB.id, installerC.id] },
])
expect(canViewInstallationOrder(installerViewer(installerA.id), loadedOrder)).toBe(true)
```

Test ma także potwierdzić `P2003`/błąd domenowy dla zakresu z innego zlecenia i
nieaktywnego pracownika.

- [ ] **Step 2: Uruchomić test i zobaczyć brak serwisu**

```bash
npm test -- __tests__/integration/installations/scope-assignments.test.ts __tests__/unit/installations/order-rules.test.ts
```

Expected: FAIL dla importu `scope-assignment-service`.

- [ ] **Step 3: Zaimplementować transakcyjne zastępowanie listy**

Publiczne API serwisu:

```ts
export async function setScopeInstallerAssignments(
  db: PrismaClient,
  orderId: string,
  scopeId: string,
  employeeIds: string[],
  actorId: string,
): Promise<ScopeAssignmentView>

export async function listScopeInstallerAssignments(
  db: PrismaClient | Prisma.TransactionClient,
  orderId: string,
): Promise<ScopeAssignmentView[]>
```

W jednej transakcji serwis ma: sprawdzić własność zakresu, pobrać wyłącznie
aktywnych pracowników, znormalizować i zdeduplikować ID, wykonać `deleteMany` i
`createMany`, a następnie zapisać `InstallationAuditEvent` z akcją
`INSTALLATION_SCOPE_ASSIGNMENTS_CHANGED`.

- [ ] **Step 4: Rozszerzyć politykę widoczności bez usuwania istniejącego mechanizmu**

`InstallationOrderAccessRecord` otrzymuje:

```ts
scopeAssignments: Array<{ employeeId: string }>
```

Rola `INSTALLER` widzi kartę, jeśli występuje w `installerAssignments` albo
`scopeAssignments`. `orderInclude` i `orderListSelect` muszą pobrać obie relacje.

- [ ] **Step 5: Uruchomić testy**

```bash
npm test -- __tests__/integration/installations/scope-assignments.test.ts __tests__/unit/installations/order-rules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/installations/scope-assignment-service.ts src/lib/installations/access.ts src/lib/installations/order-service.ts __tests__/integration/installations/scope-assignments.test.ts __tests__/unit/installations/order-rules.test.ts
git commit -m "feat: assign installers to installation scopes"
```

### Task 4: Cykl życia wizyty i transakcyjny outbox

**Files:**
- Create: `src/lib/installations/visit-service.ts`
- Create: `__tests__/integration/installations/visit-service.test.ts`

- [ ] **Step 1: Napisać czerwony test domenowy**

Test ma sprawdzić kolejno:

```ts
const draft = await createInstallationVisit(db, order.id, {
  scopeIds: [wallpaperScope.id], note: 'Tapety tekstylne',
}, 'owner-user')
expect(draft.status).toBe('DRAFT')
expect(await db.integrationOutbox.count()).toBe(0)

const confirmed = await changeInstallationVisit(db, order.id, draft.id, {
  action: 'CONFIRM',
  expectedRevision: 1,
  startsAt: '2026-09-14T06:00:00.000Z',
  endsAt: '2026-09-14T14:00:00.000Z',
  scopeIds: [wallpaperScope.id],
}, 'owner-user')
expect(confirmed.revision).toBe(2)
expect(await db.integrationOutbox.findMany()).toMatchObject([
  { operation: 'CALENDAR_UPSERT', revision: 2, status: 'PENDING' },
])
```

Kolejna zmiana potwierdzonej wizyty z `expectedRevision: 2` ma utworzyć rewizję
3. Anulowanie ma utworzyć `CALENDAR_CANCEL`. Powtórzenie starej komendy z
`expectedRevision: 1` ma zwrócić `InstallationVisitRevisionConflictError` i nie
może utworzyć drugiego outboxa.

- [ ] **Step 2: Uruchomić test i potwierdzić brak implementacji**

```bash
npm test -- __tests__/integration/installations/visit-service.test.ts
```

Expected: FAIL dla importu `visit-service`.

- [ ] **Step 3: Zaimplementować publiczne API serwisu**

```ts
export async function listInstallationVisits(db: InstallationDb, orderId: string): Promise<InstallationVisitView[]>
export async function createInstallationVisit(db: PrismaClient, orderId: string, input: unknown, actorId: string): Promise<InstallationVisitView>
export async function changeInstallationVisit(db: PrismaClient, orderId: string, visitId: string, input: unknown, actorId: string): Promise<InstallationVisitView>
export async function requeueInstallationCalendar(db: PrismaClient, orderId: string, visitId: string, forceOverwrite: boolean, actorId: string): Promise<InstallationVisitView>
```

`create` oraz `change` muszą w jednej `db.$transaction`:

1. sprawdzić, że karta nie jest zarchiwizowana;
2. sprawdzić wszystkie `scopeIds` względem `orderId`;
3. wymagać przynajmniej jednego aktywnego przypisania instalatora do wybranych
   zakresów przed `CONFIRM`;
4. porównać `expectedRevision` z rewizją w bazie i zwiększyć `revision` dokładnie raz;
5. utworzyć `IntegrationSyncState` przy pierwszej wizycie;
6. utworzyć outbox z kluczem
   ``calendar:${visitId}:${revision}:${operation}``;
7. zapisać `InstallationAuditEvent`.

Nie wykonywać wywołania Google wewnątrz requestu ani transakcji.

- [ ] **Step 4: Dodać ostrzeżenia dla uczestników bez e-maila**

Widok wizyty ma zwracać:

```ts
type InstallationVisitParticipant = {
  employeeId: string
  name: string
  email: string | null
  scopeIds: string[]
  inviteStatus: 'READY' | 'MISSING_EMAIL'
}
```

Brak e-maila jest ostrzeżeniem. Potwierdzenie jest blokowane tylko wtedy, gdy po
odrzuceniu pustych adresów nie pozostaje żaden uczestnik.

- [ ] **Step 5: Uruchomić test**

```bash
npm test -- __tests__/integration/installations/visit-service.test.ts
```

Expected: PASS, a ponowne otwarcie klienta Prisma zwraca te same wizyty i outbox.

- [ ] **Step 6: Commit**

```bash
git add src/lib/installations/visit-service.ts __tests__/integration/installations/visit-service.test.ts
git commit -m "feat: manage installation visit lifecycle"
```

### Task 5: API wizyt i przypisań z istniejącą polityką dostępu

**Files:**
- Create: `src/app/api/installations/[id]/scope-assignments/[scopeId]/route.ts`
- Create: `src/app/api/installations/[id]/visits/route.ts`
- Create: `src/app/api/installations/[id]/visits/[visitId]/route.ts`
- Create: `src/app/api/installations/[id]/visits/[visitId]/calendar/route.ts`
- Create: `__tests__/unit/installations/visit-routes.test.ts`

- [ ] **Step 1: Napisać testy kontraktu HTTP**

Test ma objąć `401`, `403`, `404`, błędny JSON `400`, błąd domenowy `400`, sukces
`200/201`, konflikt rewizji `409` i konflikt archiwizacji `409`. Minimalne
oczekiwanie Next 16:

```ts
const params = { params: Promise.resolve({ id: 'order-1', visitId: 'visit-1' }) }
expect(await PATCH(request, params)).toMatchObject({ status: 200 })
expect(mocks.changeVisit).toHaveBeenCalledWith(
  {}, 'order-1', 'visit-1', expect.objectContaining({ action: 'CONFIRM' }), 'user-1',
)
```

- [ ] **Step 2: Uruchomić test i potwierdzić brak tras**

```bash
npm test -- __tests__/unit/installations/visit-routes.test.ts
```

Expected: FAIL dla importów nowych route handlerów.

- [ ] **Step 3: Dodać route handlery z `params: Promise`**

Każdy handler ma wykonać:

```ts
const session = await getServerSession(authOptions)
if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const { id, visitId } = await params
const editable = await editableInstallationOrder(session, id)
if ('response' in editable) return editable.response
```

Rola `INSTALLER` ma tylko `GET` do przypisanej karty; tworzenie, edycja,
potwierdzanie i synchronizacja wymagają `canEditInstallationOrder`. Akcja force
overwrite konfliktu wymaga `ADMIN` albo `MANAGER`.

- [ ] **Step 4: Uruchomić testy tras**

```bash
npm test -- __tests__/unit/installations/visit-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/installations/[id]/scope-assignments/[scopeId]/route.ts' 'src/app/api/installations/[id]/visits/route.ts' 'src/app/api/installations/[id]/visits/[visitId]/route.ts' 'src/app/api/installations/[id]/visits/[visitId]/calendar/route.ts' __tests__/unit/installations/visit-routes.test.ts
git commit -m "feat: expose installation visit APIs"
```

### Task 6: Czysty model wydarzenia i deterministyczny fake adapter

**Files:**
- Create: `src/lib/installations/calendar-adapter.ts`
- Create: `src/lib/installations/calendar-event.ts`
- Create: `src/lib/installations/fake-calendar-adapter.ts`
- Create: `__tests__/unit/installations/calendar-event.test.ts`
- Create: `__tests__/unit/installations/fake-calendar-adapter.test.ts`

- [ ] **Step 1: Napisać test projekcji wydarzenia**

Test ma wymagać jednego uczestnika na znormalizowany adres oraz braku danych
formularza klienta:

```ts
expect(buildCalendarEvent(visit)).toMatchObject({
  summary: 'Montaż MON-20260824-0001 — Jan Kowalski',
  location: 'Puławska 17, 02-515 Warszawa',
  attendeeEmails: ['anna@example.pl', 'bartek@example.pl'],
  privateProperties: { wallDecorVisitId: 'visit-1' },
})
expect(JSON.stringify(buildCalendarEvent(visit))).not.toContain('drzwi_ukryte')
```

- [ ] **Step 2: Napisać test fake adaptera**

```ts
const created = await adapter.upsert({ event, externalId: null, etag: null, forceOverwrite: false })
const updated = await adapter.upsert({ event: changedEvent, externalId: created.eventId, etag: created.etag, forceOverwrite: false })
expect(updated.eventId).toBe(created.eventId)
expect(adapter.snapshot()).toHaveLength(1)
await adapter.cancel({ externalId: created.eventId, etag: updated.etag, forceOverwrite: false })
expect(adapter.snapshot()[0].cancelled).toBe(true)
```

- [ ] **Step 3: Uruchomić testy i potwierdzić brak adapterów**

```bash
npm test -- __tests__/unit/installations/calendar-event.test.ts __tests__/unit/installations/fake-calendar-adapter.test.ts
```

Expected: FAIL dla importów.

- [ ] **Step 4: Zaimplementować kontrakt adaptera**

```ts
export type CalendarWriteResult = { eventId: string; htmlLink: string; etag: string }

export interface InstallationCalendarAdapter {
  upsert(input: CalendarUpsertInput): Promise<CalendarWriteResult>
  cancel(input: CalendarCancelInput): Promise<void>
}

export class CalendarRetryableError extends Error { readonly code: string }
export class CalendarConflictError extends Error { readonly code = 'ETAG_CONFLICT' }
export class CalendarConfigurationError extends Error { readonly code = 'CONFIGURATION_ERROR' }
```

Fake `eventId` ma być stabilnym `wd` + SHA-256 z `visitId`, ograniczonym do
znaków `0-9a-v`. Każdy zapis zwiększa wersję `etag`, lecz nie zmienia `eventId`.

- [ ] **Step 5: Uruchomić testy**

```bash
npm test -- __tests__/unit/installations/calendar-event.test.ts __tests__/unit/installations/fake-calendar-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/installations/calendar-adapter.ts src/lib/installations/calendar-event.ts src/lib/installations/fake-calendar-adapter.ts __tests__/unit/installations/calendar-event.test.ts __tests__/unit/installations/fake-calendar-adapter.test.ts
git commit -m "feat: add installation calendar adapter contract"
```

### Task 7: Lease, retry, konflikt i worker outboxa

**Files:**
- Create: `src/lib/installations/integration-outbox.ts`
- Create: `src/lib/installations/calendar-worker.ts`
- Create: `__tests__/integration/installations/calendar-outbox.test.ts`

- [ ] **Step 1: Napisać test równoległego claimu**

Dwa wywołania `claimNextIntegrationJob` uruchomione przez dwa klienty Prisma mają
otrzymać najwyżej jeden ten sam rekord:

```ts
const claims = await Promise.all([
  claimNextIntegrationJob(dbA, now, 'worker-a'),
  claimNextIntegrationJob(dbB, now, 'worker-b'),
])
expect(claims.filter(Boolean)).toHaveLength(1)
```

Test ma również objąć odzyskanie wygasłej dzierżawy, retry po 429, `ATTENTION` po
403, konflikt `etag`, odrzucenie starej rewizji oraz requeue z
`forceOverwrite=true`.

- [ ] **Step 2: Uruchomić test i potwierdzić brak workera**

```bash
npm test -- __tests__/integration/installations/calendar-outbox.test.ts
```

Expected: FAIL dla importów.

- [ ] **Step 3: Zaimplementować atomowy claim SQLite**

`claimNextIntegrationJob` używa jednego `UPDATE … RETURNING`:

```sql
UPDATE "IntegrationOutbox"
SET "status"='PROCESSING', "lockedUntil"=?, "updatedAt"=?
WHERE "id"=(
  SELECT "id" FROM "IntegrationOutbox"
  WHERE ("status" IN ('PENDING','RETRY') OR ("status"='PROCESSING' AND "lockedUntil" < ?))
    AND "availableAt" <= ?
  ORDER BY "createdAt" ASC
  LIMIT 1
)
RETURNING *;
```

Nie wykonywać `findFirst` i osobnego `update`.

- [ ] **Step 4: Zaimplementować wynik próby i backoff**

Publiczne API:

```ts
export async function claimNextIntegrationJob(db: PrismaClient, now: Date, workerId: string): Promise<ClaimedIntegrationJob | null>
export async function processInstallationCalendarJob(db: PrismaClient, adapter: InstallationCalendarAdapter, job: ClaimedIntegrationJob, now?: Date): Promise<ProcessJobResult>
export async function processInstallationCalendarBatch(db: PrismaClient, adapter: InstallationCalendarAdapter, limit?: number): Promise<BatchResult>
```

Opóźnienie retry ma wynosić `min(3600, 2 ** attemptCount * 15)` sekund z
deterministycznym jitterem opartym o `outboxId`. Każda próba zapisuje
`IntegrationAttempt`; komunikat błędu jest obcinany do 500 znaków i nie zawiera
request headers ani sekretów.

- [ ] **Step 5: Obsłużyć konflikt świadomie**

`CalendarConflictError` ustawia sync na `ATTENTION`, outbox na `DEAD` i kod
`ETAG_CONFLICT`. `requeueInstallationCalendar(..., true, ...)` ponownie ustawia
ten sam rekord jako `PENDING`, a adapter w trybie force najpierw pobiera aktualny
`etag` i dopiero wykonuje patch.

- [ ] **Step 6: Uruchomić testy**

```bash
npm test -- __tests__/integration/installations/calendar-outbox.test.ts
```

Expected: PASS, również po rozłączeniu i ponownym utworzeniu PrismaClient.

- [ ] **Step 7: Commit**

```bash
git add src/lib/installations/integration-outbox.ts src/lib/installations/calendar-worker.ts __tests__/integration/installations/calendar-outbox.test.ts
git commit -m "feat: process calendar outbox reliably"
```

### Task 8: Produkcyjny adapter Google i readiness bez sekretów

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `src/lib/installations/calendar-config.ts`
- Create: `src/lib/installations/google-calendar-adapter.ts`
- Create: `src/app/api/settings/installation-calendar/route.ts`
- Create: `src/components/installations/calendar-settings-panel.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Create: `__tests__/unit/installations/google-calendar-adapter.test.ts`
- Create: `__tests__/unit/installations/calendar-settings-route.test.ts`

- [ ] **Step 1: Zainstalować oficjalnego klienta Google**

```bash
npm install googleapis
```

- [ ] **Step 2: Napisać testy bez prawdziwych danych Google**

Mock `google.calendar('v3')` ma sprawdzić:

```ts
expect(events.insert).toHaveBeenCalledWith(expect.objectContaining({
  calendarId: 'test-calendar@group.calendar.google.com',
  sendUpdates: 'all',
  requestBody: expect.objectContaining({
    attendees: [{ email: 'installer@example.pl' }],
    extendedProperties: { private: { wallDecorVisitId: 'visit-1' } },
  }),
}))
expect(events.patch).toHaveBeenCalledWith(
  expect.objectContaining({ eventId: created.eventId, sendUpdates: 'all' }),
  expect.objectContaining({ headers: { 'If-Match': 'etag-1' } }),
)
```

Test ma mapować 412 na `CalendarConflictError`, 429/500 na
`CalendarRetryableError`, 401/403 na `CalendarConfigurationError` i 404 podczas
anulowania na sukces idempotentny.

- [ ] **Step 3: Uruchomić testy i zobaczyć brak implementacji**

```bash
npm test -- __tests__/unit/installations/google-calendar-adapter.test.ts __tests__/unit/installations/calendar-settings-route.test.ts
```

Expected: FAIL dla importów.

- [ ] **Step 4: Zaimplementować bezpieczną konfigurację**

`.env.example` opisuje bez wartości rzeczywistych:

```dotenv
INSTALLATION_CALENDAR_ENABLED=false
INSTALLATION_CALENDAR_ADAPTER=disabled
GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_IMPERSONATED_USER=info@walldecor.pl
GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64=
INSTALLATION_CALENDAR_WORKER_BATCH_SIZE=20
```

`calendar-config.ts` dekoduje Base64 dopiero w procesie serwera/CLI, sprawdza
`type === 'service_account'`, `client_email`, `private_key`, calendar ID i
impersonowanego użytkownika. Eksportowany readiness może zawierać tylko booleany,
adapter, zmaskowany calendar ID i zmaskowanego użytkownika.

Adapter `fake` ma rzucać podczas `NODE_ENV=production`. Adapter `google` ma
odmawiać pracy, gdy `INSTALLATION_CALENDAR_ENABLED !== 'true'`.

- [ ] **Step 5: Dodać panel administratora**

Endpoint settings jest tylko dla `ADMIN` i zwraca:

```ts
type CalendarReadiness = {
  enabled: boolean
  adapter: 'disabled' | 'fake' | 'google'
  credentialsConfigured: boolean
  calendarConfigured: boolean
  impersonationConfigured: boolean
  ready: boolean
}
```

Panel w `/settings` pokazuje polskie komunikaty i nie pozwala odczytać ani
wkleić prywatnego klucza do bazy. Sekrety konfiguruje się w Coolify.

- [ ] **Step 6: Uruchomić testy**

```bash
npm test -- __tests__/unit/installations/google-calendar-adapter.test.ts __tests__/unit/installations/calendar-settings-route.test.ts
```

Expected: PASS i brak sekretów w serializowanym JSON.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/installations/calendar-config.ts src/lib/installations/google-calendar-adapter.ts src/app/api/settings/installation-calendar/route.ts src/components/installations/calendar-settings-panel.tsx 'src/app/(dashboard)/settings/page.tsx' __tests__/unit/installations/google-calendar-adapter.test.ts __tests__/unit/installations/calendar-settings-route.test.ts
git commit -m "feat: connect installation visits to Google Calendar"
```

### Task 9: Przyjazny panel wizyt na karcie montażu

**Files:**
- Create: `src/components/installations/installation-calendar-status.tsx`
- Create: `src/components/installations/installation-visits-panel.tsx`
- Modify: `src/components/installations/order-detail.tsx`
- Modify: `src/app/(dashboard)/installations/[id]/page.tsx`
- Create: `__tests__/unit/installations/installation-visits-panel.test.tsx`

- [ ] **Step 1: Napisać test zachowania UI**

Testing Library ma pokryć:

```ts
expect(screen.getByRole('heading', { name: 'Wizyty i terminy' })).toBeVisible()
expect(screen.getByText('Termin nieustalony')).toBeVisible()
await user.click(screen.getByRole('button', { name: 'Dodaj wizytę' }))
await user.type(screen.getByLabelText('Początek wizyty'), '2026-09-14T08:00')
await user.type(screen.getByLabelText('Koniec wizyty'), '2026-09-14T16:00')
await user.click(screen.getByRole('checkbox', { name: /Salon — Tapety/ }))
await user.click(screen.getByRole('button', { name: 'Potwierdź i wyślij zaproszenia' }))
expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/visits/'), expect.objectContaining({ method: 'PATCH' }))
```

Osobne asercje mają sprawdzić ostrzeżenie o braku e-maila, stan `Oczekuje`, link
`Otwórz w Google Calendar`, akcję retry i akcję konfliktu widoczną tylko dla
ADMIN/MANAGER.

- [ ] **Step 2: Uruchomić test i potwierdzić brak komponentu**

```bash
npm test -- __tests__/unit/installations/installation-visits-panel.test.tsx
```

Expected: FAIL dla importu.

- [ ] **Step 3: Zaimplementować panel jako progresywnie ujawniany formularz**

Props komponentu:

```ts
type InstallationVisitsPanelProps = {
  orderId: string
  visits: InstallationVisitView[]
  scopes: Array<{ id: string; roomName: string; name: string; installerIds: string[] }>
  employees: InstallationEmployeeOption[]
  canEdit: boolean
  canForceOverwrite: boolean
}
```

Formularz pokazuje najpierw termin i zakresy. Pickery instalatorów pojawiają się
pod zaznaczonym zakresem; niezaznaczone zakresy nie zaśmiecają ekranu. Pole czasu
używa `datetime-local`, lecz przed `fetch` konwertuje wartość przez
`parseWarsawLocalDateTime(...).toISOString()`.

Każda akcja blokuje tylko własny przycisk, pokazuje `role="status"` podczas pracy,
`role="alert"` przy błędzie i po sukcesie wykonuje `router.refresh()`.

- [ ] **Step 4: Podłączyć dane server-side i trwałą kotwicę**

`[id]/page.tsx` pobiera równolegle `listInstallationVisits` oraz
`listScopeInstallerAssignments`. `order-detail.tsx` renderuje:

```tsx
<a href="#visits">Przejdź do wizyt i terminów</a>
<section id="visits" aria-labelledby="installation-visits-heading">
  <InstallationVisitsPanel {...props} />
</section>
```

Installer otrzymuje widok read-only; koordynatorzy zachowują dotychczasową
politykę edycji.

- [ ] **Step 5: Uruchomić test komponentu i test prywatności instalatora**

```bash
npm test -- __tests__/unit/installations/installation-visits-panel.test.tsx __tests__/unit/installations/installer-order-page-privacy.test.tsx
```

Expected: PASS; pełne dane formularza klienta nadal nie są przekazywane
instalatorowi.

- [ ] **Step 6: Commit**

```bash
git add src/components/installations/installation-calendar-status.tsx src/components/installations/installation-visits-panel.tsx src/components/installations/order-detail.tsx 'src/app/(dashboard)/installations/[id]/page.tsx' __tests__/unit/installations/installation-visits-panel.test.tsx __tests__/unit/installations/installer-order-page-privacy.test.tsx
git commit -m "feat: add visit scheduling to installation cards"
```

### Task 10: Widoczne linki i statusy na głównej liście kart

**Files:**
- Modify: `src/lib/installations/order-service.ts`
- Modify: `src/components/installations/order-list.tsx`
- Create: `__tests__/unit/installations/order-list-calendar.test.tsx`

- [ ] **Step 1: Napisać test karty bez zagnieżdżonych linków**

```ts
expect(screen.getByRole('link', { name: 'Otwórz kartę Jan Kowalski' })).toHaveAttribute('href', '/installations/order-1')
expect(screen.getByRole('link', { name: 'Wizyty i terminy' })).toHaveAttribute('href', '/installations/order-1#visits')
expect(screen.getByText('14.09.2026, 08:00')).toBeVisible()
expect(screen.getByText('Zsynchronizowano')).toBeVisible()
expect(container.querySelector('a a')).toBeNull()
```

Test dla karty bez wizyty oczekuje `Termin nieustalony` i `Nie wysłano`.

- [ ] **Step 2: Uruchomić test i potwierdzić brak danych kalendarza**

```bash
npm test -- __tests__/unit/installations/order-list-calendar.test.tsx
```

Expected: FAIL, ponieważ `OrderListItem` nie posiada `calendarSummary`.

- [ ] **Step 3: Rozszerzyć projekcję listy**

`orderListSelect` pobiera najbliższą nieanulowaną wizytę oraz jej
`IntegrationSyncState`. `listInstallationOrders` zwraca:

```ts
calendarSummary: {
  nextVisitAt: string | null
  visitStatus: 'NONE' | 'DRAFT' | 'CONFIRMED'
  syncStatus: 'NOT_REQUESTED' | 'PENDING' | 'SYNCED' | 'ATTENTION'
}
```

- [ ] **Step 4: Rozdzielić kartę na `article` i jawne linki**

Nie wolno umieszczać `Wizyty i terminy` wewnątrz obecnego linku obejmującego całą
kartę. Zewnętrzny `<Link>` zastąpić `<article>`, a nagłówek i strzałkę połączyć
linkiem z dostępnym `aria-label`. Drugi link prowadzi do `#visits`.

- [ ] **Step 5: Uruchomić testy listy**

```bash
npm test -- __tests__/unit/installations/order-list-calendar.test.tsx __tests__/unit/installations/order-rules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/installations/order-service.ts src/components/installations/order-list.tsx __tests__/unit/installations/order-list-calendar.test.tsx
git commit -m "feat: show visit status on installation list"
```

### Task 11: Uruchamialny worker i instrukcja Coolify

**Files:**
- Create: `scripts/run-installation-calendar-worker.ts`
- Modify: `package.json`
- Modify: `Dockerfile`
- Create: `docs/runbooks/installation-google-calendar.md`
- Create: `__tests__/unit/deployment/calendar-worker.test.ts`

- [ ] **Step 1: Napisać test kontraktu procesu workera**

Test plików wdrożenia ma wymagać:

```ts
expect(packageJson.scripts['worker:installation-calendar']).toContain('run-installation-calendar-worker.ts')
expect(dockerfile).toContain('scripts/run-installation-calendar-worker.ts')
expect(dockerfile).toContain('src/lib/installations')
expect(runbook).toContain('INSTALLATION_CALENDAR_ENABLED=true')
expect(runbook).toContain('adapter fake jest zabroniony w produkcji')
```

- [ ] **Step 2: Uruchomić test i zobaczyć brak skryptu**

```bash
npm test -- __tests__/unit/deployment/calendar-worker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Dodać CLI przetwarzający skończony batch**

Skrypt ma:

```ts
const config = readInstallationCalendarConfig(process.env)
const adapter = createInstallationCalendarAdapter(config)
const result = await processInstallationCalendarBatch(prisma, adapter, config.batchSize)
console.log(JSON.stringify({ claimed: result.claimed, completed: result.completed, retried: result.retried, attention: result.attention }))
await prisma.$disconnect()
process.exitCode = result.attention > 0 ? 2 : 0
```

Nie drukuje event payloadu, e-maili, klucza ani pełnego wyjątku Google.

`package.json` otrzymuje:

```json
"worker:installation-calendar": "node --no-warnings --preserve-symlinks --import tsx scripts/run-installation-calendar-worker.ts"
```

- [ ] **Step 4: Skopiować wymagane pliki do obrazu runnera**

`Dockerfile` kopiuje `package.json`, `tsconfig.json`, skrypt workera,
`src/lib/prisma.ts` i `src/lib/installations/`. Nie zmienia entrypointu web i nie
uruchamia drugiego procesu w tle. Runbook konfiguruje w Coolify zadanie cykliczne
co minutę z komendą:

```bash
npm run worker:installation-calendar
```

Worker i web używają tego samego trwałego `DATABASE_URL` oraz sekretów, lecz
lease chroni przed równoległym wykonaniem.

- [ ] **Step 5: Opisać uruchomienie i rollback**

Runbook ma podać kolejność: adapter disabled → fake lokalnie → `TEST – Montaże` →
smoke create/update/cancel → firmowy calendar ID. Rollback to wyłączenie feature
flagi i zadania cyklicznego; nie usuwa wizyt, outboxa ani wolumenu SQLite.

- [ ] **Step 6: Uruchomić test wdrożenia i build**

```bash
npm test -- __tests__/unit/deployment/calendar-worker.test.ts
npm run build
```

Expected: PASS i udany Next production build.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-installation-calendar-worker.ts package.json Dockerfile docs/runbooks/installation-google-calendar.md __tests__/unit/deployment/calendar-worker.test.ts
git commit -m "ops: package installation calendar worker"
```

### Task 12: Pełny scenariusz E2E i dowód gotowości do testowego kalendarza

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/installations-calendar.spec.ts`
- Create: `scripts/validate-installation-calendar.mjs`
- Modify: `package.json`

- [ ] **Step 1: Włączyć fake wyłącznie dla izolowanego E2E**

`playwright.config.ts` przekazuje:

```ts
INSTALLATION_CALENDAR_ENABLED: 'true',
INSTALLATION_CALENDAR_ADAPTER: 'fake',
GOOGLE_CALENDAR_ID: 'e2e-calendar@example.test',
GOOGLE_CALENDAR_IMPERSONATED_USER: 'info@walldecor.pl',
```

Guard w `calendar-config.ts` dopuszcza fake tylko przy izolowanym
`E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*`.

- [ ] **Step 2: Napisać E2E dwóch wizyt i trzech instalatorów**

Scenariusz ma:

1. utworzyć kartę, pokój i dwa zakresy;
2. przypisać instalatora A do tapet oraz B+C do sztukaterii;
3. utworzyć i potwierdzić dwie wizyty;
4. uruchomić batch workera przez bezpośredni import w procesie testowym na tej
   samej bazie;
5. sprawdzić link `Wizyty i terminy` na liście kart;
6. zmienić termin pierwszej wizyty i uruchomić worker ponownie;
7. sprawdzić w `IntegrationSyncState`, że `externalId` się nie zmienił, a `etag`
   się zmienił;
8. anulować drugą wizytę i sprawdzić zachowaną historię.

Kluczowa asercja:

```ts
expect(afterReschedule.externalId).toBe(beforeReschedule.externalId)
expect(afterReschedule.externalEtag).not.toBe(beforeReschedule.externalEtag)
expect(await db.integrationSyncState.count({ where: { visitId: firstVisitId } })).toBe(1)
```

- [ ] **Step 3: Uruchomić nowy E2E**

```bash
npx playwright test e2e/installations-calendar.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Dodać walidator operacyjny bez prawdziwego Google**

`validate-installation-calendar.mjs` tworzy bazę tylko w `/tmp`, uruchamia pełne
migracje, seeduje minimalną kartę, potwierdza wizytę, wykonuje fake worker,
aktualizuje termin, wykonuje worker ponownie i kończy się kodem 0 tylko wtedy,
gdy zachowany jest jeden `externalId` i `integrity_check=ok`.

`package.json` otrzymuje:

```json
"validate:installation-calendar": "node scripts/validate-installation-calendar.mjs"
```

- [ ] **Step 5: Uruchomić wszystkie bramki lokalne**

```bash
npm test
npm run validate:installation-calendar
npm run test:e2e
npm run build
git status --short
```

Expected:

- wszystkie testy Vitest przechodzą;
- walidator zwraca `status: ok`, jeden `externalId`, zmieniony `etag` i
  `integrity_check: ok`;
- wszystkie Playwright E2E przechodzą;
- Next production build kończy się bez błędów;
- `git status --short` pokazuje wyłącznie oczekiwane pliki Task 12.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/installations-calendar.spec.ts scripts/validate-installation-calendar.mjs package.json
git commit -m "test: verify installation calendar workflow"
```

### Task 13: Przegląd, PR i kontrolowany test na Google

**Files:**
- Create after live verification: `docs/evidence/installation-calendar-test.md`

- [ ] **Step 1: Wykonać przegląd kodu względem projektu**

Sprawdzić wszystkie wymagania z
`docs/plans/2026-08-24-installation-calendar-design.md`, szczególnie jawne linki,
brak Gmail, brak danych klienta w wydarzeniu, jednokierunkowość, ETag oraz zakaz
fake w produkcji.

- [ ] **Step 2: Wypchnąć gałąź i otworzyć PR zależny od PR modułu montaży**

```bash
git push -u origin feature/installation-calendar
gh pr create --base feature/installation-operations --head feature/installation-calendar --title "feat: synchronize installation visits with Google Calendar" --body "Implements the approved visit scheduling and Google Calendar synchronization design. Verification commands and live-test evidence are recorded in the branch documentation."
```

Jeżeli PR modułu montaży zostanie wcześniej scalony, najpierw zmienić bazę PR na
`main` po czystym rebase/merge i ponowić pełne bramki.

- [ ] **Step 3: Skonfigurować testowy kalendarz bez wpisywania sekretów do repo**

Administrator Google tworzy `TEST – Montaże`, konto techniczne i delegację dla
zakresu Calendar Events. Coolify otrzymuje chronione wartości z runbooka oraz
feature flagę nadal ustawioną na `false` do czasu weryfikacji readiness.

- [ ] **Step 4: Wykonać rzeczywisty smoke test**

Po włączeniu testowego calendar ID wykonać przez UI:

1. utworzenie wydarzenia z dwoma testowymi uczestnikami;
2. zmianę terminu i potwierdzenie tego samego Google `eventId`;
3. zmianę uczestników;
4. ręczną zmianę w Google i potwierdzenie statusu `Wymaga uwagi`;
5. świadome `Przywróć dane z aplikacji do Google`;
6. anulowanie oraz widoczne zaproszenie anulujące;
7. restart aplikacji i potwierdzenie zachowanej historii w UI i SQLite.

- [ ] **Step 5: Zapisać niesekretny dowód**

`docs/evidence/installation-calendar-test.md` zawiera datę, commit, calendar ID
zamaskowany do ostatnich 6 znaków, ID wizyty, skrócony event ID, wyniki siedmiu
kroków, wynik `foreign_key_check`, `integrity_check`, restart oraz rollback. Nie
zawiera adresów uczestników, tokenów, klucza ani pełnego event payloadu.

- [ ] **Step 6: Przełączyć na kalendarz firmowy dopiero po akceptacji smoke testu**

Zmienić wyłącznie `GOOGLE_CALENDAR_ID`, zachować delegowanego użytkownika
`info@walldecor.pl`, uruchomić jedno kontrolowane wydarzenie i ponownie sprawdzić
UI, Google oraz bazę. Jeśli dowód nie jest kompletny, pozostawić integrację na
testowym kalendarzu i nie raportować wdrożenia produkcyjnego jako zakończonego.
