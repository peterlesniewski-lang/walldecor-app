# Powiązanie i rozstrzyganie KSeF — lokalny odbiór 12 września 2026

## Wynik i granice

**PASS: rzeczywisty interfejs, HTTP i skutki finansowe na nowej syntetycznej SQLite.** Test nie korzystał z OAuth, produkcji ani zewnętrznej sieci KSeF. Nadejście obserwacji zostało zasymulowane przez wywołanie rzeczywistego serwisu uzgodnień; osobne 25 testów integracyjnych wykonuje handler synchronizacji, zastępując wyłącznie zewnętrznego klienta KSeF i sesję.

- Skrypt: `scripts/validate-invoice-ksef-ui.mjs`; uruchomienie: `node --preserve-symlinks --import tsx scripts/validate-invoice-ksef-ui.mjs --confirm-synthetic-local`.
- Produkcyjny build Next: `iWG9l6LT7mMJy_v8e2dQk`, 145 stron, bieżący typecheck PASS.
- Końcowy przebieg: `1789209169124-1ecfdb46`.
- Raport i 8 screenshotów: `test-results/invoice-ksef-ui-1789209169124-1ecfdb46/`.
- Baza: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-ksef-ui-7tl5XM/synthetic.sqlite`.
- Szkic: `cmty8y07d0007iuvhlyddukev`; faktura: `cmty8y07k000hiuvh18ijkga8`.

## Sprawdzone działanie

1. Przygotowanie fikcyjnej zatwierdzonej faktury 123/100/23 PLN wykonano przez rzeczywisty prywatny upload i serwisy szkicu/zatwierdzania. Nie był to nowy test dodawania przez UI — ten przebieg ma wcześniejszy [oddzielny dowód OAuth](2026-09-11-invoice-single-oauth-acceptance.md). Zadanie AI pozostało CANCELLED z `attempts=0`.
2. Zgodna obserwacja KSeF dała MATCHED i czytelny status obok zachowanego podglądu oryginału. Faktura i jedyny koszt nadal wynosiły 123 PLN.
3. Obserwacja 246/200/46 PLN dała CONFLICT, bez zmiany faktury/kosztu. Wspólna lista pokazała równocześnie „Zatwierdzona” i „KSeF · wymaga rozstrzygnięcia”. Ekran porównania pokazał obie kwoty i zablokował APPLY z instrukcją „Cofnij z kosztów”.
4. Administrator wybrał „Zachowaj moje dane”. Powstał jeden audyt KEEP_LOCAL, koszt pozostał 123 PLN, konflikt zniknął z listy, a decyzja pozostała nazwana świadomym zachowaniem danych — nie zgodnością.
5. Kolejna obserwacja 369/300/69 PLN ponownie otworzyła konflikt. Przy kompletnym wrześniu cofnięcie wymagało potwierdzenia. Anulowanie zachowało koszt i zamknięcie; dopiero potwierdzenie usunęło aktywny wpływ 123 PLN i oznaczyło miesiąc do ponownej kontroli, zachowując audyt zamknięcia.
6. OPEN z konfliktem nie pozwalał zatwierdzić kosztu. „Przyjmij dane KSeF do szkicu” zmieniło wyłącznie szkic, bez kosztu; formularz pokazał 369 PLN. Dopiero oddzielne „Zatwierdź i następna” utworzyło jeden aktywny koszt 369 PLN i zachowało to samo ID faktury. JAG, tag Stały i notatka administratora pozostały bez zmian.
7. Oryginał pobrany rzeczywistym mechanizmem przeglądarki ma identyczne bajty. Dashboard września pokazuje 369 PLN. Restart Next zachował dane, sesję, status uzgodnienia, fakturę i plik.
8. Przy szerokości 390 px obie kolumny 123/246 PLN oraz przyciski są widoczne bez poziomego przepełnienia. Przełączanie „Dokument”/„Dane” działa także po restarcie. Zrzuty desktop i telefonu sprawdzono wizualnie.

## Niezależny odczyt skutków

Audyt tylko do odczytu potwierdził jedną fakturę, koszt 123 VOID z odłączonym `sourceInvoiceId`, koszt 369 APPROVED/ACTIVE z JAG 100% i tagiem Stały, po jednym KEEP/APPLY/REVOKE i dwa zatwierdzenia. Są trzy obserwacje i jeden audyt ponownego otwarcia okresu; aktywnych zamknięć brak.

Oryginał w magazynie, fixture oraz pobrany PNG mają SHA-256 `5308bee7b5a45843c2834a8ba99dee0fee4f1b8d7d72b0525927abb0caf4421b`. SQLite: `integrity_check=ok`, zero błędów FK. Zero prób AI. Przeglądarka i serwer są zatrzymane; baza i pliki dowodów zachowane w prywatnych katalogach.

Pierwsze dwa uruchomienia samego harnessu zatrzymały się z powodu loadera aliasów TypeScript i loginu niezgodnego z normalizacją aplikacji. Poprawiono wyłącznie skrypt odbioru. Po PASS dodano zabezpieczenie, które zmienia wynik na FAIL, jeśli zamknięcie przeglądarki/serwera nie zostało potwierdzone; tę gałąź sprawdzono statycznie i lintem, a zapisane udane przebiegi mają oba potwierdzenia zamknięcia.

## Pozostałe bramki

### Rozszerzony przebieg ryzyk UI — PASS

Uruchomienie z dodatkowym `--include-ui-risks`, run `1789209988867-1278f896`, raport i 12 zrzutów w `test-results/invoice-ksef-ui-1789209988867-1278f896/`. Nowa baza: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-ksef-ui-Aw2Ypl/synthetic.sqlite`. Ten sam build; oba potwierdzenia cleanup są prawdziwe i wpływają na wynik gate.

- Dwie rzeczywiste karty otworzyły tę samą wersję szkicu. Bariera sieciowa zatrzymała oba żądania przed rzeczywistym handlerem; po zwolnieniu odpowiedzi wyniosły 200 i 409. Pierwsza karta użyła podwójnego kliknięcia. Powstał jeden nowy aktywny koszt i jeden audyt zatwierdzenia; przegrywająca karta pokazała nieaktualną wersję.
- Po cofnięciu kosztu administrator zmienił datę na 1 października. Przy zamkniętym wrześniu i październiku dialog wymienił oba okresy. Anulowanie zachowało oba zamknięcia i brak aktywnego kosztu. Potwierdzenie utworzyło jeden koszt 369 PLN w październiku oraz dwa audyty unieważnienia okresów. Rzeczywisty dashboard pokazał wrzesień 0 PLN, październik 369 PLN.
- Kontrolowany pośrednik odtworzył multipart znanego syntetycznego pliku z identyfikatorem paczki utworzonej przez UI. Zapisał do połączenia z rzeczywistym Next 79 121 bajtów, czyli połowę treści przy pełnym Content-Length, i zerwał połączenie. To licznik zapisu klienta HTTP, bez osobnego śladu bajtów odebranych przez serwer. UI pokazało ponowienie. Liczniki szkiców, załączników, zadań, faktur i kosztów oraz lista plików originals pozostały bez zmian; ponowienie przez UI wskazało istniejący dokument bez nowego zadania, pliku ani kosztu. UI utworzyło drugą pustą paczkę, więc nie twierdzimy, że nie zmieniła się żadna tabela. To dowód tego konkretnego przerwania HTTP, nie wszystkich możliwych awarii transportu lub niepewności zapisu.

Końcowy odczyt SQLite: jedna faktura, trzy historyczne koszty VOID (123, 369, 369 PLN), jeden APPROVED/ACTIVE 369 PLN z datą październikową; cztery audyty zatwierdzenia, trzy cofnięcia, trzy unieważnienia okresu (jeden z bazowego przebiegu, dwa ze zmiany daty). Jedyny job CANCELLED, `attempts=0`; `integrity_check=ok`, zero FK. Dwa wcześniejsze podejścia rozszerzenia zatrzymały się na szczegółach harnessu (wielkość liter nazwy miesiąca, brak bajtów pliku w przechwyconym body Playwright); poprawiono wyłącznie skrypt, bez zmian aplikacji i bez prób AI.

Niezależny audyt rozszerzonego przebiegu potwierdził powyższe rekordy, brak aktywnych zamknięć, zgodność SHA fixture/original/download oraz pusty processing. Sprawdził cztery kluczowe zrzuty. Surowe odpowiedzi 200/409 nie są oddzielnym artefaktem: dowodem jest ukończony gate wymagający tych odpowiedzi i komunikatu STALE_VERSION oraz zgodna historia jednej zmiany wersji 11→12.

Mieszana paczka z prawdziwym PDF/OAuth oraz ręczna obsługa AUTH i akcji szkicu przeszły późniejszy [oddzielny odbiór](2026-09-12-invoice-batch-manual-acceptance.md). Produkcja wymaga odbioru docelowego amd64, kopii bazy i plików, migracji klonu i weryfikacji publicznego przepływu. Nie wykonano commit/push ani wdrożenia.

## Domknięcie starszego formularza — duplikaty i otwarcie istniejącej faktury

Końcowy przegląd wykazał możliwość utworzenia drugiego kosztu przez starszy formularz bez pliku, mimo zatwierdzenia identycznego dokumentu przez import. Obie ścieżki używają teraz tego samego dopasowania tożsamości wewnątrz rezerwacji zapisu; starsze zatwierdzenie ponownie sprawdza duplikat. Kwota nie jest częścią tożsamości. Zachowano pełne zagraniczne identyfikatory. Testy najpierw odtworzyły 201/200 zamiast 409; po poprawce osobne SPEC i QUALITY PASS, z rzeczywistą SQLite i wyścigiem niezależnych klientów.

W UI konflikt zawiera działający przycisk otwarcia istniejącego dokumentu. Import otwiera oryginał i workspace; faktura bez pliku otwiera odczytowy podgląd ośmiu pól przez nowy ADMIN-only GET `private, no-store`. Nie powtarza tworzenia ani zatwierdzania.

- Przebieg: `1789212004439-aca60623`, `--confirm-synthetic-local --include-legacy-duplicates`.
- Świeży produkcyjny build reviewed sources: `g1oUIEPrwMYhq9zCtnhyo`, 145 stron; skrypt sam zapisuje BUILD_ID, nie weryfikuje hashy źródeł.
- Raport i 11 zrzutów: `test-results/invoice-ksef-ui-1789212004439-aca60623/`.
- SQLite: `/private/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-ksef-ui-DyYPl2/synthetic.sqlite`.
- Podstawowy przebieg KEEP/revoke/APPLY/approve, oryginał i dashboard 369 PLN ponownie PASS na nowym buildzie.
- Ręczne utworzenie identycznego importu z inną kwotą dało realne 409; przycisk otworzył istniejący oryginał bez nowego kosztu.
- Druga, odrębna faktura legacy 17 PLN została utworzona realnym POST 201, bez zatwierdzania. Kolejna próba tej samej tożsamości z kwotą 999 dała realne 409. Numer DE123456789 pozostał pełny.
- Pierwszy GET podglądu celowo zastąpiono 503. Formularz i przycisk pozostały; ponowienie wykonało tylko realny GET 200. Podgląd pokazuje 17,00 PLN, formularz nadal zawiera niezapisane 999. POST-y: 409/201/409; GET-y: testowe 503/realne 200.
- Końcowo dwa dokumenty, lecz tylko jeden aktywny koszt 369 PLN; starsza faktura 17 PLN jest NEW i bez kosztu. Liczby szkiców, załączników, zadań i kosztów nie wzrosły od prób duplikatu. Zero prób AI, SQLite integrity/FK i sprzątanie PASS.

Pierwszy przebieg rozszerzenia zatrzymał się na niejednoznacznym selektorze `role=alert`, mimo poprawnego widocznego komunikatu 503. Zawężono wyłącznie selektor do alertu z przyciskiem otwarcia; aplikacja nie wymagała zmiany. Nie jest to dowód awarii serwera 503 ani nowy test OAuth. API/unit obejmują również odrzucenie zatwierdzania wcześniej istniejącego duplikatu.

Niezależny audyt powtórnie odczytał SQLite, porównał SHA fixture/original/download, obejrzał trzy nowe zrzuty i potwierdził brak nasłuchu na zakończonym porcie. Potwierdzono dokładnie powyższe skutki, koszt historyczny 123 VOID i aktywny 369/JAG/fixed, jeden batch/draft/attachment/job oraz `attempts=0`. Surowe odpowiedzi HTTP nie są osobnymi plikami dowodowymi; statusy wynikają z ukończonych asercji i raportu.
