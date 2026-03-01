# Project Status — WallDecor App

**Ostatnia aktualizacja:** 2026-03-01 (Sesja 2 — M1 ukończone)

---

## Status ogólny

```
M1  — Project Bootstrap     [x] Ukończone (2026-03-01)
FAZA 1 — Core finansowy     [ ] Nie rozpoczęta
FAZA 2 — Dashboard KPI      [ ] Nie rozpoczęta
FAZA 3 — HR podstawowy      [ ] Nie rozpoczęta
FAZA 4 — HR: Czas pracy     [ ] Nie rozpoczęta
FAZA 5 — Integracje         [ ] Nie rozpoczęta
```

---

## Kamienie milowe MVP

### M1 — Project Bootstrap ✅ UKOŃCZONE
**Cel:** Działająca aplikacja z logowaniem, baza z seed data
```
[x] create-next-app (TypeScript, Tailwind, App Router) — Next.js 16, Node 25
[x] Prisma schema + SQLite + pierwsza migracja — Prisma 5.22
[x] Seed: 3 centra kosztów + 9 kategorii + 66 podkategorii + konto Admin
[x] NextAuth v4 — logowanie, role, JWT middleware
[x] Docker Compose (app container + volume na walldecor.db)
[x] Layout: sidebar (ciemny, 7 pozycji), header z dropdownem
[x] git init + .gitignore (walldecor.db, .env.local)
```
**Definition of Done:** ✅ Można się zalogować, widać sidebar, baza ma dane startowe.

**Decyzje techniczne M1:**
- Prisma 5.22 (zamiast 7.x — SQLite w Prisma 7 wymaga adaptera)
- SQLite enums → String (SQLite nie obsługuje native enumów)
- Design: ciemny sidebar #1E1E1E + beż #E4DCD1 (WallDecor brand)

---

### M2 — Budżet: Planowanie
**Cel:** Admin może ustawić budżet roczny per kategoria per lokal
```
[ ] Widok siatki budżetu (kategorie × 12 miesięcy × lokal)
[ ] Formularz edycji budżetu — inline lub modal (tylko ADMIN)
[ ] Przełącznik lokalizacji: JAG / PUL / GLOBAL
[ ] Walidacja Zod — kwoty, brak ujemnych wartości bez powodu
[ ] API route: GET /api/budget, POST /api/budget
[ ] Test: zapis budżetu i odczyt za ten sam miesiąc
```
**Definition of Done:** Admin może wpisać plan na każdy miesiąc, dane zapisują się w bazie.

---

### M3 — Budżet: Wykonanie
**Cel:** Pracownicy i admin mogą wpisywać rzeczywiste koszty i obrót
```
[ ] Formularz wprowadzania wykonania (koszty per kategoria per miesiąc)
[ ] Formularz wprowadzania przychodu (SALON + ECOMMERCE per lokal)
[ ] Uprawnienia: EMPLOYEE widzi/edytuje tylko swój lokal, wybrane kategorie
[ ] Widok "plan vs wykonanie" w tabeli (obok siebie)
[ ] Wskaźnik % wykonania per kategoria
[ ] API route: GET /api/actuals, POST /api/actuals, GET /api/revenue
[ ] Test: EMPLOYEE nie może edytować budżetu ani innego lokalu
```
**Definition of Done:** Dane rzeczywiste da się wpisać, widać porównanie plan/wykonanie.

---

### M4 — Dashboard KPI (live)
**Cel:** Właściciel widzi kondycję firmy na jednym ekranie
```
[ ] Karta KPI per lokal: przychód / koszty / marża (bieżący miesiąc)
[ ] Break-even per lokal (próg przychodów pokrywający koszty)
[ ] Traffic-light: zielony / żółty / czerwony per kategoria budżetu
[ ] Wykres: przychód vs koszty (ostatnie 6 miesięcy, linia)
[ ] Porównanie rok do roku (bieżący miesiąc vs rok poprzedni)
[ ] Odświeżanie danych bez przeładowania strony (SWR lub Server Actions)
[ ] Test: kalkulacja break-even dla różnych scenariuszy (0, ujemny, nadwyżka)
```
**Definition of Done:** Dashboard pokazuje live dane, traffic-light reaguje na dane.

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
**Definition of Done:** Dashboard pokazuje alerty, lista płatności jest widoczna.

---

### M6 — HR: Pracownicy
**Cel:** Admin zarządza danymi pracowników i umowami
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
**Definition of Done:** Admin może dodać pracownika z umową, pracownik widzi swój profil.

---

### M7 — HR: Urlopy i nieobecności
**Cel:** Elektroniczny obieg wniosków urlopowych
```
[ ] Formularz wniosku urlopowego (EMPLOYEE): typ, daty, note
[ ] Lista wniosków dla managera/admina z akcją zatwierdź/odrzuć
[ ] Saldo urlopowe: automatyczna aktualizacja po zatwierdzeniu
[ ] Ewidencja L4 i innych nieobecności (tylko ADMIN/MANAGER)
[ ] Widok kalendarza nieobecności per lokal (ADMIN/MANAGER)
[ ] Walidacja: wniosek nie może przekroczyć salda
[ ] Test: saldo zmniejsza się po zatwierdzeniu, nie po złożeniu
```
**Definition of Done:** Pracownik składa wniosek, manager zatwierdza, saldo się aktualizuje.

---

### M8 — HR: Czas pracy i nadgodziny
**Cel:** Ewidencja czasu pracy z auto-kalkulacją nadgodzin
```
[ ] Wprowadzanie czasu pracy per dzień per pracownik
[ ] Auto-oznaczenie soboty jako nadgodziny (11:00–14:00 = 3h OT)
[ ] Manualne dodanie nadgodzin (szkolenia, inne zdarzenia)
[ ] Widok miesięczny per pracownik
[ ] Raport miesięczny nadgodzin: eksport XLSX (do wysyłki do kadrowej)
[ ] Test: sobota automatycznie = nadgodziny, suma za miesiąc jest poprawna
```
**Definition of Done:** Raport nadgodzin generuje się poprawnie i da się pobrać jako XLSX.

---

### M9 — Migracja danych historycznych
**Cel:** Dane z Excela są w systemie, YoY działa
```
[ ] Parser CSV/XLSX dla danych 2025 (koszty + przychody)
[ ] Dry-run import z podglądem przed zapisem
[ ] Import wyników rocznych 2023/2024 jako agregat (YoY)
[ ] Weryfikacja: dashboard pokazuje dane historyczne poprawnie
```
**Definition of Done:** Dane 2025 są w bazie, dashboard pokazuje porównanie YoY.

---

## Co zostało zrobione

### Sesja 1 — 2026-03-01 (planowanie)
- [x] Zebrano wymagania (35 pytań Q&A z właścicielem)
- [x] Ustalono stack: Next.js 14 + TypeScript + Tailwind + shadcn/ui + Prisma + SQLite + Docker
- [x] Ustalono strukturę firmy: JAG / PUL / GLOBAL, role: ADMIN / MANAGER / EMPLOYEE
- [x] Zapisano pełną specyfikację → `spec.md`
- [x] Zaprojektowano schemat bazy danych → `architecture.md`
- [x] Zapisano zasady projektu → `CLAUDE.md`
- [x] Zdefiniowano standardy testowania → `.claude/rules/testing.md`
- [x] Skonfigurowano MCP → `.mcp.json` (Playwright, SQLite, next-devtools)
- [x] Zdefiniowano 9 kamieni milowych MVP → `project_status.md`

---

## Następna sesja: M2 — Budżet: Planowanie

```
1. Widok siatki budżetu (kategorie × 12 miesięcy × lokal)
2. Formularz edycji budżetu — inline (tylko ADMIN)
3. Przełącznik lokalizacji: JAG / PUL / GLOBAL
4. API route: GET /api/budget, POST /api/budget
5. Walidacja Zod — kwoty, brak ujemnych
6. Test: zapis budżetu i odczyt za ten sam miesiąc
```

---

## Otwarte decyzje (wymagają odpowiedzi właściciela)

| Temat | Pytanie | Priorytet |
|---|---|---|
| Break-even — GLOBAL | Czy GLOBAL wchodzi do break-even per lokal i w jakiej proporcji (50/50 czy wg przychodu)? | M4 |
| Traffic-light progi | Przy jakim % wykonania budżetu: żółty alert? czerwony? | M4 |
| Marża brutto | Jaka jest szacunkowa marża brutto per lokal (do kalkulacji break-even)? | M4 |
| Import Excel 2025 | Czy plik Excel ma stałą strukturę kolumn? Czy mogę go zobaczyć przed M9? | M9 |

---

## Środowisko

```
Serwer:    VPS OVH, Ubuntu
Lokalnie:  /Users/piotr/Documents/Claude/walldecor-app/
Repo git:  Nie zainicjowane (M1)
MCP:       .mcp.json skonfigurowany (Playwright + SQLite + next-devtools)
```
