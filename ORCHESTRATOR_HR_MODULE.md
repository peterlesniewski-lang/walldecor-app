# ORCHESTRATOR: Moduł HR — WallDecor Business Manager

## META

Jesteś agentem-orkiestratorem. Twoje zadanie to koordynacja budowy modułu HR dla aplikacji WallDecor Business Manager. NIE implementujesz kodu sam — delegujesz pracę do subagentów za pomocą `task(...)`. Każdy subagent otrzymuje precyzyjne instrukcje, kontekst i kryteria akceptacji.

## STACK TECHNOLOGICZNY

```
Framework:    Next.js 16, App Router, TypeScript strict
UI:           Tailwind CSS + shadcn/ui, Lucide icons
Auth:         NextAuth v4 (role: ADMIN | MANAGER | EMPLOYEE)
ORM:          Prisma 5.22 + SQLite (walldecor.db)
Runtime:      Node.js 25
Testy:        Vitest + Testing Library
Deployment:   Docker volume na VPS OVH (Ubuntu)
```

### Konwencje SQLite/Prisma
- Brak natywnych enumów → stringi z walidacją Zod
- Daty jako `DateTime` (Prisma mapuje na TEXT w SQLite)
- Relacje przez foreign key z `@relation`
- Brak `@db.Enum` — użyj `String` + runtime validation

## STRUKTURA KATALOGÓW

```
src/
├── app/
│   ├── (auth)/                    # Layout z auth guard
│   │   ├── hr/
│   │   │   ├── employees/         # Moduł Pracownicy
│   │   │   │   ├── page.tsx
│   │   │   │   ├── [id]/page.tsx
│   │   │   │   └── new/page.tsx
│   │   │   ├── time-tracking/     # Moduł Czas Pracy
│   │   │   │   ├── page.tsx       # Dashboard czasu pracy
│   │   │   │   ├── clock/page.tsx # Rejestracja (clock in/out)
│   │   │   │   ├── schedule/      # Grafik
│   │   │   │   ├── reports/       # Raporty
│   │   │   │   └── periods/       # Okresy rozliczeniowe
│   │   │   ├── leave/             # Moduł Urlopy/Nieobecności
│   │   │   │   ├── page.tsx       # Kalendarz nieobecności
│   │   │   │   ├── requests/      # Wnioski
│   │   │   │   ├── types/         # Typy urlopów
│   │   │   │   └── approval/      # Akceptacja
│   │   │   └── layout.tsx         # HR sidebar navigation
│   │   └── layout.tsx
│   └── api/
│       └── hr/
│           ├── employees/
│           ├── time-tracking/
│           ├── leave/
│           └── reports/
├── components/
│   └── hr/
│       ├── employees/
│       ├── time-tracking/
│       └── leave/
├── lib/
│   ├── hr/
│   │   ├── schemas.ts            # Zod schemas (walidacja enumów)
│   │   ├── constants.ts          # Typy urlopów, statusy, kody
│   │   ├── utils.ts              # Kalkulacje czasu, dni robocze
│   │   └── google-calendar.ts    # Integracja GCal
│   └── prisma.ts
└── prisma/
    └── schema.prisma
```

## SCHEMAT BAZY DANYCH (Prisma)

```prisma
// ============================================
// STRUKTURA ORGANIZACYJNA
// ============================================

model Company {
  id        String   @id @default(cuid())
  name      String
  nip       String?
  divisions Division[]
  createdAt DateTime @default(now())
}

model Division {
  id        String   @id @default(cuid())
  name      String                          // np. "Oddział Jagiellońska", "Oddział Puławska"
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  departments Department[]
  employees Employee[]
  timeRules TimeTrackingRule[]
  holidays  CustomHoliday[]
}

model Department {
  id         String   @id @default(cuid())
  name       String                         // np. "Sprzedaż", "Marketing"
  divisionId String
  division   Division @relation(fields: [divisionId], references: [id])
  teams      Team[]
  employees  Employee[]
}

model Team {
  id           String   @id @default(cuid())
  name         String
  departmentId String
  department   Department @relation(fields: [departmentId], references: [id])
  employees    Employee[]
}

model Position {
  id        String     @id @default(cuid())
  name      String                          // np. "Sprzedawca", "Kierownik salonu"
  employees Employee[]
}

// ============================================
// PRACOWNICY
// ============================================

model Employee {
  id              String   @id @default(cuid())
  
  // Dane osobowe
  firstName       String
  lastName        String
  email           String   @unique
  phone           String?
  avatarUrl       String?
  
  // Zatrudnienie
  employmentType  String                    // "UoP" | "B2B" | "UZ" | "UoD" | "inne"
  contractStart   DateTime
  contractEnd     DateTime?                 // null = bezterminowa
  position        Position? @relation(fields: [positionId], references: [id])
  positionId      String?
  
  // Struktura
  divisionId      String?
  division        Division? @relation(fields: [divisionId], references: [id])
  departmentId    String?
  department      Department? @relation(fields: [departmentId], references: [id])
  teamId          String?
  team            Team? @relation(fields: [teamId], references: [id])
  
  // Przełożony
  managerId       String?
  manager         Employee? @relation("ManagerRelation", fields: [managerId], references: [id])
  subordinates    Employee[] @relation("ManagerRelation")
  
  // Konto systemowe
  userId          String?  @unique
  user            User?    @relation(fields: [userId], references: [id])
  
  // Urlopy
  leaveBalances   LeaveBalance[]
  leaveRequests   LeaveRequest[]
  approvedLeaves  LeaveRequest[] @relation("LeaveApprover")
  substitutions   LeaveRequest[] @relation("LeaveSubstitute")
  
  // Czas pracy
  timeEntries     TimeEntry[]
  schedules       WorkSchedule[]
  overtimeRequests OvertimeRequest[]
  
  // Status
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ============================================
// CZAS PRACY
// ============================================

model TimeEntry {
  id           String   @id @default(cuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id])
  
  date         DateTime                     // Dzień
  clockIn      DateTime                     // Godzina wejścia
  clockOut     DateTime?                    // Godzina wyjścia (null = trwa)
  
  // Przerwy
  breaks       Break[]
  
  // Projekt/zadanie
  projectId    String?
  project      Project? @relation(fields: [projectId], references: [id])
  taskName     String?
  
  // Meta
  source       String   @default("manual") // "manual" | "auto" | "clock" | "bulk"
  status       String   @default("pending") // "pending" | "approved" | "rejected"
  approvedById String?
  notes        String?
  
  // Kalkulowane
  totalMinutes  Int?                        // Obliczony czas pracy (bez przerw)
  breakMinutes  Int?                        // Łączny czas przerw
  overtimeMinutes Int @default(0)           // Nadgodziny
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@unique([employeeId, date])
}

model Break {
  id          String    @id @default(cuid())
  timeEntryId String
  timeEntry   TimeEntry @relation(fields: [timeEntryId], references: [id], onDelete: Cascade)
  startTime   DateTime
  endTime     DateTime?
  type        String    @default("break")   // "break" | "lunch" | "other"
}

model Project {
  id          String      @id @default(cuid())
  name        String
  code        String      @unique
  isActive    Boolean     @default(true)
  timeEntries TimeEntry[]
}

model WorkSchedule {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])
  
  date        DateTime
  startTime   String                        // "08:00" format HH:mm
  endTime     String                        // "16:00"
  breakMinutes Int     @default(30)
  
  type        String   @default("regular")  // "regular" | "overtime" | "on-call"
  isTemplate  Boolean  @default(false)       // Dla kopiowania grafików
  templateName String?
  
  @@unique([employeeId, date])
}

model TimeTrackingRule {
  id           String   @id @default(cuid())
  divisionId   String
  division     Division @relation(fields: [divisionId], references: [id])
  
  name         String
  dailyHours   Float    @default(8)
  weeklyHours  Float    @default(40)
  breakAfterHours Float @default(6)         // Obowiązkowa przerwa po X godzinach
  breakMinutes Int      @default(15)
  roundingRule String   @default("none")    // "none" | "15min" | "30min"
  overtimeThreshold Float @default(8)       // Po ilu godzinach = nadgodziny
  
  periodType   String   @default("monthly") // "monthly" | "weekly" | "quarterly"
  periodStart  Int      @default(1)         // Dzień rozpoczęcia okresu
}

model BillingPeriod {
  id         String   @id @default(cuid())
  name       String                          // "Październik 2025"
  startDate  DateTime
  endDate    DateTime
  status     String   @default("open")       // "open" | "closed" | "locked"
  closedAt   DateTime?
  closedById String?
}

model OvertimeRequest {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])
  
  date        DateTime
  minutes     Int
  reason      String
  status      String   @default("pending")  // "pending" | "approved" | "rejected"
  approvedById String?
  approvedAt  DateTime?
  
  createdAt   DateTime @default(now())
}

// ============================================
// URLOPY / NIEOBECNOŚCI
// ============================================

model LeaveType {
  id              String   @id @default(cuid())
  name            String                     // "Urlop wypoczynkowy", "L4", etc.
  code            String   @unique           // "VL", "SL", "RL", etc.
  color           String   @default("#3B82F6")
  isPaid          Boolean  @default(true)
  requiresApproval Boolean @default(true)
  maxDaysPerYear  Int?                       // null = bez limitu
  isActive        Boolean  @default(true)
  
  // Podtypy
  parentId        String?
  parent          LeaveType? @relation("LeaveSubtype", fields: [parentId], references: [id])
  subtypes        LeaveType[] @relation("LeaveSubtype")
  
  balances        LeaveBalance[]
  requests        LeaveRequest[]
}

model LeaveBalance {
  id           String   @id @default(cuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id])
  leaveTypeId  String
  leaveType    LeaveType @relation(fields: [leaveTypeId], references: [id])
  
  year         Int
  totalDays    Float                         // Przysługujące (np. 26)
  usedDays     Float    @default(0)
  pendingDays  Float    @default(0)          // Oczekujące na akceptację
  carriedOver  Float    @default(0)          // Przeniesione z poprzedniego roku
  
  @@unique([employeeId, leaveTypeId, year])
}

model LeaveRequest {
  id            String   @id @default(cuid())
  employeeId    String
  employee      Employee @relation(fields: [employeeId], references: [id])
  leaveTypeId   String
  leaveType     LeaveType @relation(fields: [leaveTypeId], references: [id])
  
  startDate     DateTime
  endDate       DateTime
  days          Float                        // Wyliczone dni robocze
  hours         Float?                       // Dla urlopów godzinowych
  
  // Typ szczegółowy
  isOnDemand    Boolean  @default(false)     // Urlop na żądanie
  isRemoteWork  Boolean  @default(false)     // Praca zdalna
  isDelegation  Boolean  @default(false)     // Delegacja
  
  // Akceptacja
  status        String   @default("pending") // "pending" | "approved" | "rejected" | "cancelled"
  approverId    String?
  approver      Employee? @relation("LeaveApprover", fields: [approverId], references: [id])
  approvedAt    DateTime?
  rejectionNote String?
  
  // Zastępstwo
  substituteId  String?
  substitute    Employee? @relation("LeaveSubstitute", fields: [substituteId], references: [id])
  notifySubstitute Boolean @default(false)
  
  // Dokumenty
  note          String?
  attachments   String?                      // JSON array of file paths
  
  // Google Calendar sync
  gcalEventId   String?
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model CustomHoliday {
  id         String   @id @default(cuid())
  name       String                          // "Wigilia firmowa"
  date       DateTime
  divisionId String?                         // null = dla wszystkich
  division   Division? @relation(fields: [divisionId], references: [id])
  isRecurring Boolean @default(false)
  country    String   @default("PL")
}

// ============================================
// POWIADOMIENIA
// ============================================

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String                           // "leave_request" | "leave_approved" | "overtime" | etc.
  title     String
  message   String
  link      String?                          // URL do powiązanego zasobu
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

## PLAN SUBAGENTÓW — KOLEJNOŚĆ WYKONANIA

### FAZA 0: Fundament (wymagane przed wszystkim)

---

#### TASK 0.1 — Schemat Prisma + Seed

**Cel:** Wygeneruj schemat bazy danych i seed z danymi testowymi.

**Instrukcje dla subagenta:**
```
Utwórz/zaktualizuj plik prisma/schema.prisma zgodnie ze schematem powyżej. 
Pamiętaj o konwencjach SQLite:
- Brak @db.Enum — użyj String
- DateTime mapuje na TEXT
- Relacje self-referencing (Employee.manager) wymagają opcjonalnego pola

Utwórz plik prisma/seed.ts:
- 2 oddziały (Jagiellońska, Puławska)  
- 2 działy (Sprzedaż, Marketing)
- 1 zespół
- 5 stanowisk
- 5 pracowników (mix UoP/B2B/UZ), w tym:
  - 1 ADMIN (Piotr Bielecki — CEO)
  - 1 MANAGER (per oddział)  
  - 3 EMPLOYEE
- Typy urlopów zgodne z polskim prawem pracy:
  VL  - Urlop wypoczynkowy (26 dni / 20 dni zależnie od stażu)
  VLD - Urlop na żądanie (podtyp VL, max 4 dni/rok)
  VBL - Urlop wypoczynkowy dodatkowy
  VSL - Urlop na wolontariat
  FIL - Urlop na chorobę rodzinną
  ML  - Urlop macierzyński
  PL  - Urlop tacierzyński
  UO  - Urlop opiekuńczy
  ZOW - Zwolnienie z obowiązku wykonywania umowy
  SWd - Zwolnienie z powodu siły wyższej (dniowe)
  SL  - Zwolnienie chorobowe (L4)
  RW  - Praca zdalna
  RWO - Okazjonalna praca zdalna
  DEL - Delegacja
  OT  - Czas wolny za nadgodziny
- Przykładowe saldo urlopowe na 2025 dla każdego pracownika
- Reguły czasu pracy per oddział (8h dziennie, 40h tygodniowo)
- Polskie święta państwowe 2025-2026
- 3 projekty (Showroom Praga, Showroom Mokotów, E-commerce)

Uruchom: npx prisma generate && npx prisma db push && npx tsx prisma/seed.ts
```

**Kryteria akceptacji:**
- [ ] `npx prisma generate` bez błędów
- [ ] `npx prisma db push` tworzy tabele
- [ ] Seed wypełnia dane — `npx prisma studio` pokazuje rekordy
- [ ] Relacje poprawne (pracownik → oddział → firma)

---

#### TASK 0.2 — Stałe, Schematy Zod, Utility

**Cel:** Współdzielone typy, walidacja i funkcje kalkulacyjne.

**Instrukcje dla subagenta:**
```
Utwórz pliki w src/lib/hr/:

1. constants.ts
   - EMPLOYMENT_TYPES = ["UoP", "B2B", "UZ", "UoD", "inne"] as const
   - LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const  
   - TIME_ENTRY_STATUSES = ["pending", "approved", "rejected"] as const
   - TIME_ENTRY_SOURCES = ["manual", "auto", "clock", "bulk"] as const
   - BREAK_TYPES = ["break", "lunch", "other"] as const
   - ROLES = ["ADMIN", "MANAGER", "EMPLOYEE"] as const
   - BILLING_PERIOD_STATUSES = ["open", "closed", "locked"] as const
   - POLISH_PUBLIC_HOLIDAYS — funkcja generująca święta dla danego roku
     (Nowy Rok, Trzech Króli, Wielkanoc*, Poniedziałek Wielkanocny*,
      1 Maja, 3 Maja, Boże Ciało*, Wniebowzięcie, Wszystkich Świętych,
      Niepodległości, Boże Narodzenie 25-26) (* = ruchome, obliczaj algorytmem)

2. schemas.ts — Zod schemas:
   - employeeCreateSchema, employeeUpdateSchema
   - timeEntryCreateSchema, timeEntryBulkCreateSchema
   - breakSchema
   - leaveRequestCreateSchema
   - workScheduleCreateSchema
   - overtimeRequestSchema
   - Walidacja: daty nie w przeszłości (dla wniosków), startDate < endDate,
     employmentType in EMPLOYMENT_TYPES, etc.

3. utils.ts:
   - calculateWorkingDays(start, end, holidays[]) → number
   - calculateWorkingHours(clockIn, clockOut, breaks[]) → { total, break, net }
   - isWeekend(date) → boolean
   - isPublicHoliday(date, country) → boolean  
   - formatDuration(minutes) → "8h 30m"
   - parseDuration(str) → minutes
   - getWeekRange(date) → { start, end }
   - getMonthRange(year, month) → { start, end }
   - getBillingPeriodRange(rules, date) → { start, end }
   - calculateOvertimeMinutes(totalMinutes, dailyThreshold) → number
```

**Kryteria akceptacji:**
- [ ] Testy jednostkowe Vitest dla calculateWorkingDays (przypadek z weekendami + święta)
- [ ] Testy dla calculateWorkingHours (z przerwami)
- [ ] Testy dla polskich świąt ruchomych (Wielkanoc 2025, 2026)
- [ ] Zod schemas parsują poprawne dane i odrzucają niepoprawne
- [ ] Eksporty poprawne — brak circular dependencies

---

#### TASK 0.3 — Layout HR + Nawigacja + RBAC Middleware

**Cel:** Sidebar, breadcrumbs, route guards.

**Instrukcje dla subagenta:**
```
1. src/app/(auth)/hr/layout.tsx
   - Sidebar z sekcjami:
     * Pracownicy (icon: Users)
     * Czas pracy (icon: Clock) → submenu: Dashboard, Rejestracja, Grafik, Okresy, Raporty
     * Urlopy (icon: Calendar) → submenu: Kalendarz, Wnioski, Typy, Akceptacja
   - Aktywny link podświetlony (shadcn NavigationMenu lub custom)
   - Breadcrumbs dynamiczne z pathname
   - Responsive: na mobile sidebar jako sheet/drawer

2. src/middleware.ts (lub rozbuduj istniejący)
   - Reguły RBAC:
     * /hr/employees/new, /hr/leave/types → ADMIN only
     * /hr/time-tracking/periods, /hr/leave/approval → ADMIN | MANAGER
     * /hr/time-tracking/clock, /hr/leave/requests → ALL authenticated
   - Redirect do /unauthorized jeśli brak uprawnień

3. src/components/hr/role-guard.tsx
   - Komponent <RoleGuard roles={["ADMIN", "MANAGER"]}> dla warunkowego renderowania UI
   
Styl: zgodny z TomHRM — czyste białe tło, minimalistyczny, 
accent-blue (#3B82F6), status-colors (green/orange/red/blue badges).
```

**Kryteria akceptacji:**
- [ ] Sidebar renderuje się poprawnie na desktop i mobile
- [ ] Nawigacja działa z App Router (nie przeładowuje strony)
- [ ] RBAC blokuje dostęp dla nieautoryzowanych ról
- [ ] RoleGuard ukrywa/pokazuje elementy UI

---

### FAZA 1: Moduł Pracownicy

---

#### TASK 1.1 — CRUD Pracowników + API

**Cel:** Lista, szczegóły, dodawanie, edycja pracowników.

**Instrukcje dla subagenta:**
```
API Routes (src/app/api/hr/employees/):
- GET    /api/hr/employees          — lista z filtrami (division, department, status, employmentType)
                                      Paginacja: ?page=1&limit=20
                                      Sortowanie: ?sort=lastName&order=asc
- GET    /api/hr/employees/[id]     — szczegóły z relacjami (division, department, team, position, manager)
- POST   /api/hr/employees          — tworzenie (walidacja Zod)
- PATCH  /api/hr/employees/[id]     — aktualizacja
- DELETE /api/hr/employees/[id]     — soft delete (isActive = false)

Strony:
1. /hr/employees (page.tsx)
   - Tabela z kolumnami: Avatar+Imię+Nazwisko, Stanowisko, Oddział, Typ umowy, Status
   - Filtry: oddział (dropdown), dział, typ umowy, status (aktywny/nieaktywny)
   - Wyszukiwarka po imieniu/nazwisku/email
   - Przycisk "Dodaj pracownika" (ADMIN only)
   
2. /hr/employees/new (page.tsx)
   - Formularz wielokrokowy (Stepper):
     Step 1: Dane osobowe (imię, nazwisko, email, telefon)
     Step 2: Zatrudnienie (typ, data rozpoczęcia, stanowisko)
     Step 3: Struktura (oddział, dział, zespół, przełożony)
   - Walidacja na każdym kroku

3. /hr/employees/[id] (page.tsx)
   - Tabs: Dane osobowe | Czas pracy | Urlopy | Historia
   - Sekcja "Dane osobowe" — edytowalny formularz inline
   - Sekcja "Czas pracy" — podsumowanie bieżącego tygodnia (reuse z Modułu 2)
   - Sekcja "Urlopy" — saldo urlopowe + lista wniosków (reuse z Modułu 3)

Komponenty (src/components/hr/employees/):
- EmployeeTable.tsx — DataTable z shadcn
- EmployeeForm.tsx — formularz z react-hook-form + zod resolver
- EmployeeCard.tsx — karta pracownika (avatar, imię, stanowisko, badge typ umowy)
- EmployeeSelect.tsx — dropdown do wyboru pracownika (reusable)
```

**Kryteria akceptacji:**
- [ ] CRUD działa end-to-end (tworzenie → lista → edycja → dezaktywacja)
- [ ] Filtry i wyszukiwarka działają
- [ ] Formularz waliduje dane (Zod schema)
- [ ] ADMIN widzi przycisk dodawania, EMPLOYEE nie
- [ ] Responsive na mobile (tabela → karty)

---

#### TASK 1.2 — Struktura Organizacyjna

**Cel:** Zarządzanie oddziałami, działami, zespołami, stanowiskami.

**Instrukcje dla subagenta:**
```
Strona: /hr/employees/structure (page.tsx) — ADMIN only

Widok drzewiasty (tree view):
  Firma (WallDecor)
  ├── Oddział Jagiellońska
  │   ├── Sprzedaż (3 osoby)
  │   └── Marketing (1 osoba)
  └── Oddział Puławska
      └── Sprzedaż (2 osoby)

Funkcjonalności:
- Dodawanie/edycja/usuwanie na każdym poziomie (inline edit)
- Drag & drop pracownika między zespołami (opcjonalne — jeśli za trudne, dropdown)
- Zliczanie pracowników na każdym poziomie
- Expand/collapse gałęzi

API:
- GET/POST/PATCH/DELETE  /api/hr/divisions
- GET/POST/PATCH/DELETE  /api/hr/departments  
- GET/POST/PATCH/DELETE  /api/hr/teams
- GET/POST/PATCH/DELETE  /api/hr/positions

Komponent: OrganizationTree.tsx (rekurencyjny, shadcn Collapsible + Tree)
```

**Kryteria akceptacji:**
- [ ] Drzewo wyświetla poprawną hierarchię
- [ ] CRUD na każdym poziomie (modal z formularzem)
- [ ] Zliczanie pracowników per węzeł
- [ ] Tylko ADMIN ma dostęp

---

### FAZA 2: Moduł Czas Pracy

---

#### TASK 2.1 — Clock In/Out + Przerwy (Employee Self-Service)

**Cel:** Rejestracja czasu pracy przez pracownika — widok jak panel TomHRM (clock in, przerwa, clock out).

**Instrukcje dla subagenta:**
```
Strona: /hr/time-tracking/clock (page.tsx)

Widok pracownika (po zalogowaniu):
┌──────────────────────────────────┐
│  Dzisiaj: Piątek, 10.10.2025    │
│                                  │
│  [🟢 Clock In: 8:01]            │
│  [☕ Przerwa: 9:15-9:20 (5m)]   │
│                                  │
│  Pracowałeś: 3h 30m   (dziś)   │
│               24h      (tydzień)│
│  Przerwy:    5m (dziś) 15m (tyg)│
│  Pozostało:  4h 30m    (dziś)   │
│               16h      (tydzień)│
│                                  │
│  [🔴 Clock Out]  [☕ Przerwa]   │
└──────────────────────────────────┘

Logika:
- Clock In → tworzy TimeEntry z clockIn = now(), clockOut = null
- Przerwa → tworzy Break z startTime = now(), endTime = null
- Koniec przerwy → aktualizuje Break.endTime = now()
- Clock Out → aktualizuje TimeEntry.clockOut = now()
  + oblicza totalMinutes, breakMinutes
  + jeśli totalMinutes > overtimeThreshold → oblicza overtimeMinutes
- Walidacja: nie można Clock In jeśli jest otwarty TimeEntry (clockOut = null)
- Walidacja: nie można Clock Out w trakcie przerwy
- Auto-refresh co 60s (timer countdown do końca dnia)

API:
- POST   /api/hr/time-tracking/clock-in
- POST   /api/hr/time-tracking/clock-out
- POST   /api/hr/time-tracking/break/start
- POST   /api/hr/time-tracking/break/end
- GET    /api/hr/time-tracking/current  — aktywny wpis (lub null)

Komponent: ClockWidget.tsx — karty z live timer (useEffect interval)
```

**Kryteria akceptacji:**
- [ ] Clock in/out flow działa pełnym cyklem
- [ ] Przerwy start/stop z poprawnym obliczaniem czasu
- [ ] Live timer aktualizuje się co sekundę
- [ ] Podsumowanie dnia i tygodnia wyliczane poprawnie
- [ ] Nie można wykonać clock in gdy jest aktywna sesja

---

#### TASK 2.2 — Ewidencja Czasu Pracy Zespołu (Manager View)

**Cel:** Widok tygodniowy czasu pracy całego zespołu — jak w TomHRM screenshot 1.

**Instrukcje dla subagenta:**
```
Strona: /hr/time-tracking (page.tsx) — ADMIN | MANAGER

Widok tabeli tygodniowej:
┌────────────────┬───────┬───────┬───────┬───────┬───────┬──┬──┬──────────┐
│                │ 06 Pn │ 07 Wt │ 08 Śr │ 09 Cz │ 10 Pt │ S│ N│ Łącznie  │
├────────────────┼───────┼───────┼───────┼───────┼───────┼──┼──┼──────────┤
│ Adamowski W.   │ 8h ✓  │7h30 ✓ │7h30   │ 9h    │8h39   │ -│ -│ 40h 39m  │
│ Bielecki P.    │7h30 ✓ │8h33 ✓ │7h39   │ L4    │ 8h    │ -│ -│ 39h 42m  │
│ Janowski P.    │8h06 ✓ │ 8h    │7h33   │7h33   │7h27   │ -│ -│ 38h 39m  │
├────────────────┼───────┼───────┼───────┼───────┼───────┼──┼──┼──────────┤
│ ŁĄCZNIE        │ 39h05 │40h22  │38h43  │40h35  │40h45  │  │  │          │
└────────────────┴───────┴───────┴───────┴───────┴───────┴──┴──┴──────────┘

Funkcje:
- Nawigacja tygodniowa (< tydzień > + datepicker)
- Filtr: oddział, dział, wszyscy/moi podwładni
- Kolor statusu: ✓ zielony (approved), pending bez ikony, L4 pomarańczowy badge
- Kliknięcie w komórkę → modal edycji wpisu (dla ADMIN/MANAGER)
- Wiersz podsumowania dziennego na dole
- Kolumna "Łącznie" z sumą tygodniową
- Weekend (S, N) — szare, dash jeśli brak wpisu
- Masowe dodawanie: zaznacz pracowników + zakres dat → modal z godzinami

API:
- GET /api/hr/time-tracking/weekly?week=2025-W41&divisionId=xxx
  Zwraca: { employees: [{ id, name, entries: { [date]: TimeEntry } }], totals: { [date]: minutes } }
- POST /api/hr/time-tracking/bulk — masowe dodawanie
  Body: { employeeIds: [], startDate, endDate, clockIn: "08:00", clockOut: "16:00" }
- PATCH /api/hr/time-tracking/[id]/approve — akceptacja wpisu
- PATCH /api/hr/time-tracking/[id]/reject

Komponenty:
- WeeklyTimesheet.tsx — główna tabela
- TimesheetCell.tsx — komórka z formatowaniem czasu + status badge
- BulkAddModal.tsx — modal masowego dodawania
- TimeEntryEditModal.tsx — edycja pojedynczego wpisu
```

**Kryteria akceptacji:**
- [ ] Tabela tygodniowa renderuje poprawne dane
- [ ] Nawigacja między tygodniami działa
- [ ] Filtry per oddział/dział
- [ ] Edycja wpisu z modala
- [ ] Masowe dodawanie wpisów (bulk)
- [ ] Akceptacja/odrzucenie wpisu (ADMIN/MANAGER)
- [ ] Podsumowanie dzienne i tygodniowe

---

#### TASK 2.3 — Grafik Czasu Pracy (Schedule)

**Cel:** Tworzenie i zarządzanie grafikami pracy.

**Instrukcje dla subagenta:**
```
Strona: /hr/time-tracking/schedule (page.tsx) — ADMIN | MANAGER

Widok:
- Kalendarz miesięczny z grafikami per pracownik
- Każdy dzień: godziny start-end (np. "8:00-16:00")
- Kolory: normalny (blue), nadgodziny (orange), dyżur (purple)
- Dni wolne (święta + custom) zaznaczone szarym tłem

Funkcje:
1. Tworzenie grafiku:
   - Wybierz pracownika/pracowników
   - Ustaw godziny per dzień tygodnia (powtarzalny wzorzec)
   - Zastosuj na zakres dat

2. Szablony grafików:
   - "Standardowy 8-16" → Pn-Pt 8:00-16:00
   - "Zmianowy poranki" → Pn-Pt 6:00-14:00
   - "Weekendowy" → Sb-Nd 10:00-18:00
   - ADMIN może tworzyć własne szablony

3. Kopiowanie grafików:
   - Kopiuj grafik pracownika X na pracownika Y
   - Kopiuj tydzień/miesiąc na kolejny okres

4. Święta:
   - Polskie święta automatycznie zaznaczone (z constants.ts)
   - Custom holidays per oddział
   - Auto-aktualizacja kalendarza świąt na kolejny rok

API:
- GET    /api/hr/schedules?month=2025-10&employeeId=xxx
- POST   /api/hr/schedules — tworzenie/aktualizacja
- POST   /api/hr/schedules/template — zastosuj szablon
- POST   /api/hr/schedules/copy — kopiuj grafik
- GET    /api/hr/holidays?year=2025&divisionId=xxx
- POST   /api/hr/holidays — dodaj custom holiday

Komponenty:
- ScheduleCalendar.tsx — widok miesięczny
- ScheduleTemplateModal.tsx — wybór/tworzenie szablonu
- HolidayManager.tsx — zarządzanie dniami wolnymi
```

**Kryteria akceptacji:**
- [ ] Grafik wyświetla poprawne godziny per pracownik per dzień
- [ ] Szablon "Standardowy 8-16" poprawnie wypełnia Pn-Pt
- [ ] Kopiowanie grafiku z pracownika na pracownika
- [ ] Święta polskie automatycznie widoczne
- [ ] Custom holidays per oddział

---

#### TASK 2.4 — Okresy Rozliczeniowe + Nadgodziny

**Cel:** Zarządzanie okresami rozliczeniowymi, wnioski o nadgodziny.

**Instrukcje dla subagenta:**
```
Strona: /hr/time-tracking/periods (page.tsx) — ADMIN

Lista okresów:
- Nazwa (np. "Październik 2025")
- Data od – do
- Status: Otwarty / Zamknięty / Zablokowany
- Akcje: Zamknij okres → blokuje edycję wpisów w tym zakresie

Strona: /hr/time-tracking/overtime
- Lista wniosków o nadgodziny
- Formularz: data, liczba godzin/minut, powód
- Akceptacja/odrzucenie (MANAGER/ADMIN)
- Rozliczenie: jako czas wolny (OT) lub wypłata

API:
- CRUD /api/hr/billing-periods
- POST /api/hr/billing-periods/[id]/close
- CRUD /api/hr/overtime-requests
- PATCH /api/hr/overtime-requests/[id]/approve
```

**Kryteria akceptacji:**
- [ ] Tworzenie i zamykanie okresów
- [ ] Zamknięty okres blokuje edycję TimeEntry w tym zakresie
- [ ] Wniosek o nadgodziny → akceptacja → rozliczenie

---

#### TASK 2.5 — Raporty Czasu Pracy

**Cel:** Generowanie raportów miesięcznych, projektowych, zbiorczych.

**Instrukcje dla subagenta:**
```
Strona: /hr/time-tracking/reports (page.tsx)

Raporty (każdy jako tab):

1. Karta czasu pracy (per pracownik, per miesiąc)
   - Dzień | Wejście | Wyjście | Przerwy | Czas netto | Nadgodziny | Projekt
   - Podsumowanie: łączny czas, łączne nadgodziny, dni obecności
   - Eksport: PDF (do wydruku), CSV

2. Raport miesięczny listy obecności
   - Tabela: Pracownik | Dni obecności | Godziny | Nadgodziny | Nieobecności
   - Per oddział / cała firma
   
3. Raport nadgodzin
   - Pracownik | Łącznie nadgodzin | Rozliczone | Do rozliczenia | Status

4. Raport projektowy
   - Projekt | Pracownik | Godziny | % czasu
   - Pivot: per projekt vs per pracownik

5. Raport realizacji planu
   - Pracownik | Zaplanowano (grafik) | Przepracowano | Różnica | %

Filtry globalne: okres (miesiąc/zakres dat), oddział, dział, pracownik
Auto-raport na email: ADMIN może ustawić cykliczne wysyłanie (weekly/monthly)

API:
- GET /api/hr/reports/timecard?employeeId=xxx&month=2025-10
- GET /api/hr/reports/attendance?month=2025-10&divisionId=xxx
- GET /api/hr/reports/overtime?month=2025-10
- GET /api/hr/reports/projects?month=2025-10
- GET /api/hr/reports/plan-vs-actual?month=2025-10

Eksport:
- Każdy raport ma przycisk "Eksport CSV" i "Eksport PDF"
- CSV: generowany server-side, zwracany jako blob
- PDF: użyj @react-pdf/renderer lub generuj HTML → PDF server-side
```

**Kryteria akceptacji:**
- [ ] 5 typów raportów renderuje poprawne dane
- [ ] Filtry (okres, oddział, pracownik) działają
- [ ] Eksport CSV pobiera plik
- [ ] Eksport PDF generuje czytelny dokument

---

### FAZA 3: Moduł Urlopy / Nieobecności

---

#### TASK 3.1 — Typy Urlopów + Saldo

**Cel:** Zarządzanie typami urlopów, saldo per pracownik.

**Instrukcje dla subagenta:**
```
Strona: /hr/leave/types (page.tsx) — ADMIN only

Lista typów urlopów (jak na screenshocie 3):
- Nazwa | Kod | Kolor | Płatny | Wymaga akceptacji | Max dni/rok | Aktywny
- Edycja inline lub modal
- Obsługa podtypów (Urlop na żądanie jest podtypem VL)
- Przycisk "+ Dodaj nowy typ urlopu"

Strona: /hr/leave/balances (page.tsx) — ADMIN | MANAGER
- Tabela: Pracownik | Typ urlopu | Przysługuje | Wykorzystane | Oczekujące | Pozostałe | Przeniesione
- Edycja salda (ADMIN only) — np. korekta ręczna
- Automatyczne przenoszenie niewykorzystanych dni na nowy rok (konfigurowalny limit)

API:
- CRUD /api/hr/leave-types
- GET  /api/hr/leave-balances?employeeId=xxx&year=2025
- PATCH /api/hr/leave-balances/[id] — korekta ręczna
- POST /api/hr/leave-balances/carryover — przeniesienie na nowy rok

Komponent: LeaveBalanceCard.tsx — wizualne saldo (progress bar z kolorami)
```

**Kryteria akceptacji:**
- [ ] CRUD typów urlopów z podtypami
- [ ] Saldo wyświetla poprawne wartości
- [ ] Korekta ręczna działa (ADMIN)
- [ ] Przeniesienie na nowy rok kalkuluje poprawnie

---

#### TASK 3.2 — Wnioski Urlopowe (Employee Self-Service)

**Cel:** Składanie wniosków urlopowych — jak na screenshocie 3.

**Instrukcje dla subagenta:**
```
Strona: /hr/leave/requests (page.tsx)

Widok pracownika:
- Lista moich wniosków z filtrami (status, typ, okres)
- Przycisk "Złóż wniosek"

Formularz wniosku (LeaveRequestForm.tsx):
┌──────────────────────────────────────┐
│ Złóż wniosek: Urlopy                │
│                                      │
│ Wybierz typ urlopu *                 │
│ [VL Urlop wypoczynkowy (26 dni)]  ▼  │
│                                      │
│ □ Urlop na żądanie                   │
│                                      │
│ W terminie od    do          Dni     │
│ [2025-10-01] [2025-10-03]   [3]     │
│                                      │
│ Zastępuje mnie                       │
│ [Wybierz pracownika]                 │
│ □ Powiadom zastępcę                  │
│                                      │
│ Notatka                              │
│ [________________]                   │
│                                      │
│ Dokumenty                            │
│ [Przeciągnij i upuść]                │
│                                      │
│ [Złóż wniosek]  [Anuluj]            │
└──────────────────────────────────────┘

Logika:
- Wybór typu urlopu → pokazuje dostępne saldo
- DateRange picker → auto-kalkulacja dni roboczych (pomija weekendy + święta)
- Walidacja: czy wystarczająco saldo, czy nie koliduje z innym wnioskiem
- Po złożeniu: status = "pending", wysłanie notyfikacji do managera
- Urlop na żądanie: checkbox, max 4 w roku (walidacja)

API:
- GET  /api/hr/leave-requests?employeeId=xxx&status=pending
- POST /api/hr/leave-requests — złożenie wniosku
- DELETE /api/hr/leave-requests/[id] — anulowanie (tylko pending)
```

**Kryteria akceptacji:**
- [ ] Formularz waliduje saldo (nie pozwala na więcej niż dostępne)
- [ ] Kalkulacja dni roboczych pomija weekendy i święta
- [ ] Wniosek na żądanie limitowany do 4/rok
- [ ] Zastępca otrzymuje powiadomienie (jeśli zaznaczono)
- [ ] Status "pending" po złożeniu

---

#### TASK 3.3 — Akceptacja Wniosków + Ścieżki Akceptacji

**Cel:** Widok managera do akceptacji/odrzucania wniosków.

**Instrukcje dla subagenta:**
```
Strona: /hr/leave/approval (page.tsx) — ADMIN | MANAGER

Lista wniosków do akceptacji:
- Filtr: status (Planowany, Do rozpatrzenia, Zaakceptowany, Odrzucony, Anulowany)
- Filtr: typ, okres, pracownik
- Tabela jak na screenshocie 4:
  Pracownik | Typ | Data od | Data do | Wymiar | Status

Akcje:
- Akceptuj → status = "approved", aktualizacja LeaveBalance.usedDays
- Odrzuć → status = "rejected" + wymagana notatka (rejectionNote)
- Każda akcja → notyfikacja email do pracownika

Ścieżka akceptacji (konfigurowalna):
- Domyślna: przełożony bezpośredni
- Wielopoziomowa: przełożony → HR Manager → dyrektor (opcja na przyszłość)
- Typ "auto-approve": np. praca zdalna okazjonalna — auto akceptacja

Eksport: przycisk "Eksport do pliku" → CSV z listą wniosków

API:
- GET   /api/hr/leave-requests/pending — wnioski do akceptacji (dla managera)
- PATCH /api/hr/leave-requests/[id]/approve
- PATCH /api/hr/leave-requests/[id]/reject — body: { rejectionNote }
- GET   /api/hr/leave-requests/export?format=csv&...filters
```

**Kryteria akceptacji:**
- [ ] Manager widzi tylko wnioski swoich podwładnych
- [ ] Akceptacja aktualizuje saldo urlopowe
- [ ] Odrzucenie wymaga notatki
- [ ] Eksport CSV działa
- [ ] Notyfikacja email po akcji

---

#### TASK 3.4 — Kalendarz Nieobecności

**Cel:** Firmowy kalendarz nieobecności — jak na screenshocie 2.

**Instrukcje dla subagenta:**
```
Strona: /hr/leave (page.tsx) — calendar view

Widok miesięczny (jak TomHRM screenshot 2):
┌─────────────────────────────────────────────────────────┐
│ Przegląd nieobecności                                   │
│ 79 Obecni | 5 Praca zdalna | 15 Nieobecni | 23 Plan.   │
├─────────────────────────────────────────────────────────┤
│ < Maj  Czerwiec  Lipiec >        [Dziś]                │
│ Nieobecni ● Obecni ● Praca zdalna ● Pokaż plany ●     │
│ Pokazano łącznie: 15 pracowników                       │
├──────────┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬───────────┤
│Pracownik │01│02│03│04│05│06│07│08│09│10│...│30         │
│Bielecki  │  │  │  │  │  │▓▓│▓▓│▒▒│  │  │  │          │
│Adamowski │  │  │──│──│──│──│──│  │  │  │  │          │
└──────────┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴───────────┘

Legenda kolorów:
- Urlop wypoczynkowy: niebieski
- L4/chorobowe: czerwony
- Praca zdalna: zielony
- Delegacja: fioletowy
- Custom: kolor z LeaveType

Topbar z KPI:
- Obecni w firmie (count + %)
- Praca zdalna
- Nieobecni
- Planowane nieobecności (przyszły tydzień)
- Wnioski do akceptacji (MANAGER badge)

Filtry toggle:
- Nieobecni | Obecni | Praca zdalna | Pokaż plany

Kliknięcie w kolorowy blok → popover ze szczegółami wniosku

API:
- GET /api/hr/leave/calendar?month=2025-06&divisionId=xxx
  Zwraca: { employees: [{ id, name, leaves: [{ startDate, endDate, type, color, status }] }] }
- GET /api/hr/leave/summary?date=2025-06-10
  Zwraca: { present, remote, absent, plannedNext }

Komponenty:
- AbsenceCalendar.tsx — siatka miesięczna
- AbsenceTopBar.tsx — KPI karty na górze
- AbsencePopover.tsx — szczegóły po kliknięciu
```

**Kryteria akceptacji:**
- [ ] Kalendarz miesięczny wyświetla nieobecności z poprawnymi kolorami
- [ ] Topbar z KPI (obecni/zdalni/nieobecni/planowane)
- [ ] Filtry toggle działają
- [ ] Popover ze szczegółami wniosku
- [ ] Weekend i święta wyróżnione

---

### FAZA 4: Integracje + Polish

---

#### TASK 4.1 — Integracja Google Calendar

**Cel:** Sync nieobecności z Google Calendar.

**Instrukcje dla subagenta:**
```
Plik: src/lib/hr/google-calendar.ts

Integracja dwukierunkowa:
1. Leave → GCal: zaakceptowany urlop tworzy event w kalendarzu pracownika
   - Tytuł: "[VL] Urlop wypoczynkowy - Jan Kowalski"
   - All-day event(s)
   - Kolor eventów: mapowanie z LeaveType.color
   
2. GCal → Leave: opcjonalnie, import eventów oznaczonych tagiem

Użyj Google Calendar API via OAuth (NextAuth provider lub service account).
Zapisuj gcalEventId w LeaveRequest — przy edycji/anulowaniu aktualizuj/usuwaj event.

Konfiguracja w settings: 
- Włącz/wyłącz sync
- Wybierz kalendarz docelowy
- Mapowanie typów urlopów na kolory GCal
```

**Kryteria akceptacji:**
- [ ] Akceptacja urlopu tworzy event w GCal
- [ ] Anulowanie urlopu usuwa event
- [ ] Edycja dat → aktualizacja eventu
- [ ] Konfiguracja per-user (wybór kalendarza)

---

#### TASK 4.2 — Powiadomienia Email

**Cel:** System powiadomień email + in-app.

**Instrukcje dla subagenta:**
```
Eventy triggerujące powiadomienia:

| Event                     | Odbiorca          | Email | In-app |
|---------------------------|--------------------|-------|--------|
| Nowy wniosek urlopowy     | Manager            | ✓     | ✓      |
| Urlop zaakceptowany       | Pracownik          | ✓     | ✓      |
| Urlop odrzucony           | Pracownik          | ✓     | ✓      |
| Zastępstwo przydzielone   | Zastępca           | ✓     | ✓      |
| Wniosek o nadgodziny      | Manager            | ✓     | ✓      |
| Okres zamknięty           | Wszyscy w oddziale | ✓     | ✓      |
| Brak clock-in (po 9:00)   | Pracownik+Manager  | ✓     | ✓      |
| Raport automatyczny       | ADMIN              | ✓     | ✗      |

Implementacja:
- src/lib/hr/notifications.ts — sendNotification(type, recipientId, data)
- Email: nodemailer lub Resend (konfiguracja w .env)
- In-app: zapisz do tabeli Notification, wyświetl w bell icon (header)
- Szablony email w HTML (src/lib/hr/email-templates/)

Komponent: NotificationBell.tsx — ikona dzwonka z badge count, dropdown z listą
```

**Kryteria akceptacji:**
- [ ] Email wysyłany przy akceptacji/odrzuceniu urlopu
- [ ] Notyfikacja in-app pojawia się w czasie rzeczywistym (polling co 30s)
- [ ] NotificationBell z badge count i dropdown
- [ ] Mark as read

---

#### TASK 4.3 — Polish, Testy E2E, Dokumentacja

**Cel:** Końcowa integracja, testy, dokumentacja.

**Instrukcje dla subagenta:**
```
1. Testy E2E (Vitest + Testing Library):
   - Flow: Tworzenie pracownika → Clock in → Przerwa → Clock out → Sprawdź ewidencję
   - Flow: Złóż wniosek urlopowy → Manager akceptuje → Saldo się aktualizuje
   - Flow: Masowe dodanie czasu pracy → Raport miesięczny

2. Responsive audit:
   - Wszystkie strony na mobile (375px)
   - Tabele → karty na małych ekranach
   - Sidebar → hamburger menu

3. Accessibility:
   - Aria labels na przyciskach
   - Keyboard navigation w tabelach i modalach
   - Focus management

4. Dokumentacja:
   - README.md dla modułu HR
   - API documentation (lista endpointów z przykładami)
   - Instrukcja konfiguracji (env vars, Google Calendar setup)
```

**Kryteria akceptacji:**
- [ ] Testy E2E passing
- [ ] Mobile responsive na wszystkich stronach
- [ ] README z instrukcją uruchomienia

---

## REGUŁY DLA ORKIESTRATORA

### Kolejność wykonania
```
FAZA 0: 0.1 → 0.2 → 0.3       (sekwencyjnie — fundament)
FAZA 1: 1.1 → 1.2              (sekwencyjnie — pracownicy)
FAZA 2: 2.1 ∥ 2.2 → 2.3 → 2.4 → 2.5  (2.1 i 2.2 mogą równolegle)
FAZA 3: 3.1 → 3.2 → 3.3 → 3.4        (sekwencyjnie)
FAZA 4: 4.1 ∥ 4.2 → 4.3              (4.1 i 4.2 mogą równolegle)
```

### Zależności między taskami
```
0.1 (Prisma) → WSZYSTKO
0.2 (Utils)  → 2.1, 2.2, 2.5, 3.2, 3.4
0.3 (Layout) → 1.1, 2.1, 3.1
1.1 (CRUD)   → 1.2, 2.1, 2.2, 3.2  (EmployeeSelect reusable)
2.1 (Clock)  → 2.2 (TimeEntry model shared)
3.1 (Types)  → 3.2 (LeaveType required)
3.2 (Wnioski) → 3.3 (LeaveRequest required)
3.3 (Akcept.) → 3.4 (approved leaves shown)
```

### Zasady delegowania do subagenta
1. Każdy task() zawiera:
   - PEŁNY kontekst (stack, ścieżki plików, schemat DB)
   - Konkretne instrukcje implementacyjne
   - Kryteria akceptacji (checklist)
   - Referencje do plików, które musi zaimportować

2. Subagent NIE MOŻE:
   - Modyfikować schema.prisma (chyba że Task 0.1)
   - Zmieniać struktury katalogów
   - Instalować niezatwierdzonych bibliotek
   - Zmieniać konfiguracji NextAuth

3. Subagent MUSI:
   - Używać komponentów shadcn/ui (nie pisać custom UI od zera)
   - Eksportować wszystko z nazwanego eksportu (nie default)
   - Walidować dane Zod na API routes
   - Obsługiwać błędy (try/catch + proper HTTP codes)
   - Pisać TypeScript strict (no any)

### Walidacja po każdym tasku
Po zakończeniu tasku, orkiestrator:
1. `npx tsc --noEmit` — brak błędów TypeScript
2. `npx vitest run` — testy przechodzą
3. `npm run build` — build się kompiluje
4. Manual smoke test na kluczowej ścieżce

### Komunikacja między subagentami
- Współdzielone typy: `src/lib/hr/schemas.ts` i `src/lib/hr/constants.ts`
- Współdzielone komponenty: `src/components/hr/` (EmployeeSelect, RoleGuard, etc.)
- Jeśli subagent potrzebuje komponentu z innego tasku, definiuje interfejs i stub,
  a następny subagent implementuje.
