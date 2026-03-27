# Project Status — WallDecor App

**Ostatnia aktualizacja:** 2026-03-02 (Sesja 7 — CSV Import/Export + Copy M-1)

---

## Status ogólny

```
M1  — Project Bootstrap           [x] Ukończone (2026-03-01)
M2  — Budżet: Planowanie          [x] Ukończone (2026-03-02)
M3  — Budżet: Wykonanie (+ P&L)   [x] Ukończone (2026-03-02)
M4  — Dashboard KPI + CSS         [x] Ukończone (2026-03-02)
M5  — Alerty i przypomnienia      [ ] Nie rozpoczęta  ← NASTĘPNY
M6  — HR: Pracownicy              [ ] Nie rozpoczęta
M7  — HR: Urlopy i nieobecności   [ ] Nie rozpoczęta
M8  — HR: Czas pracy              [ ] Nie rozpoczęta
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

### M6 — HR: Pracownicy
```
[ ] Lista pracowników per lokal (imię, stanowisko, typ umowy, status)
[ ] Profil pracownika: dane osobowe + aktywna umowa
[ ] Dodawanie / edycja / dezaktywacja pracownika (ADMIN)
[ ] Historia umów i wynagrodzeń (ADMIN only)
[ ] Umowy dodatkowe (najem auta, UZ dodatkowa) — dodawanie per pracownik
[ ] Sekcja zewnętrznych B2B (Podwykonawcy) — oddzielna lista
[ ] Pracownik widzi własne dane (bez wynagrodzenia innych)
[ ] Test: MANAGER nie widzi danych płacowych
```

---

### M7 — HR: Urlopy i nieobecności
```
[ ] Formularz wniosku urlopowego (EMPLOYEE): typ, daty, note
[ ] Lista wniosków dla managera/admina z akcją zatwierdź/odrzuć
[ ] Saldo urlopowe: automatyczna aktualizacja po zatwierdzeniu
[ ] Ewidencja L4 i innych nieobecności (tylko ADMIN/MANAGER)
[ ] Widok kalendarza nieobecności per lokal (ADMIN/MANAGER)
[ ] Walidacja: wniosek nie może przekroczyć salda
[ ] Test: saldo zmniejsza się po zatwierdzeniu, nie po złożeniu
```

---

### M8 — HR: Czas pracy i nadgodziny
```
[ ] Wprowadzanie czasu pracy per dzień per pracownik
[ ] Auto-oznaczenie soboty jako nadgodziny (11:00–14:00 = 3h OT)
[ ] Manualne dodanie nadgodzin (szkolenia, inne zdarzenia)
[ ] Widok miesięczny per pracownik
[ ] Raport miesięczny nadgodzin: eksport XLSX (do wysyłki do kadrowej)
[ ] Test: sobota automatycznie = nadgodziny, suma za miesiąc jest poprawna
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

> M4 ukończone (2026-03-02). Dashboard: 5 kart KPI, BEP, traffic-light, YoY, auto-refresh.
> UI/UX Redesign "Editorial Finance" ukończony (2026-03-02): Plus Jakarta Sans + DM Mono, hero numbers, sand left-borders w tabelach, warm color palette, zielony/ceglasty wykres.


```
1. CRUD przypomnień o płatnościach (ADMIN: nazwa, kwota, dzień miesiąca, lokal)
2. Lista nadchodzących płatności na dashboardzie (następne 14 dni)
3. Alert przekroczenia budżetu kategorii (konfigurowalny próg %)
```

---

## Kluczowe pliki projektu

### API
| Endpoint | Metoda | Opis | Role |
|---|---|---|---|
| /api/budget | GET, POST | Plan budżetowy | GET: wszyscy; POST: ADMIN |
| /api/actuals | GET, POST | Wykonanie kosztów | ADMIN, MANAGER |
| /api/revenue | GET, POST | Przychody rzeczywiste | ADMIN, MANAGER |
| /api/revenue-budget | GET, POST | Plan przychodów | ADMIN |
| /api/subcategories | POST | Dodaj podkategorię | ADMIN, MANAGER |
| /api/subcategories/[id] | PUT, DELETE | Rename/delete podkat. | ADMIN, MANAGER |
| /api/categories/[id] | PUT, DELETE | Rename/delete kategorii | ADMIN |

### Komponenty
| Plik | Opis |
|---|---|
| src/components/shared/budget-grid.tsx | Siatka budżetu + zarządzanie kategoriami/podkategoriami |
| src/components/shared/actuals-grid.tsx | Siatka wykonania (plan vs real) |
| src/components/shared/revenue-plan-grid.tsx | Plan przychodów per kanał |
| src/components/shared/revenue-actuals-grid.tsx | Wykonanie przychodów |
| src/components/shared/pnl-view.tsx | P&L: KPI + wykres + tabela |
| src/components/shared/dashboard-view.tsx | Dashboard: 5x KPI + wykres + tabela CC |
| src/lib/bep.ts | calcBep() — formuła Break-Even Point |

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
