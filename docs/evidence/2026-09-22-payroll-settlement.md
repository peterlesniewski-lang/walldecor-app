# Rozliczenia wynagrodzeń (ADMIN) — wyniki testów i ograniczenia

**Data:** 2026-09-22 · **Gałąź:** `monthly-salary-settlement` · **Dane testowe:** wyłącznie syntetyczne (osoby „Testowa Płacowa”, „Testowy Sąsiad”, kwoty wymyślone).

## Wyniki

| Kontrola | Wynik |
|---|---|
| `npm run test` (cały Vitest) | **272 plików / 3034 testy PASS**, 2 pominięte (jak przed zmianą) |
| — w tym `__tests__/unit/hr/payroll-calculations.test.ts` | 30/30 PASS |
| — w tym `__tests__/integration/hr/payroll-settlement-flow.test.ts` (świeża baza z `prisma migrate deploy`) | 35/35 PASS |
| `npx playwright test e2e/hr-payroll.spec.ts` (świeża baza budowana przez `global-setup` z migracji) | **3/3 PASS** |
| `npm run typecheck:app` | PASS |
| `npm run build` | PASS (trasy `/hr/payroll`, `/hr/payroll/[id]`, `/api/hr/payroll/*`) |
| ESLint na zmienionych plikach | PASS (w całym katalogu `src/components/hr` jest 1 wcześniejszy błąd w `reports-dashboard.tsx` — nie ruszany) |

## Wymagany przepływ — co i gdzie sprawdzono

| Krok | Integracja (API + baza) | E2E (przeglądarka, prawdziwy serwer) |
|---|---|---|
| Ustawienie podstawy z datą obowiązywania | ✅ + odrzucenie duplikatu daty (409) | ✅ dialog „Podstawa” |
| Godziny z kalendarza (bez ponownego wpisywania) | ✅ wpis `pending` ≠ zatwierdzony; blokada potwierdzenia i zatwierdzenia | ✅ znacznik „niezatwierdzony wpis” i lista blokad |
| Zatwierdzenie wpisu w kalendarzu → wykrycie zmiany → ponowne pobranie | ✅ | ✅ baner i przycisk „Pobierz ponownie” |
| Wypłata vs czas wolny | ✅ domyślnie z zatwierdzonego wniosku nadgodzin, decyzja admina ma pierwszeństwo | ✅ 1 h 30 min do wypłaty, 3 h czasu wolnego (sobota z wniosku) |
| Premia i korekta z historią zmian | ✅ dodanie, poprawa z powodem, miękkie usunięcie; ujemna premia → 400 | ✅ |
| Potwierdzenie danych kadrowej (brutto, netto, pełny koszt) | ✅ netto > brutto → 400; brak kosztu pracodawcy → 400; zmiana danych po potwierdzeniu unieważnia potwierdzenie | ✅ |
| Zatwierdzenie → wersja v1 | ✅ nieaktualna rewizja → 409; edycja bez otwarcia korekty → 409 | ✅ pieczątka „Zatwierdzone · v1” |
| Ponowny odczyt po restarcie | ✅ nowy klient Prisma + przeładowanie modułów tras | ✅ **restart procesu serwera** (`restart-request`), dane i historia bez zmian |
| Odmowa dostępu dla innego pracownika | ✅ EMPLOYEE (inny i ten sam pracownik), MANAGER → 403 na wszystkich trasach; brak sesji → 401 | ✅ 403 z API bez kwot w odpowiedzi, przekierowanie ze strony, brak linku w menu |
| Korekta bez podwójnego kosztu | ✅ po otwarciu korekty kontrakt zwraca v1, po zatwierdzeniu dokładnie jeden rekord v2 | — |
| Strażniki w bazie (surowy SQL) | ✅ zmiana i usunięcie wersji, cofnięcie „zastąpienia”, zmiana i usunięcie audytu, usunięcie rozliczenia, edycja zatwierdzonego rozliczenia, druga obowiązująca wersja, CHECK netto ≤ brutto | — |
| Nowy miesiąc nie kopiuje kwot | ✅ wrzesień startuje z pustymi kwotami i bez premii | — |

Zrzuty ekranu: `docs/evidence/payroll-2026-09-22/` (lista miesiąca, szkic z niezatwierdzonym wpisem, zatwierdzona v1, widok 1280 px, mobile 390 px po restarcie).

## Ograniczenia i decyzje do potwierdzenia

1. **Brak szyfrowania kwot w spoczynku.** SQLite nie ma uprawnień na poziomie wierszy. Ochrona w bazie to CHECK-i, triggery niezmienności i indeks częściowy. Dostęp do samego pliku bazy lub kopii zapasowej (`/data/backups`) daje dostęp do kwot. Szyfrowanie pól utrudniłoby agregację do finansów.
2. **Aplikacja nie liczy brutto ani kosztu pracodawcy.** Kwoty wpisuje ADMIN z listy płac kadrowej. Walidacja: netto ≤ brutto, koszt pracodawcy ≥ brutto (poza B2B, gdzie koszt może być niższy przez odliczalny VAT). Stawek ZUS i dodatków za nadgodziny (50%/100%) celowo nie ma.
3. **Wypłata vs czas wolny** jest ustalana per dzień z nadgodzinami. `OvertimeRequest` nie ma powiązania z `TimeEntry`, więc wartość domyślna pochodzi z zatwierdzonego wniosku z tej samej daty. Sprzeczne wnioski zostawiają decyzję administratorowi.
4. **Źródło nadgodzin to `TimeEntry.overtimeMinutes`.** Batch i miesięczne uzupełnianie liczą sobotę w całości jako nadgodziny, ale `clock-out` (rejestrator) stosuje tylko próg dzienny, także w sobotę. To istniejąca niespójność modułu Czas pracy, nienaprawiana tutaj.
5. **Zmiana podstawy w trakcie miesiąca:** pokazywane są oba okresy i ostrzeżenie. Proporcję liczy kadrowa.
6. **Stawka godzinowa:** blokada, dopóki w miesiącu są niezatwierdzone wpisy. Kwoty godzinowej nie wyliczamy.
7. **Stary model `SalaryHistory`/`Contract.salary`** (Float, bez audytu) zostaje bez zmian i nie jest źródłem dla rozliczeń. Migracja lub wygaszenie wymaga decyzji.
8. **Dryf migracji spoza tej gałęzi:** `prisma migrate diff` pokazuje w `schema.prisma` elementy bez migracji (m.in. tabela `ContentVisibilityGrant`, tabele FTS artykułów, nazwy indeksów). Migracja płac obejmuje wyłącznie tabele płacowe. Tamten dryf trzeba wyjaśnić osobno.
9. Wdrożenie na produkcję nie było częścią zadania. Migracja jest addytywna i nie zmienia istniejących danych.
