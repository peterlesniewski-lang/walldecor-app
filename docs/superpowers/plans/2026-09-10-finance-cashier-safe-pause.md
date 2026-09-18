# Bezpieczna pauza — 10.09.2026

> **Wznowiono na wyraźne polecenie użytkownika 10.09.2026.** Poniżej zachowano historyczny stan pauzy. Pozostały test został naprawiony, a późniejszy odbiór 1657/1657 + build/migracje/browser opisuje [raport końcowy](2026-09-10-finance-cashier-acceptance.md). Bez commita, pusha i wdrożenia.

Użytkownik polecił przerwać pracę i wrócić za kilka godzin. Nie wznawiać automatycznie, nie uruchamiać kolejnych testów ani wdrożenia bez jego wiadomości.

## Stan repozytorium

- Checkout: `/Users/piotr/projekty/ksiegowosc/walldecor-ksef`.
- Gałąź: `feat/finance-actuals-cash-ledger`.
- HEAD: `00a38be37155b947b840cc0b4ec3590c0d68484b`.
- Wszystkie zmiany zapisane na dysku, **bez commita, pusha i wdrożenia**. Istniejący nieśledzony katalog `.coolify/` zachowany; nie należy go dodawać do commita ani archiwum zmian.
- Oryginalny checkout `/Users/piotr/projekty/walldecor-app` oraz produkcja nietknięte.
- Agent wykonawczy zatrzymany. Własne uruchomienia build/test zakończyły się przed sprawdzeniem pauzy. Test przeglądarkowy zamknął Chromium i serwer oraz usunął swoją tymczasową bazę. Brak nasłuchu na porcie testowym 3118 potwierdzony `lsof`.

## Zaimplementowane

1. Przychody rzeczywiste brutto: miesięczny zapis zastępujący, jawne zero i ujemne korekty, opcjonalna data stanu, import/eksport bez planów, historyczne plany zachowane. Poprawiona utrata szkicu przy opóźnionym odświeżeniu danych.
2. Jeden model dashboardu dla `/` i `/dashboard`: rzeczywiste kwoty, wybór okresu, rozdzielenie wyniku i środków, jawne braki danych, istniejące alokacje. Pełny miesiąc/r/r wymagają potwierdzenia FinancePeriodClose i braku oczekujących dokumentów, również za poprzedni rok. Korekty aktywne uwzględnione; historyczne VOID nie blokują kompletności.
3. Kasa salonu: dostęp administratora/przypisanego pracownika, ręczna konfiguracja, poziom kasy stałej, wpływy, zwroty i kaucje, edycja/anulowanie operacji, zamknięcie, audytowane ograniczone korekty, depozyt, osobny odbiór i przeliczenie. Transakcje sald/audytu, wersje, idempotencja, brak dublowania przychodów i gotówki. Historia ma działające daty Warszawy i paginację. Zablokowana ręczna edycja salda kasy i dezaktywacja rachunku z nieprzeliczoną paczką.
4. Migracja addytywna `20260910070000_finance_actuals_cashier`; tylko Revenue.asOfDate i pięć tabel kasy, CHECK i unikalny otwarty raport. Bez automatycznego uruchamiania salonów.

Specyfikacja: `docs/superpowers/specs/2026-09-10-finance-cashier-design.md`.
Plan: `docs/superpowers/plans/2026-09-10-finance-cashier-plan.md`.

## Ostatnie dowody

- Baseline: 1508/1508 PASS (wcześniejszy niestabilny test HR przeszedł przy pełnym ponowieniu).
- Migracja: `node scripts/validate-finance-migrations.mjs` PASS. Pełny łańcuch na pustej bazie oraz uaktualnienie danych historycznych; przychody/plany/koszty/FTS/CHECK montażu zachowane, integrity/FK poprawne.
- Ostatni build: `npm run build -- --webpack` **PASS**, łącznie z produkcyjnym sprawdzeniem TypeScript; 142 strony statyczne. Ten build obejmuje ostatnie poprawki zapisane przed pauzą.
- Ostatni pełny zestaw: **1651/1652 PASS, 1 FAIL**. Wynik w `test-results/finance-full-tests-before-pause.json` (kopię źródłową zapisano w `/private/tmp/wd-finance-final-tests.json`).
- Pełny browser E2E **PASS** na wcześniejszym buildzie: prawdziwy import X-Api-Key bez JWT i odmowy401/410, Revenue100→150→120, konfiguracja kasy, operacje CRUD/anulowanie, cele300/250, konflikt409, depozyt1370 i idempotencja, korekty, kolejny dzień i niedobór, odbiór/przeliczenie z różnicą, ochrona rachunków, granice401/403/404, aktualna rola/przypisanie z bazy, restart i niezależny odczyt sald. Bez błędów przeglądarki.
- Wynik browser: `test-results/finance-cashier-evidence.json`; obrazy `test-results/finance-*.png`. Po ostatnim buildzie trzeba powtórzyć E2E — poprzedni PASS nie jest dowodem dla późniejszych drobnych zmian.
- `git diff --check` PASS na pauzie. Zakresowe lint i typecheck wcześniej PASS; ponowić po ewentualnej poprawce.

## Pierwsze kroki po wznowieniu

1. Sprawdzić `git status`, nie nadpisywać cudzych zmian i nie uruchamiać komend na bazie produkcyjnej.
2. Rozwiązać jedyny FAIL: `__tests__/unit/cashier/cashier-ui.test.tsx`, przypadek `locks uncertain writes until readback and explicitly discarded inputs reset even at unchanged version`. Po błędzie sieci test szuka przycisku „Zapisz kwoty”, lecz formularz otrzymuje `busy={locked}`, gdzie `locked` zawiera również `needsRefresh`, i przycisk jest opisany „Zapisywanie…”. **Rozdzielić stan faktycznego zapisu od blokady wymagającej odświeżenia**, zamiast bezrefleksyjnie osłabiać test. Sprawdzić również dalszą część testu: potwierdzone odrzucenie szkicu ma przywrócić wartości nawet przy niezmienionej wersji serwera (`editorResetKey`).
3. Ponowić testy jednostkowe kasy, pełny zestaw, lint i build; sprawdzić brak nowych problemów w finansach.
4. Uruchomić `node scripts/validate-finance-cashier.mjs` na finalnym buildzie. W sandboxie port jest blokowany EPERM; zatwierdzony wcześniej wyjątek dotyczył wyłącznie tego lokalnego skryptu. Skrypt tworzy własną tymczasową bazę i sprząta ją w `finally`.
5. Obejrzeć końcowe screenshoty desktop/mobile wszystkich trzech ekranów, w tym faktyczny arkusz i depozyty. Wcześniej obejrzano głównie stany diagnostyczne. Rozważyć ustawienie przewinięcia `main` przed zdjęciami, ponieważ shell aplikacji ma własny scroll.
6. Uzupełnić dziennik odbioru. Przed commitem/pushem i produkcją poprosić użytkownika o zgodę; nie utożsamiać lokalnej implementacji z wdrożeniem.

## Uwagi techniczne i granice

- Typecheck produkcyjny: `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.next.json`. Sam `tsc --noEmit` obejmuje wiele istniejących błędów typów starych testów; `.bin/tsc` w tym checkout ma problem z kopiowanym linkiem.
- W teście pustej SQLite przed `migrate deploy` tworzyć plik przez `sqlite3 <konkretna-ścieżka-testowa> 'VACUUM;'`. Migracje sortować leksykograficznie, nie `localeCompare` (podkreślnik w starej nazwie HR zmienia kolejność).
- Historyczny brak migracji ContentVisibilityGrant został zauważony w porównaniu schematu, ale nie należy go automatycznie „naprawiać” destrukcyjnym diffem. Testowany nowy przebieg finansowy działa z pełnym istniejącym łańcuchem.
- Uruchomienie produkcyjne kasy wymaga jawnego mapowania rachunku, daty i policzonego salda otwarcia oraz potwierdzenia właściwych pól raportu Subiekta (wpływy przed zwrotami, bez kaucji). Nie zgadywać tych danych.
- Nie zmieniono pamięci globalnej. Nie utworzono automatycznego wznowienia ani przypomnienia.
