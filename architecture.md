# Architecture — Schemat bazy danych WallDecor

**ORM:** Prisma | **Baza:** SQLite | **Plik:** `walldecor.db`

## Wspólne AI i import faktur — 10.09.2026 (w trakcie, lokalnie)

Migracja `20260910180000_shared_ai_queue` dodaje wyłącznie dwie tabele; nie zmienia istniejących kwot ani dokumentów:

- `AiJob`: właściciel `User` (FK RESTRICT), rodzaj FINANCE_CHAT/WIKI_CHAT/INVOICE_EXTRACT, stan, przygotowany kontekst JSON i zwalidowany wynik, kontrolowany kod błędu, priorytet, licznik prób oraz ogrodzone tokenem prawo wykonawcy do zadania. Klucz `(ownerUserId, idempotencyKey)` gwarantuje jeden zapis dla powtórzonego żądania. Częściowy indeks SQLite dopuszcza najwyżej jeden RUNNING.
- `AiQueueLease`: jeden rekord `shared-ai`, identyfikator wykonawcy, losowy token blokady, termin ważności i powód globalnej pauzy AUTH/QUOTA/MODEL_UNAVAILABLE. Transakcja najpierw uzyskuje blokadę zapisu SQLite, dopiero potem pobiera aktualny czas do oceny terminu. Stary wynik nie może nadpisać nowego wykonania.

Czaty mają priorytet przed kolejną fakturą. API sprawdza aktualną rolę, aktywność i wymaganą zmianę hasła; odczyt zadania wyłącznie dla właściciela. ADMIN ma trzy rodzaje, MANAGER tylko encyklopedię. Próby przerwane przez restart można wznowić najwyżej trzy razy automatycznie; jawne ponowienie rozpoczyna nowy cykl. Własne QUEUED wolno ponowić również podczas globalnej pauzy, bez znajomości zadania innego użytkownika.

FK właściciela pozostaje RESTRICT: endpoint usuwania konta zwraca 409 przy historii AI, również po równoległym enqueue. Dezaktywacja nie kasuje historii. Prywatny runtime trzyma wspólny plik blokady OAuth przez FD 9, przekazując go jako FD 3 do potomnego CLI; lokalny test przekazania deskryptora nie zastępuje wymaganej próby rzeczywistego flock na Linuksie.

`loadActualDashboardModel` jest współdzielonym finansowym loaderem dashboardu i czatu. Nie pobiera sald, należności, alertów ani kursów. Kontekst AI jest jawną projekcją agregatów z zachowaniem null/zero, dat pokrycia i kompletności. API czatu finansowego wymaga jawnego roku i miesiąca; odzyskanie klucza żądania nie przelicza kontekstu na nowo.

Prywatny wykonawca nie łączy się z SQLite. Wąskie API `/api/internal/ai-worker` przyjmuje osobny klucz wykonawcy i przekazuje przygotowany kontekst oraz schemat, nigdy dowolne zapytania SQL/ścieżki. Proces Codex ma oddzielną białą listę środowiska, przypięty model i katalog bez narzędzi, a ślady uruchomienia trafiają do katalogu tymczasowego. OAuth pozostaje wyłącznie w prywatnym runtime. Po stronie systemu konieczna jest dodatkowa blokada procesu na wolumenie OAuth, trzymana aż do zakończenia procesu potomnego.

Stan odbioru i pozostały zakres szkiców/załączników/finansów: [plan importu i AI](docs/plans/2026-09-10-invoice-import-codex-ai.md). Lokalny test bez logowania nie zastępuje bramki Linux + rzeczywisty OAuth.

## Fundament szkiców faktur — 11.09.2026 (lokalnie)

Addytywna migracja `20260911150000_invoice_import_drafts` nie zmienia istniejących faktur ani kosztów. Dodaje:

- `InvoiceImportBatch`: właściciel i czas utworzenia paczki.
- `InvoiceAttachment`: unikalny klucz magazynu oraz SHA-256, oryginalna nazwa, MIME, rozmiar i liczba stron PDF, stan STAGED/READY/STORAGE_ERROR. READY wymaga poprawnych limitów; obrazy nie mają liczby stron PDF.
- `InvoiceImportDraft`: jeden szkic na załącznik, wersja danych, osobna rewizja odczytu, JSON częściowych danych i nazw pól ręcznych, aktualne zadanie AI oraz trwałe unikalne powiązanie z fakturą. Stany OPEN/APPROVED/ARCHIVED. Po pierwszym przypisaniu `invoiceId` trigger blokuje jego wyzerowanie lub zmianę.
- `InvoiceDraftAudit`: niezmienny audyt operacji z aktorem i opcjonalnym zadaniem AI. Unikalna para aktor/klucz idempotencji przechowuje hash żądania i rezultat operacji. UPDATE i DELETE audytu blokują triggery.

Relacje mają FK RESTRICT. Nie ma kaskadowego usuwania historii. Odczyt AI może proponować dokładnie 12 pól; ręcznie ustawione `null` także jest chronione, a przeliczenie PLN i klasyfikacja nie należą do pól AI. Świeży łańcuch i migracja wcześniejszego łańcucha zweryfikowane na syntetycznych bazach, wraz z integralnością i zachowaniem dotychczasowych danych. Sam schemat nie oznacza ukończenia uploadu/finansowego przebiegu.

## Późniejsze powiązanie KSeF — 12.09.2026 (lokalnie)

Addytywna migracja `20260911190000_invoice_ksef_reconciliation` dodaje `InvoiceKsefReconciliation`: niezmienne powiązanie numeru KSeF ze szkicem, wersję, ograniczony snapshot/hash i zachowany prywatny XML. Relacje RESTRICT i triggery chronią tożsamość oraz audyt; tabela `WITHOUT ROWID` blokuje także obchodzenie ochrony przez alternatywne aliasy SQLite. Testy obejmują rzeczywisty klient Prisma.

- Synchronizacja pobiera XML poza transakcją, następnie uzyskuje wspólną rezerwację zapisu i ponownie sprawdza uprawnienia oraz dopasowanie. Obserwacja nie zmienia `KsefInvoice`, `CostEvent`, klasyfikacji ani załącznika. Zgodny snapshot jest idempotentny; nowe różnice zwiększają wersję szkicu i linku oraz dopisują audyt.
- Status jest wyliczany z aktualnych danych: MATCHED, CONFLICT, KEPT_LOCAL lub APPLIED_TO_DRAFT. Hash danych objętych świadomym KEEP uniemożliwia zachowanie nieaktualnej zgody po zmianie kwoty/płatności. Dokument KSeF non-ACTIVE zawsze wymaga osobnej obsługi.
- GET/POST `/api/finance/invoice-import/drafts/[id]/ksef` wymagają świeżego aktywnego ADMIN-a. POST sprawdza obie wersje i klucz idempotencji; zapis decyzji, danych szkicu i audytu jest atomowy. APPLY wymaga OPEN; nie tworzy kosztu. Zatwierdzenie sprawdza wszystkie nierozstrzygnięte linki wewnątrz swojej transakcji.
- DTO porównania i paginowane podsumowania list wybierają tylko potrzebne pola, bez XML. Listy sumujące kwoty nie pobierają snapshotów. Koszt zatwierdzony przed konfliktem pozostaje aktywny, dopóki administrator jawnie go nie cofnie.

## Aktualizacja finansów i kasy — 10.09.2026

Implementacja lokalna; wdrożenie wymaga osobnego odbioru. Źródłem bieżącego schematu jest `prisma/schema.prisma`; starsze diagramy i przykłady poniżej dokumentują pierwotny MVP.

- `Revenue.asOfDate String?`: data ISO stanu narastającego w miesiącu; brak danych historycznych pozostaje `null`. Unikalność rok/miesiąc/centrum/kanał bez zmian. `RevenueBudget` zachowane wyłącznie historycznie; budżety kosztowe nietknięte.
- `SalonCashSettings`: jeden rekord PUL/JAG, unikalny `cashAccountId`, data/saldo startowe, cel kasy stałej i wersja. Rachunek wybiera administrator jawnie.
- `CashDailyReport`: unikalny salon/dzień, status DRAFT/CLOSED, wersja, otwarcie, wpływy i policzona gotówka, zamrożone wartości rozliczenia i celu, klucz zamknięcia. Częściowy indeks SQLite dopuszcza najwyżej jeden szkic na salon.
- `CashDailyOperation`: zwrot sprzedaży, przyjęcie/zwrot kaucji, metoda CASH/CARD, dodatnia kwota, dokument, anulowanie zamiast fizycznego usunięcia.
- `CashDeposit`: najwyżej jeden na raport; WAITING → RECEIVED → VERIFIED/DISCREPANCY; VOID zachowuje ślad wycofanej paczki. Oddzielne daty/aktorzy odbioru i przeliczenia oraz rachunek docelowy.
- `CashierAuditLog`: niezmieniane wpisy przed/po z aktorem, czasem i powodem. Korekta raportu dopuszczalna wyłącznie przed późniejszym raportem i odbiorem paczki; poprzednie wartości pozostają w audycie.

Nowe kwoty: `Int` w groszach, walidowane do 2 147 483 647; aktualizacja dotychczasowego `CashAccount.balance` i `CashBalanceHistory` w tej samej transakcji. Zamknięcie zmienia rachunek o policzona minus otwarcie; depozyt nadal należy do tego salda. Odbiór przenosi zadeklarowaną kwotę, przeliczenie dopisuje tylko różnicę. Kasa nie dopisuje miesięcznego `Revenue` i nie księguje automatycznie kart, banku ani płatności KSeF.

Dostęp kasy jest ustalany na każdym żądaniu z bieżącego `User.employeeId → Employee.costCenterId`, aktywności i roli; nie z samego JWT. ADMIN obie kasy, EMPLOYEE tylko swój PUL/JAG. Stare API rachunków blokuje ręczne saldo/dezaktywację rachunku zarządzanego przez kasę i dezaktywację odbiorcy nieprzeliczonej paczki.

Migracja: `prisma/migrations/20260910070000_finance_actuals_cashier/migration.sql` — wyłącznie addytywna, bez backfillu dat i bez automatycznej aktywacji. Sprawdzenie pełnego łańcucha/upgrade: `node scripts/validate-finance-migrations.mjs`. Szczegóły kontraktu w `docs/superpowers/specs/2026-09-10-finance-cashier-design.md`.

---

## Diagram relacji (uproszczony)

```
CostCenter ──────────────────────────────────────────┐
     │                                               │
     ├── BudgetEntry (plan)                          │
     ├── ActualEntry (wykonanie)                     │
     └── Revenue (przychody)                         │
                                                     │
SubCategory ──┬── BudgetEntry                        │
              └── ActualEntry                        │
AccountCategory ──── SubCategory                     │
                                                     │
Employee ────────────────────────────────────────────┘
     │   (belongs to CostCenter)
     ├── Contract[]
     ├── AdditionalContract[]
     ├── SalaryHistory[]
     ├── LeaveRequest[]
     ├── LeaveBalance[]
     └── WorkTimeRecord[]

User ──── Employee (1:1, opcjonalne)
```

### Operacje / Playbook

```
OperationArea ── OperationModule ── ChecklistTemplate ── ChecklistTemplateItem
                                            │
                                            └── ChecklistRun ── ChecklistRunItem

Article(type="procedure") ── linked by procedureId ── ChecklistTemplateItem / ChecklistRunItem
```

Operacje używają istniejącego modelu `Article` jako źródła instrukcji how-to (`type = "procedure"`). Szablony i wykonania mają własne tabele, bo są danymi operacyjnymi, a nie treścią wiki.

---

## Tabele (Prisma schema)

### User
```prisma
model User {
  id                 String    @id @default(cuid())
  username           String?   @unique  // login (backfill z e-maila przy pierwszym logowaniu)
  email              String    @unique
  name               String
  role               Role      @default(EMPLOYEE)
  passwordHash       String
  mustChangePassword Boolean   @default(false) // wymuś zmianę hasła po utworzeniu/resecie
  passwordChangedAt  DateTime?                  // znacznik ostatniej zmiany hasła
  employee           Employee? @relation(fields: [employeeId], references: [id])
  employeeId         String?   @unique
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  actualEntries ActualEntry[]
}

enum Role {
  ADMIN
  MANAGER
  EMPLOYEE
}
```

**Logowanie po loginie (username), nie e-mailu:** `LoginSchema` (`src/lib/validations/auth.ts`) przyjmuje `username` + `password`, a `src/lib/auth.ts` wyszukuje użytkownika po `username`. Fallback dla kont starszych (bez `username`) porównuje wpisany login ze znormalizowaną częścią lokalną e-maila (`normalizeEmailLocalPart` w `src/lib/accounts/policy.ts`) i uzupełnia `username` przy pierwszym udanym logowaniu. Konta tworzone/resetowane przez ADMIN dostają jednorazowe hasło tymczasowe (`generateTemporaryPassword` w `src/lib/accounts/security.ts`) i flagę `mustChangePassword: true` — middleware `src/proxy.ts` przekierowuje takich użytkowników na `/change-password` (403 dla `/api/*`).

---

### CostCenter
```prisma
model CostCenter {
  id          String  @id  // "JAG" | "PUL" | "GLOBAL"
  name        String
  description String?

  budgetEntries  BudgetEntry[]
  actualEntries  ActualEntry[]
  revenues       Revenue[]
  employees      Employee[]
  reminders      PaymentReminder[]
}
```

---

### AccountCategory + SubCategory
```prisma
model AccountCategory {
  id           String        @id @default(cuid())
  name         String        @unique  // np. "Customer Acquisition"
  order        Int           // kolejność wyświetlania
  subCategories SubCategory[]
}

model SubCategory {
  id         String          @id @default(cuid())
  name       String          // np. "AdWords"
  order      Int
  categoryId String
  category   AccountCategory @relation(fields: [categoryId], references: [id])

  budgetEntries BudgetEntry[]
  actualEntries ActualEntry[]
}
```

---

### BudgetEntry — Plan budżetu
```prisma
model BudgetEntry {
  id            String      @id @default(cuid())
  year          Int
  month         Int         // 1–12
  amount        Decimal     @default(0)

  costCenterId  String
  costCenter    CostCenter  @relation(fields: [costCenterId], references: [id])
  subCategoryId String
  subCategory   SubCategory @relation(fields: [subCategoryId], references: [id])

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([year, month, costCenterId, subCategoryId])
}
```

---

### Operations Playbook

```prisma
model OperationArea {
  id          String  @id @default(cuid())
  name        String
  slug        String  @unique
  description String?
  order       Int     @default(0)
}

model OperationModule {
  id          String @id @default(cuid())
  areaId      String
  name        String
  slug        String @unique
  description String?
  order       Int    @default(0)
}

model ChecklistTemplate {
  id          String  @id @default(cuid())
  moduleId    String
  name        String
  description String?
  active      Boolean @default(true)
}

model ChecklistTemplateItem {
  id             String @id @default(cuid())
  templateId     String
  title          String
  description    String?
  order          Int
  procedureId    String? // Article.id, aplikacja wymusza Article.type="procedure"
  defaultOwnerId String?
  dueDayOffset   Int?
}

model ChecklistRun {
  id          String @id @default(cuid())
  templateId  String
  name        String
  periodYear  Int
  periodMonth Int?
  status      String @default("open") // open | closed | archived
  createdById String
}

model ChecklistRunItem {
  id             String @id @default(cuid())
  runId          String
  templateItemId String?
  title          String
  description    String?
  order          Int
  procedureId    String?
  ownerId        String?
  status         String @default("todo") // todo | in_progress | blocked | done
  note           String?
  completedAt    DateTime?
  completedById  String?
}
```

Pierwszy seed: `Finanse -> Koniec miesiąca -> Księgowość - koniec miesiąca`, 13 zadań i kilka procedur how-to jako `Article.type = "procedure"`.

---

### ActualEntry — Wykonanie budżetu
```prisma
model ActualEntry {
  id            String      @id @default(cuid())
  year          Int
  month         Int         // 1–12
  amount        Decimal
  note          String?

  costCenterId  String
  costCenter    CostCenter  @relation(fields: [costCenterId], references: [id])
  subCategoryId String
  subCategory   SubCategory @relation(fields: [subCategoryId], references: [id])
  enteredById   String
  enteredBy     User        @relation(fields: [enteredById], references: [id])

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([year, month, costCenterId, subCategoryId])
}
```

---

### Revenue — Przychody
```prisma
model Revenue {
  id           String        @id @default(cuid())
  year         Int
  month        Int
  amount       Decimal
  channel      RevenueChannel

  costCenterId String
  costCenter   CostCenter    @relation(fields: [costCenterId], references: [id])

  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([year, month, costCenterId, channel])
}

enum RevenueChannel {
  SALON       // sprzedaż w salonie
  ECOMMERCE   // zawsze costCenter = PUL
}
```

---

### Employee — Pracownik
```prisma
model Employee {
  id           String     @id @default(cuid())
  firstName    String
  lastName     String
  email        String?    @unique
  phone        String?
  pesel        String?
  address      String?
  position     String
  startDate    DateTime
  endDate      DateTime?
  isActive     Boolean    @default(true)

  costCenterId String
  costCenter   CostCenter @relation(fields: [costCenterId], references: [id])

  contracts          Contract[]
  additionalContracts AdditionalContract[]
  salaryHistory      SalaryHistory[]
  leaveRequests      LeaveRequest[]
  leaveBalances      LeaveBalance[]
  workTimeRecords    WorkTimeRecord[]
  user               User?

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

---

### Contract — Umowa główna
```prisma
model Contract {
  id           String         @id @default(cuid())
  type         ContractType
  startDate    DateTime
  endDate      DateTime?
  salary       Decimal        // brutto dla UOP, netto/stawka dla B2B/UZ
  salaryNote   String?

  employeeId   String
  employee     Employee       @relation(fields: [employeeId], references: [id])

  createdAt    DateTime       @default(now())
}

enum ContractType {
  UOP   // Umowa o pracę
  B2B   // Działalność gospodarcza / faktura
  UZ    // Umowa zlecenie
}
```

---

### AdditionalContract — Umowy dodatkowe
```prisma
model AdditionalContract {
  id          String   @id @default(cuid())
  type        String   // np. "Najem auta", "UZ dodatkowa"
  description String?
  startDate   DateTime
  endDate     DateTime?
  value       Decimal
  note        String?

  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])

  createdAt   DateTime @default(now())
}
```

---

### SalaryHistory — Historia wynagrodzeń
```prisma
model SalaryHistory {
  id          String   @id @default(cuid())
  validFrom   DateTime
  validTo     DateTime?
  salary      Decimal
  note        String?  // np. "Podwyżka", "Awans"

  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])

  createdAt   DateTime @default(now())
}
```

---

### LeaveRequest — Wnioski urlopowe
```prisma
model LeaveRequest {
  id          String        @id @default(cuid())
  type        LeaveType
  startDate   DateTime
  endDate     DateTime
  days        Int
  status      LeaveStatus   @default(PENDING)
  note        String?
  reviewNote  String?

  employeeId  String
  employee    Employee      @relation(fields: [employeeId], references: [id])
  reviewedById String?
  // reviewedBy → User (admin/manager)

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

enum LeaveType {
  VACATION      // Urlop wypoczynkowy
  SICK          // Chorobowe L4
  CARE          // Opieka
  OTHER         // Inne
}

enum LeaveStatus {
  PENDING
  APPROVED
  REJECTED
}
```

---

### LeaveBalance — Saldo urlopowe
```prisma
model LeaveBalance {
  id          String    @id @default(cuid())
  year        Int
  type        LeaveType
  total       Int       // dni przyznane
  used        Int       @default(0)
  remaining   Int       // computed: total - used

  employeeId  String
  employee    Employee  @relation(fields: [employeeId], references: [id])

  @@unique([employeeId, year, type])
}
```

---

### WorkTimeRecord — Ewidencja czasu pracy
```prisma
model WorkTimeRecord {
  id            String    @id @default(cuid())
  date          DateTime
  regularHours  Decimal   @default(0)
  overtimeHours Decimal   @default(0)  // soboty auto + manualne
  isSaturday    Boolean   @default(false)
  note          String?

  employeeId    String
  employee      Employee  @relation(fields: [employeeId], references: [id])

  createdAt     DateTime  @default(now())

  @@unique([employeeId, date])
}
```

---

### PaymentReminder — Przypomnienia o płatnościach
```prisma
model PaymentReminder {
  id           String    @id @default(cuid())
  name         String    // np. "Czynsz Jagiellońska"
  amount       Decimal?
  dueDay       Int       // dzień miesiąca (1–31)
  recurring    Boolean   @default(true)
  isActive     Boolean   @default(true)
  note         String?

  costCenterId String?
  costCenter   CostCenter? @relation(fields: [costCenterId], references: [id])

  createdAt    DateTime  @default(now())
}
```

---

## Dane startowe (seed)

Przy pierwszym uruchomieniu `prisma db seed` wgrywa:

1. **CostCenter:** JAG, PUL, GLOBAL
2. **AccountCategory + SubCategory:** pełna struktura kont z `spec.md`
3. **User:** konto Admin (Prezes) z tymczasowym hasłem

---

## Kluczowe zapytania (przykłady)

### Plan vs Wykonanie per lokal, miesiąc
```sql
SELECT sc.name, b.amount as budget, a.amount as actual
FROM SubCategory sc
LEFT JOIN BudgetEntry b ON b.subCategoryId = sc.id
  AND b.costCenterId = 'JAG' AND b.year = 2026 AND b.month = 3
LEFT JOIN ActualEntry a ON a.subCategoryId = sc.id
  AND a.costCenterId = 'JAG' AND a.year = 2026 AND a.month = 3
```

### Break-even per lokal (miesięczny)
```
Break-even = suma kosztów (BudgetEntry) dla danego costCenter
             podzielona przez marżę (do konfiguracji przez admina)
```

### Nadgodziny miesięczne pracownika
```sql
SELECT SUM(overtimeHours) FROM WorkTimeRecord
WHERE employeeId = ? AND month(date) = ? AND year(date) = ?
```
