# Project Status — WallDecor App

**Ostatnia aktualizacja:** 2026-03-30 (Sesja 9 — HR: ręczne zarządzanie saldem urlopowym)

---

## Status ogólny

```
M1  — Project Bootstrap           [x] Ukończone (2026-03-01)
M2  — Budżet: Planowanie          [x] Ukończone (2026-03-02)
M3  — Budżet: Wykonanie (+ P&L)   [x] Ukończone (2026-03-02)
M4  — Dashboard KPI + CSS         [x] Ukończone (2026-03-02)
M5  — Alerty i przypomnienia      [ ] Nie rozpoczęta  ← NASTĘPNY
M6  — HR: Pracownicy              [x] Ukończone (2026-03-28)
M7  — HR: Urlopy i nieobecności   [x] Ukończone (2026-03-28)
M8  — HR: Czas pracy              [x] Ukończone (2026-03-28)
M9  — Migracja danych             [ ] Nie rozpoczęta
```

---

## Kamienie milowe MVP

### M1 — Project Bootstrap ✅ UKOŃCZONE
**Cel:** Działająca aplikacja z logowaniem, baza z seed data
```
[x] create-next-app (TypeScript, Tailwind, App Router) — Next.js 16, Node 25
[x] Prisma schema + SQLite + pierwsza migracja — Prisma 5.22
[x] Seed: 3 centra kosztów + 9 kategorii + 116 podkategorii + konto Admin
[x] NextAuth v4 — logowanie, role, JWT middleware
[x] Docker Compose (app container + volume na walldecor.db)
[x] Layout: sidebar (ciemny, 7 pozycji), header z dropdownem
[x] git init + .gitignore (walldecor.db, .env.local)
```
**Decyzje techniczne M1:**
- Prisma 5.22 (zamiast 7.x — SQLite w Prisma 7 wymaga adaptera)
- SQLite enums → String (SQLite nie obsługuje native enumów)
- Design: ciemny sidebar #1E1E1E + beż #E4DCD1 (WallDecor brand)

---

### M2 — Budżet: Planowanie ✅ UKOŃCZONE
**Cel:** Admin może ustawić budżet roczny per kategoria per lokal
```
[x] Widok siatki budżetu (kategorie × 12 miesięcy × lokal)
[x] Edycja budżetu inline (tylko ADMIN) z nawigacją klawiaturą
[x] Przełącznik lokalizacji: JAG / PUL / GLOBAL
[x] Walidacja Zod — kwoty, brak ujemnych wartości
[x] API: GET /api/budget, POST /api/budget (upsert)
[x] API: POST /api/subcategories, PUT /api/subcategories/[id], DELETE /api/subcategories/[id]
[x] UI: dodawanie / zmiana nazwy / usuwanie podkategorii (ADMIN + MANAGER)
[x] Wykresy budżetu (BarChart per kategoria)
[x] Testy jednostkowe: 7 testów (__tests__/unit/budget.test.ts)
```

---

### M3 — Budżet: Wykonanie ✅ UKOŃCZONE
**Cel:** Admin/Manager wpisują rzeczywiste koszty i obrót; widok plan vs actual
```
[x] Widok ActualsGrid: plan │ real per miesiąc + % wykonania + collapse/expand
[x] API: GET /api/actuals, POST /api/actuals (upsert, ADMIN + MANAGER)
[x] Moduł przychodów: RevenuePlanGrid + RevenueActualsGrid
[x] API: GET /api/revenue-budget, POST /api/revenue-budget
[x] API: GET /api/revenue, POST /api/revenue
[x] P&L widok: KPI karty + grouped bar chart + tabela sumaryczna
[x] SubCategory.isFixed Boolean (dla BEP) — migracja: add_revenue_budget_isfixed
[x] Model RevenueBudget — plan sprzedaży per kanał (SALON/MONTAZ/ECOMMERCE)
[x] Kanały przychodów per lokal: JAG(SALON,MONTAZ), PUL(SALON,MONTAZ,ECOMMERCE)
[x] URL-based tabs: /finance?tab=plan|actuals, /finance/revenue?tab=plan|actuals
[x] Testy jednostkowe: 8 testów (__tests__/unit/actuals.test.ts)
```

**Architektura modułu finansowego:**
| Strona | URL | Zawartość |
|---|---|---|
| Budżet | `/finance` | Zakładki: Plan budżetowy / Wykonanie kosztów |
| Przychody | `/finance/revenue` | Zakładki: Plan sprzedaży / Wykonanie |
| P&L | `/finance/actuals` | KPI karty + wykres + tabela P&L |

---

### M4 — Dashboard KPI ✅ UKOŃCZONE
**Cel:** Właściciel widzi kondycję firmy na jednym ekranie
```
[x] Karta KPI: Przychody rok (plan vs real + %)
[x] Karta KPI: Koszty rok (budżet vs real + %)
[x] Karta KPI: Zysk netto rok
[x] Karta KPI: Bieżący miesiąc (net, przychody, koszty)
[x] Karta KPI: BEP bieżący miesiąc + YTD (próg / osiągnięty / poniżej)
[x] Wykres: Przychody vs Koszty per miesiąc (BarChart)
[x] Tabela: Centra kosztów — plan vs real
[x] Testy BEP: 5 testów (__tests__/unit/finance/breakeven.test.ts)
[x] Traffic-light: zielony / żółty / czerwony per kategoria budżetu
[x] Porównanie rok do roku (bieżący miesiąc vs rok poprzedni)
[x] Odświeżanie danych bez przeładowania strony (router.refresh() co 5 min)
```

---

### M4+ — Zarządzanie kategoriami ✅ (dodane w trakcie M4)
```
[x] API: PUT /api/categories/[id] — zmiana nazwy kategorii (ADMIN only)
[x] API: DELETE /api/categories/[id] — usuwanie kategorii (ADMIN only, ochrona danych)
[x] UI budget-grid: zmiana nazwy kategorii (hover → inline edit, Enter/Escape)
[x] UI budget-grid: usuwanie kategorii (hover → potwierdzenie → 409 przy wpisach)
```

### M4+ — CSS Redesign v1 ✅ (dodane w trakcie M4)
```
[x] globals.css: --wd-off-white #F5F5F5, --card-shadow, zaktualizowane zmienne sidebar
[x] Dashboard: szare tło, białe karty z shadow-sm, rounded-2xl
[x] Budżet: tabela rounded-2xl bg-white shadow-sm
[x] Wykresy: indigo kolor słupków, rounded-2xl kontenery
[x] Sidebar: aktywny element — border-left sand + glass bg
[x] Layout: lg:p-8 dla większych ekranów
```

### UI/UX Redesign "Editorial Finance" ✅ (Sesja 6 — 2026-03-02)
```
[x] Fonty: Plus Jakarta Sans (400/500/600/800) + DM Mono (400/500) — zastąpiły Inter
[x] globals.css: --wd-off-white #F7F6F4, --wd-surface-2, --wd-border, --wd-text-muted
[x] globals.css: utility .num (DM Mono + tabular-nums) i .data-label (11px/700/uppercase)
[x] Dashboard: hero numbers z hierarchią (duże + małe decimal), fmtHero() helper
[x] Dashboard: nagłówek font-extrabold, muted subtitles
[x] Dashboard: kolory wykresu — #2A7D4F (zielony), #B54A20 (ceglasty), piasek
[x] Dashboard: tabela CC — .data-label headers, .num cells, warm colors
[x] budget-grid: kategoría header — sand left-border 2px, --wd-surface-2 bg
[x] budget-grid: wiersze — py-2.5 spacing, alternating bg, .num klasa
[x] actuals-grid: plan cols muted, real cols dark+medium, % col text-sm
[x] actuals-grid: kategoria header — sand left-border, surface-2 bg
[x] sidebar: logo font-weight 800, pt-7 top padding, sekcje 10px/700/0.1em/40%
[x] budget-charts: #2A7D4F bar color, warm grid lines, mono tooltip font
```

---

### M4++ — CSV Import/Export + Automatyzacja ✅ (Sesja 7 — 2026-03-02)
```
[x] GET  /api/export/costs?type=budget|actuals&year&costCenterId → CSV BudgetEntry lub ActualEntry
[x] GET  /api/export/revenue?type=plan|actuals&year&costCenterId → CSV RevenueBudget lub Revenue
[x] POST /api/import/costs — batch upsert kosztów, Zod per-row, lookup subCategoryId po nazwie
[x] POST /api/import/revenue — batch upsert przychodów, walidacja kanałów per lokal
[x] API key auth w import endpoints (X-Api-Key header + IMPORT_API_KEY env) — dla n8n
[x] GET  /api/copy-previous-month?type&year&month&costCenterId → kopiuje dane M-1 do M
[x] csv-costs-panel.tsx — toggle budget/actuals, eksport z filtrami, upload+podgląd+import
[x] csv-revenue-panel.tsx — toggle plan/actuals, analogicznie do kosztów
[x] settings/page.tsx — zastąpiony stub; dwie sekcje CSV (koszty + przychody) + auth check
[x] actuals-grid.tsx — przycisk "Kopiuj M-1" (ADMIN+MANAGER, nie GLOBAL)
[x] budget-grid.tsx — przycisk "Kopiuj M-1" (ADMIN only, nie GLOBAL)
[x] papaparse + @types/papaparse zainstalowane
[x] .env.local — IMPORT_API_KEY (puste = wyłączone; uzupełnij w produkcji)
```
**Format CSV koszty:** rok,miesiac,centrum_kosztow,kategoria,podkategoria,kwota
**Format CSV przychody:** rok,miesiac,centrum_kosztow,kanal,kwota
**n8n webhook:** POST /api/import/costs lub /api/import/revenue + header X-Api-Key

---

### M5 — Alerty i przypomnienia
**Cel:** System informuje o ważnych terminach i przekroczeniach
```
[ ] CRUD przypomnień o płatnościach (ADMIN: nazwa, kwota, dzień miesiąca, lokal)
[ ] Lista nadchodzących płatności na dashboardzie (następne 14 dni)
[ ] Alert przekroczenia budżetu kategorii (konfigurowalny próg %)
[ ] Oznaczenie "wymaga uwagi" na dashboardzie per lokal
[ ] Test: alert pojawia się gdy wykonanie > X% budżetu
```

---

### M6 — HR: Pracownicy ✅ UKOŃCZONE
```
[x] Lista pracowników per lokal (imię, stanowisko, typ umowy, status)
[x] Profil pracownika: dane osobowe + aktywna umowa (zakładki)
[x] Dodawanie / edycja / dezaktywacja pracownika (ADMIN)
[x] Struktura organizacyjna — widok drzewa działów
[x] API: GET/POST /api/hr/employees, GET/PUT/DELETE /api/hr/employees/[id]
[x] API: /api/hr/departments, /api/hr/divisions, /api/hr/positions
[x] Komponenty: employee-avatar.tsx, employee-filters.tsx, employee-select.tsx
[x] Strony: /hr/employees, /hr/employees/[id], /hr/employees/new, /hr/employees/structure
```

---

### M7 — HR: Urlopy i nieobecności ✅ UKOŃCZONE
```
[x] Formularz wniosku urlopowego (EMPLOYEE): typ, daty, note
[x] Lista wniosków z akcją zatwierdź/odrzuć (slide-in panel)
[x] Saldo urlopowe: widok per pracownik + carryover
[x] Widok kalendarza nieobecności (absence-calendar.tsx)
[x] Walidacja: wniosek nie może przekroczyć salda
[x] Typy urlopów: CRUD + kolory + kody (ADMIN)
[x] API: /api/hr/leave-requests (GET/POST + approve/reject/export/pending)
[x] API: /api/hr/leave-types (GET/POST/PUT/DELETE)
[x] API: /api/hr/leave-balances (GET/POST/PUT + carryover)
[x] API: /api/hr/leave/calendar, /api/hr/leave/summary
[x] API: /api/hr/holidays
[x] Strony: /hr/leave, /hr/leave/requests, /hr/leave/types, /hr/leave/balances, /hr/leave/approval
[x] Testy jednostkowe: 28 testów (__tests__/unit/hr/utils.test.ts)
[x] Ręczne zarządzanie saldem: przycisk "Dodaj saldo" + "Edytuj saldo" (ADMIN/MANAGER) na karcie pracownika
```

**Sesja 9 (2026-03-30) — Ręczne zarządzanie saldem urlopowym:**
- `leave-tab-client.tsx` — nowy Client Component zastępujący statyczny `LeaveTab` na karcie pracownika
- Modal obsługuje tryb `add` (typ urlopu + rok + dni) i `edit` (zmiana liczby dni)
- Obsługa błędu 409 (duplikat salda)
- Rozszerzono uprawnienia POST `/api/hr/leave-balances` i PATCH `/api/hr/leave-balances/[id]` do MANAGER

---

### M8 — HR: Czas pracy i nadgodziny ✅ UKOŃCZONE
```
[x] Rejestracja czasu pracy: clock-in / clock-out / przerwy
[x] Grafik pracy + kopiowanie szablonu grafiku
[x] Okresy rozliczeniowe: CRUD + zamykanie okresu
[x] Widok nadgodzin + wnioski nadgodzin (approve/reject)
[x] Raporty: attendance, overtime, timecard, plan-vs-actual, projects
[x] API: /api/hr/time-tracking (GET/POST + approve/reject + bulk + weekly)
[x] API: /api/hr/time-tracking/clock-in, /clock-out, /break/start, /break/end, /current
[x] API: /api/hr/overtime-requests (GET/POST + approve/reject)
[x] API: /api/hr/billing-periods (GET/POST/PUT/DELETE + close)
[x] API: /api/hr/schedules (GET/POST + copy + template)
[x] API: /api/hr/reports (attendance/overtime/timecard/plan-vs-actual/projects/export)
[x] Strony: /hr/time-tracking, /hr/time-tracking/clock, /hr/time-tracking/schedule
[x]         /hr/time-tracking/overtime, /hr/time-tracking/periods, /hr/time-tracking/reports
[x] HR Sidebar z wszystkimi linkami (hr-sidebar.tsx)
```

---

### M9 — Migracja danych historycznych
```
[ ] Parser CSV/XLSX dla danych 2025 (koszty + przychody)
[ ] Dry-run import z podglądem przed zapisem
[ ] Import wyników rocznych 2023/2024 jako agregat (YoY)
[ ] Weryfikacja: dashboard pokazuje dane historyczne poprawnie
```

---

## Następna sesja: M5 — Alerty i przypomnienia

> M6/M7/M8 ukończone (2026-03-28). Moduł HR kompletny: pracownicy, urlopy, czas pracy, nadgodziny.
> Sesja 9 (2026-03-30): dodano ręczne zarządzanie saldem urlopowym dla istniejących pracowników (ADMIN/MANAGER).
> TypeScript 0 błędów. Build: ✓ Next.js 16 Turbopack. Testy: 72/72 passing.
> Fix: middleware.ts → proxy.ts (Next.js 16 wymaga proxy.ts zamiast middleware.ts).

```
1. CRUD przypomnień o płatnościach (ADMIN: nazwa, kwota, dzień miesiąca, lokal)
2. Lista nadchodzących płatności na dashboardzie (następne 14 dni)
3. Alert przekroczenia budżetu kategorii (konfigurowalny próg %)
```

---

## Kluczowe pliki projektu

### API — Finanse
| Endpoint | Metoda | Opis | Role |
|---|---|---|---|
| /api/budget | GET, POST | Plan budżetowy | GET: wszyscy; POST: ADMIN |
| /api/actuals | GET, POST | Wykonanie kosztów | ADMIN, MANAGER |
| /api/revenue | GET, POST | Przychody rzeczywiste | ADMIN, MANAGER |
| /api/revenue-budget | GET, POST | Plan przychodów | ADMIN |
| /api/subcategories | POST | Dodaj podkategorię | ADMIN, MANAGER |
| /api/subcategories/[id] | PUT, DELETE | Rename/delete podkat. | ADMIN, MANAGER |
| /api/categories/[id] | PUT, DELETE | Rename/delete kategorii | ADMIN |

### API — HR
| Endpoint | Metoda | Opis |
|---|---|---|
| /api/hr/employees | GET, POST | Lista/tworzenie pracowników |
| /api/hr/employees/[id] | GET, PUT, DELETE | Profil pracownika |
| /api/hr/departments, /divisions, /positions | GET, POST, PUT, DELETE | Struktura org |
| /api/hr/leave-requests | GET, POST | Wnioski urlopowe |
| /api/hr/leave-requests/[id]/approve | POST | Zatwierdzenie wniosku |
| /api/hr/leave-requests/[id]/reject | POST | Odrzucenie wniosku |
| /api/hr/leave-types | GET, POST, PUT, DELETE | Typy urlopów |
| /api/hr/leave-balances | GET, POST, PUT | Salda urlopowe |
| /api/hr/leave-balances/carryover | POST | Przeniesienie salda na nowy rok |
| /api/hr/leave/calendar | GET | Kalendarz nieobecności |
| /api/hr/holidays | GET, POST | Święta/dni wolne |
| /api/hr/time-tracking | GET, POST | Rejestracja czasu pracy |
| /api/hr/time-tracking/clock-in | POST | Rozpoczęcie pracy |
| /api/hr/time-tracking/clock-out | POST | Zakończenie pracy |
| /api/hr/time-tracking/break/start, /end | POST | Przerwy |
| /api/hr/time-tracking/current | GET | Bieżący wpis czasu |
| /api/hr/overtime-requests | GET, POST + approve/reject | Wnioski nadgodzin |
| /api/hr/billing-periods | GET, POST, PUT, DELETE + close | Okresy rozliczeniowe |
| /api/hr/schedules | GET, POST + copy + template | Grafiki pracy |
| /api/hr/reports/* | GET | Raporty: attendance/overtime/timecard/plan-vs-actual |

### Komponenty — Finanse
| Plik | Opis |
|---|---|
| src/components/shared/budget-grid.tsx | Siatka budżetu + zarządzanie kategoriami/podkategoriami |
| src/components/shared/actuals-grid.tsx | Siatka wykonania (plan vs real) |
| src/components/shared/revenue-plan-grid.tsx | Plan przychodów per kanał |
| src/components/shared/revenue-actuals-grid.tsx | Wykonanie przychodów |
| src/components/shared/pnl-view.tsx | P&L: KPI + wykres + tabela |
| src/components/shared/dashboard-view.tsx | Dashboard: 5x KPI + wykres + tabela CC |
| src/lib/bep.ts | calcBep() — formuła Break-Even Point |

### Komponenty — HR
| Plik | Opis |
|---|---|
| src/components/hr/hr-sidebar.tsx | Nawigacja HR z grupami (Czas pracy, Urlopy) |
| src/components/hr/employees/employee-avatar.tsx | Avatar + inicjały pracownika |
| src/components/hr/employees/employee-filters.tsx | Filtry listy pracowników |
| src/components/hr/employees/employee-select.tsx | Dropdown wyboru pracownika |
| src/components/hr/leave/approval-list.tsx | Lista wniosków + slide-in panel szczegółów |
| src/components/hr/leave/leave-balance-card.tsx | Karta salda urlopowego |
| src/components/hr/leave/leave-request-form.tsx | Formularz wniosku urlopowego |
| src/components/hr/leave/leave-requests-view.tsx | Widok listy wniosków |
| src/components/hr/leave/absence-calendar.tsx | Kalendarz nieobecności |
| src/components/hr/employees/leave-tab-client.tsx | Zakładka saldo urlopowe na karcie pracownika — dodaj/edytuj saldo (ADMIN/MANAGER) |

---

## Przyszłe funkcje (v2+)

### Hierarchiczne podkategorie (drzewo)
**Pomysł:** Podkategorie mogą mieć podkategorie (max 1 poziom zagnieżdżenia). Rodzic zawsze pokazuje sumę dzieci — nie można wpisywać wartości bezpośrednio do rodzica.

**Przypadek użycia:** W widoku GLOBAL zamiast "Prąd PUL" i "Prąd JAG" jako osobnych wierszy — jeden wiersz "Prąd" z rozwinięciem na salony.

**Wymagana zmiana schematu:**
```prisma
model SubCategory {
  parentId  String?
  parent    SubCategory?  @relation("SubCategoryTree", fields: [parentId], references: [id])
  children  SubCategory[] @relation("SubCategoryTree")
}
```

**Reguła biznesowa (ustalona):** Rodzic = suma dzieci, zawsze. Rodzic bez dzieci = leaf (można wpisywać bezpośrednio). Rodzic z dziećmi = czysta suma (edycja zablokowana).

**Złożoność:** Wysoka — refactor grida, rekurencyjne zapytania, DnD w kontekście drzewa.
**Priorytet:** Po ustabilizowaniu MVP (M5-M8).

---

## Otwarte decyzje

| Temat | Pytanie | Priorytet |
|---|---|---|
| Break-even — GLOBAL | Czy GLOBAL wchodzi do BEP per lokal i w jakiej proporcji? | M4 |
| Traffic-light progi | Przy jakim % wykonania: żółty alert? czerwony? | M4 |
| Import Excel 2025 | Czy plik Excel ma stałą strukturę kolumn? | M9 |

---

## Środowisko

```
Serwer:    VPS OVH, Ubuntu
Lokalnie:  /Users/piotr/Documents/Claude/walldecor-app/
Node.js:   /opt/homebrew/bin/node (v25.6.1)
Prisma:    5.22 + SQLite
```
