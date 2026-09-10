# Plan wykonania — finanse rzeczywiste i kasa salonu

Specyfikacja: `docs/superpowers/specs/2026-09-10-finance-cashier-design.md`.

## Zasady wykonania

Praca w odizolowanym checkout `walldecor-ksef`, gałąź `feat/finance-actuals-cash-ledger`, baza wyjściowa `00a38be`. Zachować `.coolify/` i wszystkie zmiany innych osób. Nie commitować/pushować bez zgody. Każdy etap: test niedziałającego kontraktu → implementacja → test → niezależny przegląd → dowód odbioru. Migracje addytywne; żadnego resetu istniejącej bazy.

## Etapy i odpowiedzialność

1. **Root: kontrakt i migracja.** Dodać nullable datę stanu Revenue oraz pięć modeli kasy; walidować Prisma, odtworzyć bazę od zera i sprawdzić upgrade kopii. Nie backfillować nieznanych danych. Wygenerować klienta.
2. **Worker Revenue: ekran i kontrakt przychodów.** Wyłącznie rzeczywiste, zastępowanie kwot, data, rozróżnienie brak/zero, oba importery CSV i eksport. Zakaz zmiany budżetów kosztowych. Testy rzeczywistego zapisu i regresji.
3. **Worker Cash backend: dostęp, domena, API i integralność sald.** Aktualne przypisanie pracownika, transakcje, wersje, idempotencja, ustawienia, operacje, zamknięcie, korekta, odbiór/przeliczenie i audyt. Ochrona starego API rachunków. Testy SQLite i ról. Najpierw przekazać rootowi typowany kontrakt UI.
4. **Worker Dashboard: jeden serwerowy model danych dla obu stron i nowy widok.** Wyłącznie wykonanie, wybrany miesiąc, dane niepełne, rzeczywiste r/r, alokacje, środki oddzielone od wyniku. Testy kontraktu i UI. Nie edytować Revenue ani kasy.
5. **Root: Kasa salonu UI, nawigacja i integracja.** Realne formularze stanów pustych, konfiguracja admina, pracownik, błędy/retry/stale version, historia i oddzielne odebranie/przeliczenie. Żadnych demonstracyjnych danych produkcyjnych. Mobilny układ zgodny z zatwierdzoną makietą.
6. **Root + niezależny reviewer: odbiór.** Czysta baza, upgrade, pełny browser flow, API zabezpieczenia i odczyt bazy, restart, pełne testy i build. Naprawić problemy w zakresie zmian. Udokumentować znane niezależne niestabilne testy, nie ukrywać ich.

## Bramka zakończenia

Gotowość lokalna wymaga wszystkich dowodów z sekcji 4 specyfikacji, bez atrap i z działającym zapisem. W raporcie podać zmianę, testy, ścieżki, ograniczenia oraz osobno stan publikacji. Wdrożenie nie jest elementem samego zielonego buildu. Przed uruchomieniem konkretnego salonu użytkownik wskazuje rachunek, datę/saldo startu i źródłowe pola wpływów Subiekta.

## Dziennik dowodów

- Baseline przed zmianami: 1507/1508 testów; jeden niestabilny test HR `monthly-timesheet-view` (asynchroniczna lista). Osobny ponowny przebieg 40/40; pełny rerun **1508/1508 PASS** (`/private/tmp/wd-finance-baseline.json`).
- Prisma validate PASS; klient 5.22.0 wygenerowany. Automatyczny diff względem istniejących migracji zawiera niezwiązane różnice (FTS, CHECK montażu, nieobecna migracja ContentVisibilityGrant); nie zastosowano ich. Własna migracja addytywna dotyczy wyłącznie Revenue i pięciu tabel kasy, z częściowym unikalnym indeksem jednego szkicu na salon.
- Odbiór po wznowieniu 10.09.2026: **1657/1657 PASS**, 0 pominiętych; build webpack/produkcyjny TypeScript PASS; zakresowy ESLint i `git diff --check` PASS.
- `node scripts/validate-finance-migrations.mjs` PASS: pusty pełny łańcuch oraz upgrade danych historycznych, zachowanie RevenueBudget/Revenue/kosztów/FTS/CHECK, poprawne integrity/FK, brak automatycznej aktywacji.
- `node scripts/validate-finance-cashier.mjs` PASS na końcowym buildzie: UI/API od czystej bazy, rzeczywisty import z kluczem, przychody 100→150→120, przerwany zapis, operacje i kasa stała, konflikt409, depozyt1370, idempotencja, korekta/niedobór, odbiór/przeliczenie, role i odczyt po restarcie. Desktop/mobile bez poziomego przepełnienia dokumentu.
- Przeglądy niezależne domknięte bez pozostawionych P1/P2. Poprawki szkiców przy odświeżeniu Revenue i CashFlowRow oraz niepewnego zapisu w kasie mają regresje odtworzone przed naprawą.
- Etapy 1–6 zakończone lokalnie. Właściciel zatwierdził commit/push gałęzi 10.09.2026; merge i wdrożenie wymagają osobnej decyzji. [Raport odbioru i warunki uruchomienia](2026-09-10-finance-cashier-acceptance.md).
