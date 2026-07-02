# WallDecor HR Module — Dokumentacja implementacji

## Status: WDROŻONY + UTWARDZONY (2026-07-02)

---

## Stack

- Next.js 16.1.6 (App Router, Turbopack)
- TypeScript strict
- Prisma 5.22 + SQLite (`walldecor.db`)
- Prisma client: `src/generated/prisma` (nie `@prisma/client`)
- NextAuth v4 (role: `ADMIN | MANAGER | EMPLOYEE`)
- Tailwind CSS + shadcn/ui + Lucide icons
- jspdf + jspdf-autotable (raporty PDF)
- Node.js 25

---

## Krytyczne decyzje techniczne

| Decyzja | Szczegół |
|---|---|
| Prisma client path | `src/generated/prisma` — NIE `@prisma/client` |
| SQLite enums | `String` zamiast native enum — SQLite brak wsparcia; walidacja Zod w runtime |
| Produkcja — migracje | `db push --accept-data-loss` (nie `migrate deploy`) — brak plików migracji w repo |
| Next.js 16 params | `params` to `Promise<{ id: string }>` — zawsze `await params` przed użyciem |
| HR layout | `hr/layout.tsx` renderuje TYLKO `children` — bez dodatkowego panelu bocznego |
| HR strony pod | `app/(dashboard)/hr/` — NIE `app/(auth)/hr/` |
| Soft-hide pracownika | `active = false` zachowuje dane historyczne; hard delete zablokowany gdy istnieją `TimeEntry` lub `LeaveRequestNew` |
| Middleware | `src/proxy.ts` (nie `middleware.ts`) |
| Testy | Vitest (51 testów HR), Playwright E2E (skonfigurowany) |
| HR Settings | Klucze `AppSetting`: `hr_saturday_workable`, `hr_standard_clock_in`, `hr_standard_clock_out`, `hr_overtime_threshold_minutes` |

---

## Zaimplementowane modele Prisma (nowe)

**Struktura organizacyjna:** `Division`, `Department`, `Team`, `Position`

**Czas pracy:** `TimeEntry`, `Break`, `Project`, `WorkSchedule`, `TimeTrackingRule`, `BillingPeriod`, `OvertimeRequest`

**Urlopy:** `LeaveType`, `LeaveBalanceNew`, `LeaveRequestNew`, `CustomHoliday`

**Inne:** `Notification`, `BudgetThreshold`

**Rozszerzony `Employee`:** `employmentType`, `avatarUrl`, `divisionId`, `departmentId`, `teamId`, `positionId`, `managerId`, `active` (bool)

**Rozszerzony `User`:** `isActive` (bool) — blokada logowania w NextAuth `authorize` callback

---

## Zaimplementowane moduły

### M6 — HR: Pracownicy

**API:**
- `GET /api/hr/employees` — lista z paginacją, filtry (dział, stanowisko, status)
- `POST /api/hr/employees` — dodaj pracownika
- `GET /api/hr/employees/[id]` — profil pracownika
- `PATCH /api/hr/employees/[id]` — edycja profilu
- `DELETE /api/hr/employees/[id]` — soft-hide (`active=false`) lub hard delete (z guardem)

**Strony:**
- `/hr/employees` — tabela z filtrami, wyszukiwanie, paginacja
- `/hr/employees/new` — formularz 3-step stepper (Dane osobowe → Zatrudnienie → Uprawnienia)
- `/hr/employees/[id]` — profil z zakładkami: Dane / Czas pracy / Urlopy
- `/hr/employees/[id]/edit` — formularz edycji
- `/hr/employees/structure` — drzewko organizacyjne (Division → Department → Team)

**Funkcje:**
- Przycisk "..." dropdown w liście i profilu (ADMIN): Edytuj / Ukryj / Usuń
- Soft-hide: `active = false` zachowuje dane historyczne
- Hard delete zablokowany gdy istnieją `TimeEntry` lub `LeaveRequestNew`
- Poufne relacje (`contracts`, `additionalContracts`, `salaryHistory`) są dostępne tylko dla ADMIN.
- EMPLOYEE widzi tylko własny profil; MANAGER widzi tylko aktywnych pracowników z własnego oddziału.

---

### M7 — HR: Urlopy

**API:**
- `GET/POST /api/hr/leave/types` — typy urlopów CRUD
- `GET/POST /api/hr/leave/balances` — salda urlopowe CRUD
- `GET/POST /api/hr/leave-requests` — wnioski urlopowe
- `PATCH /api/hr/leave-requests/[id]/approve` — zatwierdzenie (Prisma transaction: update status + saldo)

**Strony:**
- `/hr/leave` — AbsenceCalendar: grid miesięczny z KPI topbar (Obecni / Zdalna / Nieobecni)
- `/hr/leave/types` — CRUD typów urlopów
- `/hr/leave/balances` — salda z progress bar per pracownik

**Funkcje:**
- `LeaveRequestForm` — zakres dat, live working-days calc, walidacja salda
- Approval flow z Prisma transaction: zmiana statusu + odjęcie dni z salda atomowo
- Admin może manualnie złożyć wniosek dla dowolnego pracownika (`EmployeeSelect` w formularzu)
- MANAGER akceptuje, eksportuje i przegląda tylko wnioski pracowników z własnego oddziału.

---

### M8 — HR: Czas pracy

**API:**
- `POST /api/hr/time-tracking/clock-in` — rejestracja wejścia
- `POST /api/hr/time-tracking/clock-out` — rejestracja wyjścia
- `POST /api/hr/time-tracking/break` — przerwa
- `POST /api/hr/time-tracking/bulk-approve` — bulk zatwierdzenie wpisów
- `GET/POST /api/hr/time-tracking/periods` — okresy rozliczeniowe
- `GET/POST /api/hr/overtime-requests` — wnioski nadgodzinowe

**Strony:**
- `/hr/time-tracking` — ClockWidget + widok bieżącego dnia
- `/hr/time-tracking/periods` — BillingPeriod management
- `/hr/time-tracking/overtime` — OvertimeRequest lista i formularz
- `/hr/time-tracking/reports` — 5 typów CSV + 6. tab raport PDF miesięczny (jspdf + jspdf-autotable)

**Komponenty:**
- `ClockWidget` — live timer, dark card, przyciski green/red/amber (clock-in/out/break)
- `WeeklyTimesheet` — widok managera, tydzień PN–ND, approve/reject per wpis
- BULK approve: checkboxy + floating action bar "Zatwierdź/Odrzuć zaznaczone"
- `ScheduleCalendar` — grafik miesięczny, szablony zmian
- Endpointy weekly, bulk, schedule, approve/reject i raporty stosują scoping HR po roli.

**Reguły biznesowe:**
- Soboty klikalne gdy `hr_saturday_workable=true`, badge "OT 2×" (orange), blokada gdy święto ustawowe
- Nadgodziny: próg konfigurowalny przez `hr_overtime_threshold_minutes`

---

### Granice bezpieczeństwa HR po hardeningu 2026-07-02

| Rola | Zakres |
|---|---|
| ADMIN | Pełen HR, dane płacowe, umowy, wszystkie oddziały, wszystkie raporty |
| MANAGER | Tylko własny oddział; bez danych płacowych i bez fallbacku do pełnej firmy przy braku podpiętego profilu |
| EMPLOYEE | Tylko własny profil, własne wnioski i własny czas pracy |

Centralny helper: `src/lib/hr/access.ts`.

Stare route’y `/hr`, `/hr/leaves`, `/hr/timesheets` przekierowują do aktywnych modułów.

Poza zakresem M6-M8: automatyczny cron/e-mail do kadrowej i sejf dokumentów pracowniczych. Te funkcje wymagają osobnego projektu storage, retencji i audytu dostępu.

---

### M5 — Alerty i przypomnienia

**API:**
- `GET/POST /api/alerts/thresholds` — BudgetThreshold CRUD (warning/critical %)
- `GET/POST /api/alerts/payment-reminders` — PaymentReminder CRUD (dzień miesiąca + alertDaysInAdvance)
- `POST /api/alerts/check` — silnik sprawdzający: przekroczenia budżetu + zbliżające się płatności, dedup

**UI:**
- `AlertsWidget` na dashboardzie (ADMIN)
- `NotificationBell` rozszerzony o typy: `budget_warning` (amber AlertTriangle), `budget_critical` (red AlertOctagon), `payment_due` (blue CreditCard)

---

### Zarządzanie kontami użytkowników (`/settings/users`, ADMIN)

**API:**
- `GET /api/users` — lista kont
- `POST /api/users` — utwórz konto
- `PATCH /api/users/[id]` — zmień rolę lub `isActive`
- `DELETE /api/users/[id]` — usuń konto
- `POST /api/users/[id]/reset-password` — generuje tymczasowe hasło

**UI:**
- Tabela z role badges, toggle aktywny/zablokowany
- Dialog zmiany roli, copyable temp password
- `User.isActive = false` blokuje logowanie w NextAuth `authorize` callback

---

### HR Settings (`/settings/hr`, ADMIN)

Klucze `AppSetting`:
- `hr_saturday_workable` — czy sobota jest robocza
- `hr_standard_clock_in` — standardowa godzina przyjścia
- `hr_standard_clock_out` — standardowa godzina wyjścia
- `hr_overtime_threshold_minutes` — próg (minuty) powyżej którego naliczane są nadgodziny

---

## Poprawki po testach użytkownika

### Bug 1 — Double navigation (hr/layout.tsx)
**Root cause:** `hr/layout.tsx` renderował `HrSidebar` jako dodatkowy panel obok globalnego sidebaru — podwójna nawigacja.
**Fix:** Usunięto `HrSidebar` z layout — plik renderuje tylko `{children}`.

### Bug 2 — Produkcja P2021 (Prisma migrate)
**Root cause:** Entrypoint Docker używał `prisma migrate deploy`, ale w repo nie ma plików migracji — Prisma rzucał P2021.
**Fix:** Zmieniono na `prisma db push --accept-data-loss`.

### Bug 3 — Next.js 16 params nie kompiluje się
**Root cause:** `{ params: { id: string } }` nie jest poprawnym typem w Next.js 16 — `params` to `Promise`.
**Fix:** `{ params: Promise<{ id: string }> }` + `const { id } = await params`. Dotknięte pliki: `alerts/thresholds/[id]`, `alerts/payment-reminders/[id]`, `users/[id]`, `users/[id]/reset-password`.

### Bug 4 — onClick w Server Component (employees/page.tsx)
**Root cause:** `<td onClick={...}>` użyty w Server Component — Next.js zabrania event handlerów w SC.
**Fix:** Usunięto handler `onClick` z komponentu serwerowego.

### Bug 5 — "Dodaj wpis" Invalid input (notes: null)
**Root cause:** Modal wysyłał `notes: null` gdy pole puste, ale schemat Zod używał `.optional()` — `optional` nie akceptuje `null`.
**Fix:** Zmieniono na `undefined` zamiast `null` przy pustym polu.

### Bug 6 — "Zapisz zmiany" pracownika Invalid input (puste pola enum/string)
**Root cause:** Formularz edycji wysyłał `employmentType: ""` i `phone: null` — schemat Zod odrzucał puste stringi dla enum fields i null dla string fields.
**Fix:** Schema rozszerzona o `.nullish()` dla clearable fields; pola enum omijane gdy puste (nie wysyłane w payload).

---

## Struktura plików (kluczowe nowe pliki)

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── hr/
│   │   │   ├── layout.tsx                          # Tylko {children} — bez dodatkowego sidebaru
│   │   │   ├── employees/
│   │   │   │   ├── page.tsx                        # Lista pracowników (tabela + filtry)
│   │   │   │   ├── new/page.tsx                    # 3-step stepper
│   │   │   │   ├── structure/page.tsx              # Drzewko org
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx                    # Profil (zakładki)
│   │   │   │       └── edit/page.tsx               # Formularz edycji
│   │   │   ├── time-tracking/
│   │   │   │   ├── page.tsx                        # ClockWidget + bieżący dzień
│   │   │   │   ├── periods/page.tsx                # BillingPeriod
│   │   │   │   ├── overtime/page.tsx               # OvertimeRequest
│   │   │   │   └── reports/page.tsx                # CSV + PDF raporty
│   │   │   └── leave/
│   │   │       ├── page.tsx                        # AbsenceCalendar
│   │   │       ├── types/page.tsx                  # LeaveType CRUD
│   │   │       └── balances/page.tsx               # Salda z progress bar
│   │   └── settings/
│   │       ├── hr/page.tsx                         # HR Settings (ADMIN)
│   │       └── users/page.tsx                      # User accounts (ADMIN)
│   └── api/
│       ├── hr/
│       │   ├── employees/
│       │   │   ├── route.ts                        # GET list, POST create
│       │   │   └── [id]/route.ts                   # GET, PATCH, DELETE
│       │   ├── time-tracking/
│       │   │   ├── clock-in/route.ts
│       │   │   ├── clock-out/route.ts
│       │   │   ├── break/route.ts
│       │   │   ├── bulk-approve/route.ts
│       │   │   ├── periods/route.ts
│       │   │   └── overtime/route.ts
│       │   └── leave/
│       │       ├── types/route.ts
│       │       ├── balances/route.ts
│       │       ├── requests/route.ts
│       │       └── requests/[id]/approve/route.ts
│       ├── alerts/
│       │   ├── thresholds/route.ts
│       │   ├── thresholds/[id]/route.ts
│       │   ├── payment-reminders/route.ts
│       │   ├── payment-reminders/[id]/route.ts
│       │   └── check/route.ts
│       ├── users/
│       │   ├── route.ts
│       │   └── [id]/
│       │       ├── route.ts
│       │       └── reset-password/route.ts
│       └── notifications/
│           └── [id]/route.ts
└── components/
    └── hr/
        ├── ClockWidget.tsx
        ├── WeeklyTimesheet.tsx
        ├── ScheduleCalendar.tsx
        ├── AbsenceCalendar.tsx
        ├── LeaveRequestForm.tsx
        └── NotificationBell.tsx
```

---

## Design system WallDecor

```css
--wd-off-white:  #F7F6F4   /* tło aplikacji */
--wd-dark:       #1E1E1E   /* sidebar, primary button */
--wd-sand:       #E4DCD1   /* akcent, active states */
--wd-border:     #E8E6E3
--wd-text-muted: #8A8582
--wd-surface-2:  #F3F2F0   /* alternating rows */
```

**Semantic colors (HR):**
- `green-600` — zatwierdzono / obecny
- `amber-600` — oczekuje / ostrzeżenie budżetowe
- `red-600` — odrzucono / krytyczne budżetowe
- `blue-600` — zdalna / informacja (payment_due)
- `orange-600` — nadgodziny OT 2×

**Reguły komponentów:**
- `ClockWidget` — dark card (`bg-[#1E1E1E]`), live timer, kolorowe przyciski statusu
- Tabele — `alternating rows` z `--wd-surface-2`, sticky header
- Badges — rounded-full, semantic color
- Formularze — walidacja Zod, inline error messages
- Modals — shadcn Dialog z focus trap

---

## API endpoints

### HR: Pracownicy
| Method | Path | Opis |
|---|---|---|
| GET | `/api/hr/employees` | Lista (paginated, filtry) |
| POST | `/api/hr/employees` | Dodaj pracownika |
| GET | `/api/hr/employees/[id]` | Profil |
| PATCH | `/api/hr/employees/[id]` | Edycja |
| DELETE | `/api/hr/employees/[id]` | Soft-hide lub hard delete |

### HR: Czas pracy
| Method | Path | Opis |
|---|---|---|
| POST | `/api/hr/time-tracking/clock-in` | Rejestracja wejścia |
| POST | `/api/hr/time-tracking/clock-out` | Rejestracja wyjścia |
| POST | `/api/hr/time-tracking/break` | Przerwa |
| POST | `/api/hr/time-tracking/bulk-approve` | Bulk zatwierdzenie |
| GET/POST | `/api/hr/time-tracking/periods` | Okresy rozliczeniowe |
| GET/POST | `/api/hr/overtime-requests` | Wnioski nadgodzinowe |

### HR: Urlopy
| Method | Path | Opis |
|---|---|---|
| GET/POST | `/api/hr/leave/types` | Typy urlopów CRUD |
| GET/POST | `/api/hr/leave/balances` | Salda urlopowe CRUD |
| GET/POST | `/api/hr/leave/requests` | Wnioski urlopowe |
| PATCH | `/api/hr/leave-requests/[id]/approve` | Zatwierdzenie (transakcja) |

### Alerty
| Method | Path | Opis |
|---|---|---|
| GET/POST | `/api/alerts/thresholds` | BudgetThreshold CRUD |
| PATCH/DELETE | `/api/alerts/thresholds/[id]` | Edycja/usunięcie progu |
| GET/POST | `/api/alerts/payment-reminders` | PaymentReminder CRUD |
| PATCH/DELETE | `/api/alerts/payment-reminders/[id]` | Edycja/usunięcie |
| POST | `/api/alerts/check` | Silnik sprawdzania alertów |

### Zarządzanie użytkownikami
| Method | Path | Opis |
|---|---|---|
| GET/POST | `/api/users` | Lista kont / utwórz konto |
| PATCH/DELETE | `/api/users/[id]` | Zmień rolę/isActive / usuń |
| POST | `/api/users/[id]/reset-password` | Reset hasła (temp password) |

### Powiadomienia
| Method | Path | Opis |
|---|---|---|
| PATCH/DELETE | `/api/notifications/[id]` | Oznacz jako przeczytane / usuń |

---

## Znane ograniczenia / TODO

- **M9 — Migracja danych:** Import pracowników i danych historycznych z Excela 2025 — nie rozpoczęty
- **Google Calendar:** `lib/hr/google-calendar.ts` zaplanowany, nie zaimplementowany
- **Raport PDF:** Generowany server-side przez `jspdf`/`jspdf-autotable`; przy dużej ilości danych może wymagać kolejki/asynchronicznego generowania
- **Testy HR:** Brak unit testów dla szczegółowych kalkulacji nadgodzin i sald urlopowych (poza regresją dostępu i utils)
- **Dokumenty pracownicze:** Brak sejfu dokumentów; wymaga osobnego modelu storage, retencji i audytu
- **Automatyczna wysyłka do kadrowej:** Brak crona i logu wysyłek; obecnie raporty miesięczne są generowane ręcznie
- **AbsenceCalendar** — KPI topbar (Obecni/Zdalna/Nieobecni) bazuje na `LeaveRequestNew`; nie uwzględnia wpisów `TimeEntry` z typem `remote`
- **Company model** — zdefiniowany w schema ale bez UI — Division/Department nie są powiązane z Company w aktualnym UI
- **Paginacja** — employees lista ma paginację serwerową, ale pozostałe listy HR (urlopy, wpisy czasu) są stronicowane client-side
