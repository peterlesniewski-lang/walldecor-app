# Odbiór — przychody, dashboard i kasa salonu

Data: 10.09.2026. Checkout: `/Users/piotr/projekty/ksiegowosc/walldecor-ksef`. Gałąź: `feat/finance-actuals-cash-ledger`, baza `00a38be37155b947b840cc0b4ec3590c0d68484b`.

## Stan publikacji

Lokalny odbiór zakończony. Właściciel 10.09.2026 zatwierdził commit i push gałęzi `feat/finance-actuals-cash-ledger`; potwierdzeniem ich wykonania jest historia Git i zgodność zdalnego SHA. Zgoda nie obejmuje PR, merge ani wdrożenia. Produkcja oraz oryginalny checkout nie były zmieniane. Istniejący nieśledzony `.coolify/` nie należy do tego zakresu.

## Dostarczony zakres

1. **Przychody** (`/finance/revenue`): miesięczne rzeczywiste brutto po korektach, nadpisanie poprzedniej kwoty, jawne zero i wartości ujemne, brak wpisu zamiast zmyślonego zera, opcjonalna data stanu. Oba importery i eksport CSV korzystają z wykonania. Historyczne plany sprzedaży pozostają w bazie; próby korzystania z wycofanego planu są jawnie odrzucane. Budżety kosztowe bez zmian.
2. **Dashboard** (`/` i `/dashboard`): jeden model rzeczywistych danych, wybór miesiąca, wynik orientacyjny brutto, widoczne braki danych, istniejące alokacje kosztowe, oczekujące dokumenty osobno, porównywalne r/r i właściwy zakres sum narastających. Zamknięcie okresu i brak oczekujących dokumentów są warunkiem kompletności kosztów. Bieżące salda środków są oddzielone od wyniku miesiąca.
3. **Kasa salonu** (`/cashier`): ręczna konfiguracja, aktywny pracownik tylko we własnym salonie, administrator obu salonów; wpływy, zwroty, kaucje, edycja/anulowanie operacji, kasa stała, liczenie gotówki i wyjaśnienia różnic, zamknięcie i depozyt. Osobny odbiór paczki i osobne przeliczenie, korekta ostatniego raportu przed granicą kolejnego dnia/odbioru, historia zmian, filtry i paginacja.

Zamknięcie nie tworzy dodatkowego miesięcznego przychodu. Oczekujący depozyt jest częścią salda rachunku salonu, nie dodatkowym aktywem. Odbiór przenosi kwotę, a przeliczenie aktualizuje tylko różnicę. Wszystkie zmiany sald i audyt są transakcyjne; wersje i idempotencja chronią przed nadpisaniem i podwójnym wykonaniem.

## Dowody i powtarzalne sprawdzenie

Końcowy kod po poprawkach blokady zapisu i zachowania szkiców panelu środków:

- **1657/1657 testów PASS**, 0 błędów i 0 pominiętych. Kopia raportu: `test-results/finance-full-tests-final.json`.
- **Build PASS** (`next build --webpack`), produkcyjny TypeScript i generowanie 142 stron.
- **Migracje PASS**: pełny `migrate deploy` na pustej bazie i zachowanie danych historycznych przy upgrade.
- **Browser E2E PASS** na końcowym buildzie, 8 grup scenariuszy, bez błędów runtime przeglądarki; niezależny odczyt danych po restarcie.
- **Zakresowy ESLint PASS** (nowa domena i UI kasy, dashboard/model danych, przychody/importery, proxy i regresje UI); `git diff --check` PASS.
- **Niezależne przeglądy PASS**: domena kasy i zabezpieczenia, finanse rzeczywiste/dashboard, poprawka przerwanego zapisu i ochrona szkiców. Brak pozostawionych P1/P2 w sprawdzonym zakresie.

Regresje odtworzono przed poprawkami: niepewny zapis miał mylącą etykietę „Zapisywanie…”, a zmieniony snapshot sald resetował formularze. Po poprawkach blokada pozostaje do odczytu, szkice nie znikają, a zmiana edytowanej wartości wymaga jawnego wczytania aktualnych danych. Ta ostatnia ochrona dotyczy otrzymanego snapshotu UI; nie dodaje wersjonowania do starych ręcznych API rachunków.

Komendy do powtórzenia:

- Pełny zestaw: `npm test -- --reporter=json --outputFile=/private/tmp/wd-finance-final-tests.json`.
- Build: `npm run build -- --webpack` (produkcyjny TypeScript i strony Next.js).
- Migracje: `node scripts/validate-finance-migrations.mjs` — pełny łańcuch na pustej SQLite oraz uaktualnienie historycznych danych. Przychody, plany, koszty, FTS i istniejące CHECK pozostają zachowane; sprawdzane są integralność i klucze obce. Brak aktywacji kas po migracji.
- Przeglądarka: `node scripts/validate-finance-cashier.mjs` — własny serwer na 127.0.0.1:3118, tymczasowa baza utworzona przez `migrate deploy`, prawdziwe logowanie i zapis. Skrypt nie używa danych produkcyjnych; zamyka przeglądarkę/serwer i usuwa swoją bazę w `finally`.
- Artefakty przeglądarkowe: `test-results/finance-cashier-evidence.json` i `test-results/finance-*.png` (desktop/mobile oraz dolne części długich ekranów).

Przebieg obejmuje import z kluczem i odmowy 401/410; 100 → 150 → 120 w przychodach; przerwany zapis i bezpieczny odczyt; konfigurację, zwroty/kaucje i anulowanie, zmianę celu 300/250, konflikt wersji 409, depozyt 1370, ponowienie bez drugiego depozytu, korektę i niedobór. Odbiór zachowuje sumę rachunków, przeliczenie 1360 zamiast 1370 dopisuje różnicę −10. Sprawdzane są role, dostęp między salonami, zmiana roli przy istniejącej sesji, nieaktywny pracownik i niezależny odczyt po restarcie.

## Warunki bezpiecznego uruchomienia

1. Zgoda na commit/push tej gałęzi została udzielona; nadal wymagana osobna decyzja o merge i wdrożeniu. Nie dodawać `.coolify/`, baz, plików środowiskowych ani danych dostępowych.
2. Przed wdrożeniem wykonać spójną kopię produkcyjnej SQLite (z uwzględnieniem WAL), odtworzyć ją w izolacji, sprawdzić nową migrację, integralność oraz odczyt starych danych. Dopiero potem wdrożyć i zweryfikować publiczny przebieg z prawdziwą autoryzacją. Nie używać `migrate reset` ani `db push --accept-data-loss` na istniejącej bazie.
3. Dla każdego salonu potwierdzić datę startu, fizycznie policzone otwarcie, cel kasy stałej i rachunek. Nie wywnioskowywać przypisania z nazw sejfów. Nowego rachunku nie tworzyć dla gotówki już ujętej gdzie indziej.
4. Potwierdzić pola raportu Subiekta: wpływy sprzedażowe przed osobno rejestrowanymi zwrotami i bez kaucji. Zapobiega to dwukrotnemu odjęciu zwrotów. Sprawdzić aktualne przypisania pracowników.
5. Pierwszy prawdziwy dzień odebrać z niezależnym porównaniem raportu, policzonej gotówki, paczki oraz sald. Nie wprowadzać do produkcji demonstracyjnych raportów.

## Granice tej wersji

Brak automatycznego rozliczania banku/kart i płatności KSeF, pełnego rejestru zobowiązań z kaucji, transferów między salonami, importu historii arkuszy i ogólnych korekt dawnych zamkniętych okresów. Aktualizacja kasy stałej nie zmienia historii. Brak offline — niepotwierdzony zapis wymaga odświeżenia i sprawdzenia stanu.

W istniejącej historii repo wykryto niezwiązaną różnicę migracyjną `ContentVisibilityGrant`; nie była naprawiana automatycznym diffem. Lokalne testy całego nowego przebiegu korzystają z istniejącego pełnego łańcucha migracji, ale nie zastępuje to migracji kopii rzeczywistej bazy przed wdrożeniem.
