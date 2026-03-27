# WallDecor — Specyfikacja aplikacji budżetowo-HR (MVP)

**Data:** 2026-03-01
**Autor:** Piotr + Claude Code
**Status:** Draft MVP

---

## 1. Cel projektu

Zastąpienie arkusza Excel webową aplikacją do zarządzania budżetem firmowym oraz podstawowymi funkcjami HR. Centrum wiedzy o stanie firmy — nie narzędzie księgowe.

**Kluczowy problem do rozwiązania:** Zbyt duże nakłady ręcznej pracy przy aktualizacji danych; brak live widoku "czy lokal zarabia" i kiedy wymagana jest uwaga właściciela.

---

## 2. Struktura firmy

| Centrum kosztów | Opis |
|---|---|
| **JAG** | Salon Jagiellońska (1 pracownik) |
| **PUL** | Salon Puławska (2 pracowników) + eCommerce jako subkonto |
| **GLOBAL** | Koszty centralne / wspólne |

**Ecommerce:** przypisany do PUL jako wydzielone subkonto przychodów.

**Pracownicy:**
- Prezes (Admin)
- 2 × pracownik salon Puławska (UoP)
- 1 × pracownik salon Jagiellońska (UoP)
- 1 × osoba na zleceniu (UZ)
- Zewnętrzni wykonawcy B2B (tapetowanie, malowanie, podłogi, tynki, sztukaterie) — rozliczani na FV

---

## 3. Stack techniczny

| Warstwa | Technologia |
|---|---|
| Framework | Next.js 14+ (App Router, TypeScript) |
| UI | Tailwind CSS + shadcn/ui |
| Auth | NextAuth.js |
| ORM | Prisma |
| Baza danych | **SQLite** (plik, zero konfiguracji serwera) |
| Deployment | Docker Compose na VPS OVH (Ubuntu) |
| Maintenance | Właściciel + Claude Code |

**Uzasadnienie SQLite:** skala projektu (<50 użytkowników), prostszy backup (kopiowanie pliku), brak potrzeby zarządzania serwerem bazy. Migracja do PostgreSQL możliwa przez Prisma jeśli zajdzie potrzeba.

---

## 4. Role użytkowników

| Rola | Uprawnienia |
|---|---|
| **Admin** (Prezes) | Pełny dostęp do wszystkich danych, budżetu, HR, płac |
| **Manager** | Dane obu salonów (widok wzajemny OK), zatwierdzanie urlopów, **brak** danych płacowych |
| **Pracownik** | Własne dane HR, wniosek urlopowy, wprowadzanie obrotu + wybranych kosztów swojego salonu |

---

## 5. Struktura kont (kategorie kosztów)

### Customer Acquisition
- Sklep internetowy / SEO / Linkowanie
- AdWords Obsługa Data.Rocks
- Inne IT
- AdWords Lokalnie
- AdWords
- AI
- Facebook
- Miscellaneous

### Cost of Service
- Prowizje od terminali
- Prowizje płatności
- Photoshop / Google Suite / Canva
- Pipedrive CRM
- Inne

### Office / General Administrative
- **Utrzymanie biura Jagiellońska:** Czynsz, Prąd, Śmieci
- **Utrzymanie biura Puławska:** Czynsz, Śmieci, Prąd, Internet, Telefony
- Dodatkowe / Szkolenia / Atrakcje / Inne koszty powiązane
- Zaopatrzenie / Ochrona / Drukowanie i akcesoria biurowe
- Naprawy i utrzymanie
- Meble, akcesoria, ekspozycja
- Księgowość

### Cost of Goods / Cost of Services
- **Koszty pracownicze:**
  - Aleksandra Bodecka + Dodatek Ola
  - Marcin / Justyna / Prezes / Maks Pietrasik
- **Podwykonawcy:**
  - Grzegorz Malinowski / Marcin Jezierski / Lidia Szycie
  - Jarek Piesio / Boberek / New Nest / Różański
- Logistyka i dostawy
- Wzorniki, ekspozycje etc.
- Inne koszty COS
- Purchases COS
- Prowizje (zsumowane)

### Travel
- Leasing / Paliwo / Naprawy / Posiłki / Transportation / Entertainment / Other

### Legal
- Legal & Professional Fees

### Insurance
- Ubezpieczenie auto
- Insurance Liability
- Insurance Errors & Omissions

### Other Expenses
- Penalties & Settlements
- Zakupy Allegro itp.
- Prowizje

### Other Taxes
- VAT / ZUS / Zdrowotna / CIT-8E / Dochodowy

---

## 6. Moduły MVP

### MODUŁ 1 — Finanse: Budżet
- Roczny budżet z podziałem miesięcznym per centrum kosztów
- Edycja budżetu przez admina
- Import jednorazowy struktury kont z Excela

### MODUŁ 2 — Finanse: Wykonanie
- Ręczne wprowadzanie kosztów rzeczywistych (admin + pracownik dla swojego salonu)
- Pracownik salonu wprowadza: obrót miesięczny + koszty operacyjne swojej lokalizacji
- Koszty GLOBAL — wprowadzane przez admina, nie alokowane (widoczne jako osobne centrum)
- System FK: SubiektGT INSERT — brak integracji w MVP, dane wpisywane ręcznie

### MODUŁ 3 — Dashboard KPI (live)
- **Break-even per lokal** — ile trzeba sprzedać żeby lokal "wyszedł na zero"
- **Plan vs Wykonanie** per kategoria per lokal
- **Rentowność per lokal** (marża)
- **Porównanie rok do roku** (poprzedni rok pełny + wcześniejsze lata jako zagregowany wynik)
- **Traffic-light status:** zielony / żółty / czerwony per kategoria budżetu

*Faza 2: korelacja z GA4 + Google Business (ruch vs przychód)*

### MODUŁ 4 — Alerty
- Zbliżające się terminy płatności (definiowane ręcznie przez admina)
- Przekroczenie budżetu kategorii (konfigurowalny próg %)

### MODUŁ 5 — HR: Baza pracowników
- Dane osobowe + stanowisko + lokalizacja + typ zatrudnienia
- Typy umów: UoP / B2B / UZ
- Umowy dodatkowe per pracownik (np. najem auta, dodatkowe UZ)
- Historia zmian wynagrodzenia i stanowiska
- Zewnętrzni B2B jako osobna sekcja (dane do FV, stawki, historia)

### MODUŁ 6 — HR: Czas pracy i nieobecności
- **Wnioski urlopowe:** pracownik składa → manager/admin zatwierdza
- Saldo urlopowe z automatycznym liczeniem
- Ewidencja L4 i innych nieobecności (typy: urlop wypoczynkowy, chorobowe, opieka, inne)
- **Czas pracy:** stałe godziny 11–19 + soboty 11–14 liczone jako nadgodziny (auto-kalkulacja)
- Raport miesięczny nadgodzin — gotowy do wysyłki do zewnętrznej kadrowej
- Okazjonalne nadgodziny (np. szkolenia) — manualne dodanie

---

## 7. Model danych — główne encje

```
CostCenter        (JAG | PUL | GLOBAL)
AccountCategory   (główna kategoria)
  └── SubCategory (podkategoria)

BudgetEntry       (year, month, subCategory, costCenter, amount)
ActualEntry       (year, month, subCategory, costCenter, amount, note, enteredBy)

Revenue           (year, month, costCenter, channel, amount)
  channel:        SALON | ECOMMERCE (ecommerce → costCenter = PUL)

Employee
  ├── Contract[]          (type: UOP|B2B|UZ, startDate, endDate, salary)
  ├── AdditionalContract[] (type, description, startDate, endDate, value)
  ├── SalaryHistory[]
  ├── LeaveRequest[]
  ├── LeaveBalance
  └── WorkTimeRecord[]    (date, regularHours, overtimeHours, note)

User              (linked to Employee, role: ADMIN|MANAGER|EMPLOYEE)
PaymentReminder   (name, amount, dueDate, costCenter, recurring)
```

---

## 8. Dane historyczne do migracji

| Zakres | Format |
|---|---|
| Rok poprzedni (2025) | Pełne dane miesięczne — do migracji |
| Wcześniejsze lata | Tylko wynik roczny — do porównania YoY |

Dane w Excelu mają ustaloną strukturę — migracja powinna być wykonalna przez import CSV/XLSX.

---

## 9. Cykl budżetowy

- **Typ:** Roczny z podziałem miesięcznym
- **Kierunek:** Top-down (budżet ustala admin/prezes)
- **Aktualizacja wykonania:** Ręcznie, docelowo raz w miesiącu
- **Brak rolling forecast** w MVP — jeden zatwierdzon budżet na rok

---

## 10. Integracje

| System | Status |
|---|---|
| SubiektGT INSERT | Brak integracji w MVP — dane ręczne |
| GA4 | Faza 2 |
| Google Business | Faza 2 |
| Zewnętrzna kadrowa | Brak integracji — eksport raportu PDF/Excel do wysyłki ręcznej |
| OCR dokumentów kadrowych | Faza 3 (perspektywa) |

---

## 11. Poza zakresem MVP

- Moduł rekrutacyjny
- Integracja z systemem FK
- Integracja GA4 / Google Business
- OCR dokumentów
- Obsługa walut obcych
- Alokacja kosztów GLOBAL do lokalizacji (GLOBAL zostaje jako osobne centrum)

---

## 12. Fazy realizacji

```
FAZA 1 — Core finansowy
  Struktura kont, budżet roczny/miesięczny, wprowadzanie wykonania, migracja danych

FAZA 2 — Dashboard i KPI
  Live dashboard, break-even, plan vs real, alerty, YoY

FAZA 3 — HR podstawowy
  Baza pracowników, urlopy, saldo urlopowe, L4

FAZA 4 — HR: Czas pracy
  Ewidencja nadgodzin, raport miesięczny, soboty auto

FAZA 5 — Integracje
  GA4, Google Business, ewentualny import z SubiektGT
```

---

## 13. Deployment

- **Serwer:** VPS OVH, Ubuntu
- **Metoda:** Docker Compose
- **Backup bazy:** Automatyczny backup pliku SQLite (cron + kopia na zewnątrz)
