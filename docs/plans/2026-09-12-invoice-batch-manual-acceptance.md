# Paczka OAuth i ręczna obsługa AUTH — lokalny odbiór 12 września 2026

## Wynik i granice

**PASS: mieszana paczka od uploadu przez rzeczywisty OAuth po dwa koszty i restart. PASS: osobny brak logowania AI i ręczna obsługa przez interfejs.** Oba przebiegi użyły nowych syntetycznych SQLite, produkcyjnego buildu Next `iWG9l6LT7mMJy_v8e2dQk` i prywatnych katalogów. Nie dotyczy to produkcji ani docelowego amd64.

Obraz Linux ARM64: `sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab`, oficjalny Codex CLI 0.153.4, `gpt-5.6-luna`, reasoning `low`. Brak zmiany modelu/dostawcy i płatnego fallbacku. Każdy przebieg przeszedł oddzielne przeglądy SPEC i QUALITY przed wykonaniem.

## Mieszana paczka — rzeczywisty OAuth

- Skrypt: `scripts/validate-invoice-batch-oauth.mjs --confirm-synthetic-oauth --image <powyższy digest> --oauth-volume wd-ai-oauth-piotr-local-20260911`.
- Run: `1789210854836-39e08cae`; raport, 16 zrzutów i 5 pobranych oryginałów: `test-results/invoice-batch-oauth-1789210854836-39e08cae/`.
- Baza: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-invoice-batch-oauth-jqJGLA/synthetic.sqlite`.
- Paczka: `cmty9y7s00002o9766ev0taqw`. Końcowe faktury: `cmty9ywrk002mo9761gjlq7yy`, `cmty9yx9m003do976zilpawga`.

Administrator za jednym wyborem FileList dodał sześć wejść: PNG PLN, dwustronicowy PDF EUR, pusty PNG, ujemną korektę PNG, identyczny duplikat PLN oraz uszkodzony PDF. UI utworzyło jedną paczkę, cztery oryginały/szkice/zadania, wskazało jeden duplikat i odrzuciło uszkodzony plik. Sam upload nie utworzył faktury ani kosztu.

Przed startem workera sprawdzono metadane dwóch stron, natywny plugin PDF związany z bieżącym blobem oraz SHA pobranego pliku. To dowód osadzenia i bajtów; skrypt nie deklaruje wizualnego odbioru obu stron. W samym PDF dane dostawcy są na stronie pierwszej, a kwoty i płatność na drugiej.

Trwałe blokady SQLite zamroziły cztery ID zadań i zabroniły drugiej próby oraz piątego zadania. Wszystkie cztery zadania rzeczywistego OAuth zakończyły się SUCCEEDED, każde z `attempts=1`. Zanim rozpoczęto finansowe decyzje UI, potwierdzono czyste zatrzymanie workera. Wyniki przeszły rzeczywisty produkcyjny schemat i porównanie wszystkich wymaganych pól:

| Dokument | Odczyt i decyzja | Aktywny koszt |
|---|---|---|
| Faktura PLN | 123/100/23 PLN, pełny PL1234567890, daty, UNPAID; JAG/Stały i zatwierdzenie przez UI | 123 PLN |
| Faktura EUR, 2 strony | 100/80/20 EUR, pełny DE123456789, daty, UNPAID; brak domyślnego kursu | Dopiero po ręcznym wpisaniu 430 PLN, opisu i zaznaczeniu potwierdzenia: 430 PLN |
| Pusty PNG | OTHER, dane i kwoty null, płatność UNKNOWN; zatwierdzenie odrzucone 422 | Brak |
| Ujemna korekta | CORRECTION, -123/-100/-23; zatwierdzenie odrzucone 422 | Brak |

Pusta faktura i korekta przeszły przez rzeczywiste „Pomiń na teraz”, archiwizację i przywrócenie. Dane, pliki i liczba czterech zakończonych zadań nie zmieniły się. Próba zatwierdzenia EUR przed potwierdzeniem PLN także zwróciła 422 i nie zmieniła kosztów.

Dashboard pokazuje dokładnie **553 PLN**, a rejestr dwie pozycje 123 i 430 PLN, obie JAG 100%/Stały. Obie faktury i koszty mają źródło MANUAL. Nominalne 100 EUR i pełny zagraniczny identyfikator pozostają w fakturze; nie zostały potraktowane jako PLN.

Restart Next oraz bezczynnego workera nie zmienił ID, danych, historii ani liczby prób. Oryginały pobrano pięć razy: EUR przed AI, oba przed zatwierdzeniem i oba po restarcie. SHA PNG `2e1d28d7cbe0e85081069f5ed920499d3136a3a79848f07f319fb5de810b8048`, PDF `130367cb7a313d2a3ad68424cdec8ed06c4b9df0a18f2ef4d98a18752a8b6f20`. Cztery oryginalne pliki zachowane, SQLite integralne, zero naruszeń FK. Własny kontener, Next, przeglądarka i klient bazy zatrzymane; dedykowany wolumen OAuth zachowany bez odczytywania lub kopiowania poświadczeń.

Liczba czterech prób oznacza claims trwałej kolejki, nie wewnętrzne żądania HTTP CLI. Ten udany zestaw nie oznacza bezbłędnego OCR wszystkich faktur; ręczna kontrola nadal jest obowiązkowa.

Niezależny audyt tylko do odczytu potwierdził schemat i pola wszystkich czterech zapisanych wyników, dokładne końcowe rekordy/koszty/klasyfikację, historię obu dokumentów bez kosztu, integralność/FK oraz SHA sześciu fixture, czterech oryginałów i pięciu pobrań. Zrzuty potwierdzają układ 4+1+1, blokady, przeliczenie, dashboard i rejestr. Pokazują pierwszą stronę PDF i fragment drugiej po restarcie, nie pełny wizualny odbiór obu stron. Chronologia restartu jest dowodem przejrzanego harnessu, nie samych końcowych rekordów.

### Pierwszy przebieg zatrzymany przed AI

Run `1789210472724-22a232bd` przyjął tę samą strukturę paczki, ale nie przeszedł starego selektora PDF. Zrzut pokazywał dokument; osobna diagnostyka ustaliła, że Chromium umieszcza `application/x-google-chrome-pdf` w zagnieżdżonej ramce zamiast `application/pdf` w ramce zewnętrznej. Poprawiono tylko harness i sprawdzono aktualny blob. Pierwszy przebieg miał cztery QUEUED/0, zero zdarzeń workera i poprawny cleanup — nie zużył próby AI. Nie powtarzano modelu w celu uzyskania korzystniejszego odczytu.

Przed wykonaniem domknięto także wyścig przerwanie–start, obsługę odrzuconych oczekiwań przeglądarki i dokładne asercje kwot. Testy harnessu: 25 PASS, w tym rzeczywista SQLite i regresja startu po anulowaniu. Osobny przegląd QUALITY potwierdził poprawki.

## Brak logowania i ręczna obsługa

- Skrypt: `scripts/validate-invoice-manual-auth-ui.mjs --confirm-missing-auth --image <powyższy digest>`.
- Run: `1789210797204-965851dc`; raport, 9 zrzutów i 4 pobrania: `test-results/invoice-manual-auth-1789210797204-965851dc/`.
- Baza: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-invoice-manual-auth-LRsMiE/synthetic.sqlite`.
- SHA bazy: `5210a78f671681046b9c57247bfc93929c308d93685ccce8f569cd3d0490310e`.

Ten kontener otrzymał **pusty jednorazowy tmpfs `/oauth`**, nigdy sesję właściciela. Po pierwszym uploadzie rzeczywisty CLI spowodował BLOCKED/AUTH, jedną próbę i wstrzymanie wspólnej kolejki. UI pokazało brak dostępu i możliwość ręcznego wypełnienia. Skrypt potwierdził `Running=false`, exit 0, zanim edytował fakturę; zapisany czas od końca zadania do zatrzymania wynosił 129 ms.

Administrator ręcznie uzupełnił dokument 123/100/23 PLN, typ, pełny identyfikator podatkowy, daty, UNPAID, JAG i Stały. Zapis szkicu nie stworzył kosztu. Zatwierdzenie utworzyło dokładnie jedną fakturę i koszt 123 PLN, zachowując oznaczenie ręcznych pól, historię i oryginał. Nie ma audytu AI_RESULT_APPLIED ani wyniku AI. Samo zatwierdzenie nie wznowiło kolejki.

Drugi, pusty PNG dodano przez UI przy pauzie AUTH. „Pomiń”, archiwizacja, filtr archiwum i przywrócenie zachowały plik i pusty szkic; archiwizacja anulowała nieuruchomione zadanie. „Odczytaj ponownie” utworzyło rewizję 2 i nowe QUEUED/0 oraz świadomie zdjęło pauzę. Worker pozostał zatrzymany i nie był ponownie uruchamiany. Restart dotyczył wyłącznie Next.

Końcowe trzy zadania: BLOCKED/AUTH/1, CANCELLED/0, QUEUED/0. Szkic główny APPROVED, drugi OPEN z pustymi danymi i rewizją 2; jedna faktura i jeden koszt JAG/Stały 123 PLN. Dashboard i dokładna komórka rejestru pokazują 123 PLN. Dwa oryginały i cztery pobrania mają zgodne SHA oraz 0600; processing pusty. Integralność SQLite poprawna, FK 0, cleanup własnych zasobów PASS.

Niezależny audyt tylko do odczytu potwierdził wszystkie końcowe rekordy, audyty, SHA bazy/plików i sześć kluczowych zrzutów. Chronologię startu/zatrzymania/restartu potwierdzają zapisany raport i przejrzany kod, nie sam końcowy plik SQLite. Testy harnessu: 23 PASS, w tym utrata zapisanego claimu, fałszywe dopasowanie kwoty i odrzucenie oczekiwania na pobranie.

To brak logowania przy starcie, nie zdalne odebranie aktywnej sesji OAuth ani dowód jej późniejszego przywrócenia. Nie wywoływano modelu zastępczego i nie wykonano operacji kasowych/przelewów.

## Pozostałe bramki

Końcowa regresja i integracyjny przegląd całości, docelowy obraz amd64 oraz osobna zgoda na commit/push. Wdrożenie wymaga kopii bazy/plików, migracji klonu, logowania właściciela w prywatnym środowisku produkcyjnym i sprawdzenia publicznego przepływu. Lokalny odbiór nie jest wdrożeniem.
