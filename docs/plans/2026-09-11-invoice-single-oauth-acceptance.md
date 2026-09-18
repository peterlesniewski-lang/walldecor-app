# Jedna faktura — lokalny odbiór UI/OAuth, 11 września 2026

## Wynik i zakres

**PASS: pełny przepływ jednej syntetycznej faktury.** Nie oznacza odbioru paczek, późniejszego dopasowania KSeF ani wdrożenia produkcyjnego.

Scenariusz: prawdziwy produkcyjny build Next, czysta SQLite po pełnym łańcuchu migracji, prywatne pliki, Playwright, izolowany Linux ARM64 i rzeczywisty odczyt przez dedykowaną sesję OAuth właściciela. Nie użyto atrap wyniku AI ani płatnego fallbacku.

- Skrypt: `scripts/validate-invoice-import-oauth.mjs`.
- Przebieg: `1789146924713-f3ca02c5`, build `Zg0GKxjxrB_Y3YlB7qMpp`.
- Raport: `test-results/invoice-import-oauth-1789146924713-f3ca02c5/report.json`.
- Obraz: `sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab`.
- Model i reasoning są przypięte w wcześniej zweryfikowanym obrazie: Codex `0.153.4`, `gpt-5.6-luna`, `low`. Wiersz zadania nie przechowuje osobnej kopii tych ustawień.
- Jedno zadanie `INVOICE_EXTRACT`, `SUCCEEDED`, `attempts=1`. To liczba trwałych przejęć kolejki, nie licznik wewnętrznych żądań HTTP dostawcy.

## Sprawdzone skutki

1. ADMIN dodał PNG przez „Dodaj faktury”. Podgląd oryginału był widoczny przed uruchomieniem workera. Upload stworzył jeden szkic i jedno oczekujące zadanie, bez faktury i bez kosztu.
2. Anonymous/manager/employee otrzymali 401/403 dla faktycznego multipart uploadu i pobrania pliku. Liczby załączników, szkiców, zadań i prób nie zmieniły się.
3. Surowy wynik odczytu przeszedł produkcyjny schemat JSON i dokładne sprawdzenie 12 pól syntetycznego dokumentu: m.in. `FV/TEST/2026/09/01`, `PL1234567890`, PLN 123/100/23, daty 10 i 24 września oraz jawne UNPAID. Te dane były widoczne w formularzu przed ręczną poprawką. Worker został zatrzymany przed dalszymi czynnościami finansowymi.
4. ADMIN poprawił dostawcę, wybrał JAG i tag „Stały”, zapisał szkic, następnie zatwierdził. Baza zawierała jedną fakturę MANUAL i jeden aktywny zatwierdzony koszt 123 PLN. Dashboard i ledger pokazały 123 PLN oraz JAG 100%.
5. „Pobierz oryginał” wywołało rzeczywiste pobranie przeglądarki, nie tylko odczyt API. Pobrane bajty są identyczne z przesłanym plikiem.
6. „Cofnij z kosztów” wyzerowało liczbę aktywnych kosztów, zachowując fakturę i historię. Edycja do 246/200/46 oraz daty 11 września i ponowne zatwierdzenie zachowały to samo ID faktury. Stary koszt 123 jest VOID i odłączony; nowy koszt 246 jest jedynym aktywnym.
7. Restart Next oraz uruchomienie pustej kolejki workera zachowały sesję aplikacji, identyfikatory, historię i oryginał; liczba prób AI pozostała równa jeden. Drugie pobranie oryginału ma ten sam SHA.

## Zachowane dowody

- Faktura: `cmtx7w7zd000pdhv1ac82ahab`; szkic: `cmtx7vzpx0007dhv1xexdctzp`; zadanie: `cmtx7vzpy0009dhv11x0959g3`.
- Baza: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-invoice-oauth-OFoybh/synthetic.sqlite`.
- Historia: CREATED → AI_RESULT_APPLIED → EDITED → APPROVED → REVOKED → EDITED → APPROVED. Audyt wyniku AI powstał przed pierwszą ręczną zmianą; istnieją blokady zmiany/usunięcia historii.
- Oryginał i oba pobrania: PNG, 157936 bajtów, SHA-256 `5308bee7b5a45843c2834a8ba99dee0fee4f1b8d7d72b0525927abb0caf4421b`.
- SHA-256 surowego wyniku AI: `59acf18dd94215c513cc646eb97e37ae6e43acec31517e45ae6bdf9475bfd46a`. Wynik zawiera również dwie schematowo poprawne pozycje warnings; nie wymagano, aby model zwracał pustą listę ostrzeżeń.
- W katalogu raportu: podgląd przed odczytem, dashboard 123 PLN, ledger z alokacją, formularz i historia po restarcie oraz dwa pobrane oryginały.
- Niezależny audyt tylko do odczytu potwierdził wynik schematu, chronologię, relacje, sumy, SHA, `integrity_check=ok` i zero błędów FK.
- Pliki dowodów, oryginał i baza mają `0600`, katalogi dowodów i prywatnego magazynu `0700`.
- Worker, przeglądarka i serwer zostały zatrzymane. Kontener tego przebiegu został usunięty i jego brak potwierdzono osobnym odczytem. Wolumenu OAuth nie odczytywano ani nie usuwano. Syntetyczną bazę i pliki zachowano.

## Wykryte i poprawione przed odbiorem

Pierwszy przebieg `1789146733743-530354be` zatrzymał się przed uploadem: proxy kierowało anonimowe wywołania importu do strony logowania zamiast pozostawić JSON 401 z autoryzującego się handlera. Zachowana baza tego przebiegu ma zero zadań, prób, szkiców, faktur i kosztów. Dodano wąski wyjątek transportowy dla namespace importu, zachowując świeżą kontrolę aktywnego ADMIN-a przed body/plikiem i pozostałe ograniczenia proxy. RED/GREEN, oba przeglądy, 15 testów powiązanych ścieżek oraz nowy build przeszły; kolejny przebieg potwierdził właściwe HTTP na żywo.

Oddzielnie pełna regresja wykryła wyścig testu timeoutu procesu przy obciążeniu. Poprawiono wyłącznie test: oczekiwanie na oba PID-y, deterministyczne przesunięcie deadline oraz natychmiastowa obserwacja odrzucenia. Asercje śmierci procesów i sprzątania pozostały bez zmian. Oba przeglądy i 44 testy renderera/harnessu przeszły. Pełna regresja o 19:09: 2305/2305, 241 plików, zero pominięć; po późniejszej poprawce proxy osobny zakres 15/15 i produkcyjny build 145 stron PASS. Końcowa pełna regresja pozostaje wymagana po dalszych zmianach.

## Pozostałe bramki

Paczka mieszana i prawdziwy PDF w przeglądarce, waluty obce, nieczytelne/brakujące dane, późniejsze dopasowanie i konflikty KSeF, duplikaty/dwie karty/przerwany upload, zamknięte miesiące, końcowy czysty UI/API/restart oraz docelowy obraz amd64. Produkcja wymaga kopii bazy i plików, migracji klonu i osobnego odczytu skutków wdrożenia. Nie wykonano commit/push ani wdrożenia.
