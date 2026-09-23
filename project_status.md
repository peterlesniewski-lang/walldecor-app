# Project Status — WallDecor App

**Ostatnia aktualizacja:** 2026-09-23 (automatyczna synchronizacja KSeF 2× na dobę)

## Automatyczna synchronizacja KSeF (2026-09-23)

- [x] Synchronizacja KSeF uruchamia się sama codziennie o **07:00 i 15:00 (Europe/Warsaw)** — bez klikania „Synchronizuj z KSeF”.
- [x] Logika wydzielona do `src/lib/finance/ksef-sync-service.ts` (`runKsefSync`, `withKsefSyncLock`); `POST /api/finance/ksef/sync` korzysta z serwisu i zwraca 409, gdy inna synchronizacja trwa.
- [x] Harmonogram w procesie serwera: `src/instrumentation.ts` → `src/lib/finance/ksef-auto-sync.ts` (sprawdzenie co 5 min, jeden przebieg na slot, nadrabianie slotu pominiętego po restarcie). Działa w imieniu pierwszego aktywnego ADMIN.
- [x] Ustawienia → KSeF: przełącznik „Automatyczna synchronizacja” (`ksef_auto_sync_enabled`, domyślnie włączona) i status ostatniego uruchomienia (`ksef_auto_sync_last_*`). Zmienna `KSEF_AUTO_SYNC=off` wyłącza harmonogram na poziomie serwera, `=on` włącza go w dev.
- [x] Testy: `__tests__/unit/finance/ksef-auto-sync.test.ts` (16), pełny pakiet 2998 PASS, typecheck i build PASS, smoke test standalone — harmonogram zapisał wynik slotu.

## Bieżąca praca: faktury spoza KSeF i wspólne AI

Izolowany checkout `walldecor-invoice-ai`, gałąź `feat/invoice-import-codex-ai`, baza `391518d`. Właściciel zatwierdził publikację i wdrożenie 12 września; przygotowanie produkcji trwa, aplikacja nie została jeszcze przełączona. [Zatwierdzony plan i bramki](docs/plans/2026-09-10-invoice-import-codex-ai.md).

**Stan bieżący, 12 września:** mieszana paczka rzeczywistego OAuth, ręczna obsługa AUTH, rozstrzyganie KSeF i ryzyka UI odebrane lokalnie. Końcowe poprawki duplikatów i bezpiecznego Markdown przeszły SPEC/QUALITY; 2653 testy, typecheck oraz świeży build PASS. Lokalny amd64 przeszedł ZERO-tools, lecz próba blokady sesji zatrzymała się przed oceną mechanizmu; wymagany odbiór natywny. [Końcowy raport lokalny i warunki publikacji](docs/plans/2026-09-12-invoice-final-local-acceptance.md). Poniższe punkty są chronologicznym dziennikiem: starsze oznaczenia „jeszcze przed odbiorem” zastępują nowsze wyniki.

- Wspólny model danych rzeczywistych dashboardu/czatu, jawna kompletność i oddzielenie braków od zera — testy i niezależny przegląd lokalny wykonane.
- Addytywna trwała kolejka `AiJob`/`AiQueueLease`, priorytet czatów, prawa właściciela, ponowienia, blokada i ochrona przed spóźnionym wynikiem — testy rzeczywistej SQLite, w tym oczekiwanie na blokadę po wygaśnięciu terminu.
- Oba API czatów oraz wszystkie ich panele przechodzą na `202 {job}` i autoryzowane GET/retry. Anthropic usunięty z czynnej ścieżki i deklarowanych zależności. Nowy wykonawca nie ma płatnego fallbacku.
- Przypięty Codex `0.153.4`, `gpt-5.6-luna/low`, własny katalog możliwości bez narzędzi; test z lokalnym sztucznym serwerem obejmuje PNG, ścisły JSON i wymuszone próby narzędzi. To nie jest dowód rzeczywistego OAuth.
- Lokalny odbiór przygotowanej części: **1846/1846 testów**, typecheck, build, zakresowy lint i Playwright PASS. Pięć syntetycznych zadań po rzeczywistych API, role, QUOTA/retry, desktop/telefon i trwałość po restartach Next. Zero faktur/kosztów powstałych z testowych pytań. [Raport i granice dowodów](docs/plans/2026-09-10-shared-ai-local-acceptance.md).
- Historia AI blokuje twarde usunięcie konta kontrolowanym 409 również przy wyścigu; można je dezaktywować. Nie usuwamy historii. Przygotowany obraz ma prywatne katalogi UID 1000/0700 i domyślnie uruchamia tylko walidację.
- Bramka Linux ARM64 z 11 września: rzeczywisty minimalny obraz, ZERO-tools, blokada między kontenerami i po SIGKILL nadzorcy PASS; kontrola negatywna wykryta. Poprawiono składnię logowania i granicę argumentów obraz/stdin, przebudowano obraz i powtórzono bramki. Pełna regresja **1897/1897 PASS**, aktualne typecheck aplikacji/skryptów i build PASS. [Dowody i granice](docs/plans/2026-09-11-shared-ai-linux-acceptance.md).
- Właściciel ukończył dedykowane logowanie. Rzeczywisty smoke **3/3 PASS**: syntetyczna faktura, finanse i encyklopedia. Jedna wcześniejsza próba miała nieodtworzone `VALUE_MISMATCH`; ręczna kontrola odczytu nadal wymagana.
- Rzeczywiste **oba czaty UI/OAuth, wznowienie oczekującego pytania po restarcie i cofnięcie roli PASS**: trzy udane zadania inferencji, czwarte `ACCESS_REVOKED` bez próby modelu. Osobny rzeczywisty test z pustym OAuth: `BLOCKED/AUTH` + drugie zadanie wstrzymane bez próby, stan i komunikaty zachowane po restarcie. Sesja właściciela nie została cofnięta. Zero faktur/kosztów, integralność SQLite i sprzątanie PASS.
- Błędy loginów testowych, importu TypeScript i powtórzonego nagłówka fixture usunięto w harnessie, bez osłabiania asercji. Końcowa pełna regresja **1949/1949 PASS**, 216 plików, bez pominięć; bieżący typecheck i produkcyjny build (143 strony) PASS. [Komplet dowodów i ograniczenia](docs/plans/2026-09-11-shared-ai-linux-acceptance.md).
- Fundament szkiców: cztery nowe tabele, addytywna migracja `20260911150000_invoice_import_drafts`, niezmienny audyt, trwałe powiązanie z fakturą oraz ochrona ręcznych pól przed wynikiem AI. **11/11 testów zakresowych PASS** po niezależnym review; świeży łańcuch i aktualizacja wcześniejszego łańcucha zachowują dane oraz integralność SQLite. To jeszcze nie jest upload ani zatwierdzanie.
- Poprawiony helper zatwierdzania zachowuje źródło MANUAL/KSEF; brakujące przeliczone netto/VAT waluty obcej pozostają `null`. **10/10 testów helpera i dotychczasowej ścieżki approve PASS**, osobne przeglądy zgodności i jakości bez blokad. Sumy listy i ostrzeżeń walutowych wymagają jeszcze osobnej poprawki.
- Prywatny magazyn oryginałów: dokładne bajty, UUID/SHA-256, kontrolowany rozmiar, uprawnienia, brak nadpisywania i kompensacja tylko wskazanego pliku. Po review dodano synchronizację katalogu nadrzędnego także przy ponowieniu pierwszego zapisu. **24/24 testy rzeczywistego filesystemu PASS**, lint oraz oba przeglądy bez pozostałych blokad. Podłączenie do HTTP i trwałego wolumenu jeszcze przed odbiorem.
- Serwis szkiców: aktualne prawa ADMIN, paczki właściciela, limit 20, deduplikacja SHA, wersjonowane akcje i ochrona ręcznych danych. Wynik AI oraz zakończenie zadania zapisują się w jednej transakcji; stare wyniki nie zmieniają szkicu. Po obu przeglądach dodano wymuszoną awarię końcowego audytu: **48/48 testów serwisu i kolejki PASS**, bez pominięć. Osobny transport HTTP wykonawcy: **5/5 PASS** z rzeczywistym lokalnym nasłuchem. Zatwierdzanie kosztu i endpointy importu pozostają do podłączenia.
- Wspólne helpery finansowe: znane sumy PLN oddzielone od liczby i kwot nieprzeliczonych walut; pełne kwoty dokumentów PARTIAL/UNKNOWN nie są nazywane pozostałym saldem. Zmiana kompletnego miesiąca wymaga ID aktualnego zamknięcia, zachowuje jego pełny audyt i oznacza okres do sprawdzenia. **20/20 testów zakresowych PASS**, oba przeglądy zakończone; test późnej awarii obejmuje cofnięcie wcześniejszych zapisów i mutacji wywołującego. Integracja z widokami i zatwierdzaniem jeszcze przed odbiorem.
- Walidacja zatwierdzenia i tożsamości dokumentu: jawne wymagane dane, data graniczna, blokada innych typów, dokładne zaokrąglenie groszy oraz odrębne PLN. Pełne identyfikatory zagraniczne pozostają w danych; puste kanoniczne identyfikatory nie tworzą fałszywych duplikatów. **46/46 testów i oba przeglądy PASS**. To polityka danych, jeszcze nie odbiór transakcji zatwierdzania.
- Inspekcja oryginałów i renderer: rzeczywisty Poppler, deterministyczne obrazy 1–10 stron, ograniczenia czasu/rozmiaru, prywatne pliki tymczasowe i ograniczone środowisko procesów. Po niezależnym przeglądzie dodano kontrolę APNG, zakończenia PNG/JPEG i struktury WebP. **29/29 testów PASS**, w tym rzeczywisty 10-stronicowy PDF; oba przeglądy bez blokad. Ten dowód dotyczy lokalnych binariów, nie zaktualizowanego obrazu Linux.
- Transakcje importu approve/revoke przeszły oba niezależne przeglądy. **45/45 testów rzeczywistej SQLite PASS**: dwa różne szkice tego samego dokumentu zatwierdzane równolegle tworzą jeden koszt; awaria końcowego audytu cofa także revoke i unieważnienie kompletności miesiąca. Ponowne zatwierdzenie zachowuje to samo ID faktury i historyczne części wycofanego kosztu.
- Sumy w obu producentach listy, kondycji firmy i progu rentowności używają wspólnych reguł PLN; wycofane importy pozostają widoczne, ale nie wpływają na aktywne sumy. Po obu przeglądach sprawdzono także starszy format podsumowań. Świeży wspólny zestaw z powyższą transakcją i multipart: **98/98 PASS**, 10 plików. To test kodu, jeszcze nie odbiór dashboardu przez przeglądarkę.
- Prywatny upload/original oraz 7 plików tras importu są podłączone: list/detail/edit/actions/approve/revoke/file/history. Konfiguracja katalogów jest leniwa i zamknięta na brak ustawień; odrzuca ścieżki publiczne, nakładające się katalogi i dowiązania. Oryginał ma kontrolę bajtów, MIME i SHA-256, prywatne nagłówki oraz nazwę UTF-8. Oba przeglądy API PASS; poprawiono drobny przypadek query `__proto__`. **8/8 testów HTTP z prawdziwą bazą i plikami PASS**, w tym wywołanie przez klienta przeglądarkowego; osobno 4 testy konfiguracji, 2 tras i 3 regresji multipart PASS.
- Oryginał dociera do wykonawcy wyłącznie przez aktualny lease i wiązanie szkicu, kontrolowane przed i po odczycie. Transport sprawdza MIME/długość/SHA, limit 10 MiB, czas i anulowanie; renderer zachowuje obrazy do zakończenia Codexa. Oba niezależne przeglądy PASS; świeży test rzeczywistego transportu HTTP **5/5 bez pominięć**. Zaktualizowany obraz i odczyt importu przez OAuth pozostają do osobnego odbioru; nie uruchomiono produkcji.
- Klient przeglądarkowy i prywatny podgląd przeszły przeglądy zgodności i jakości. Utrwalono dodatkowe regresje strumienia, limitu, czasu, utraty odpowiedzi i zmiany dokumentu. Przy błędzie dekodowania URL pliku zwalnia się od razu. **25/25 testów klienta, podglądu i HTTP PASS**; rzeczywisty adapter approve/revoke sprawdzony wraz z idempotencją i skutkami SQLite. PDF w prawdziwej przeglądarce i cały ekran importu nadal wymagają odbioru.
- Podłączono wejście „Dodaj faktury” na istniejącej liście i bezpośrednie otwieranie trwale powiązanego szkicu. Takie faktury są wyłączone ze starych edytorów oraz zbiorczego oznaczania płatności; OPEN/ARCHIVED są jawnie poza kosztami, a płatność PARTIAL/UNKNOWN ma odrębne etykiety. **35/35 testów listy/SSR/API PASS**. Końcowy przegląd tej integracji jest jeszcze otwarty.
- Ostatnie stosowanie reguł po synchronizacji KSeF działa we wspólnej transakcji rezerwującej zapis przed odczytem. **16/16 testów sync i ochrony starych writerów PASS**. Pozostałe ścieżki aktualizacji z KSeF i rozstrzyganie różnic pozostają do podłączenia przed końcowym odbiorem.
- Edytor importu przeszedł osobne przeglądy zgodności i jakości: chroni niezapisane pola i podstawę potwierdzenia waluty, blokuje cofnięcie przy nieaktualnej wersji oraz ujawnia błędne pola. Przywrócono gotowe menu Radix z obsługą klawiatury i blokadą po zmianie stanu. **31/31 testów edytora/helpera PASS**; niezależne próby fokusu, klawiatury i otwartego menu po zmianie stanu również bez usterek. W testach pozostaje drobne ostrzeżenie synchronizacji React/Radix.
- Główny workspace i integracja listy mają **SPEC oraz QUALITY PASS** po poprawkach utraty odpowiedzi PATCH, brakującej waluty, historii przy zmianie dokumentu i przejścia ze starego edytora części. Niepewny zapis nigdy nie przechodzi automatycznie do zatwierdzenia. Domknięto także dwa drobne przypadki odświeżania komunikatu/historii; ponowny niezależny QUALITY PASS, **50/50 testów obu widoków PASS** i aktualny typecheck.
- Aktualna pełna regresja: **241 plików, 2294/2294 testy PASS, zero pominięć**, 11 września 18:55, z rzeczywistym przypiętym CLI przeciwko syntetycznemu lokalnemu serwerowi bez OAuth. Pierwszy przebieg sandboxowy zatrzymał jeden test na `listen EPERM`; powtórzenie z dostępem do lokalnych portów przeszło bez zmiany kodu. Bieżący typecheck, zakresowy lint i produkcyjny build **145 stron PASS**. To nadal nie jest odbiór jednej faktury przez OAuth.
- Nowszy przebieg 19:04: **2302 PASS / 1 FAIL**. Test timeoutu renderera nie znalazł pliku śladu procesu; przyczyna jest diagnozowana, a bramka pełnej regresji ponownie otwarta. Produkcyjny build po najnowszych poprawkach UI przeszedł. Nie wykonano jeszcze nowego odczytu OAuth.
- Przyczyną powyższej awarii był wyścig startu procesu w teście z limitem 1 s; kod produkcyjny nie wymagał zmiany. Po oczekiwaniu na oba PID-y i deterministycznym wymuszeniu deadline nowa pełna regresja **241 plików, 2305/2305 PASS, zero pominięć**, 19:09. Dodatkowo domykana jest obsługa odrzucenia w ścieżce awaryjnej samego testu.
- Nowy obraz importu Linux ARM64 `sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab` ma zgodne hashe plików z checkoutem oraz syntetyczne dowody ZERO-tools i blokady sesji; nie wysłano go do produkcji. Skrypt pojedynczego odbioru UI/OAuth na czystej SQLite przeszedł osobne SPEC i QUALITY, **15/15 testów PASS**: dodatnia weryfikacja zatrzymania kontenera, rzeczywisty multipart odmowy dostępu, obsłużone przerwanie i prywatny screenshot awarii. Rzeczywista próba nie została jeszcze uruchomiona.
- **Jedna faktura — rzeczywisty UI/OAuth PASS**, przebieg `1789146924713-f3ca02c5`: upload i podgląd przed odczytem, dokładny JSON przed ręczną poprawką, klasyfikacja JAG/Stały, koszt 123 PLN na dashboardzie, rzeczywiste pobranie z SHA, cofnięcie i ponowne zatwierdzenie 246 PLN z tym samym ID faktury. Restart zachował plik, historię i jedną próbę AI. Niezależny audyt SQLite/SHA/uprawnień i kontrola screenshotów PASS. Pierwsza próba przed uploadem ujawniła przekierowanie zamiast JSON 401; wąska poprawka proxy przeszła oba przeglądy, 15 testów i nowy build. [Raport, dowody i granice](docs/plans/2026-09-11-invoice-single-oauth-acceptance.md).
- Cofnięte importy OPEN/ARCHIVED nie zwiększają także licznika oczekujących i nie blokują kompletności przez historyczny zapis faktury. Test rzeczywistej SQLite obejmuje approve 123 → revoke 0 → zmianę miesiąca/kwoty → archiwizację, zachowanie historii i nadal oczekującą zwykłą fakturę 50. Osobne SPEC i QUALITY PASS; świeże **12/12 testów modelu, strony i SQLite PASS**. Zatwierdzenie po cofnięciu nadal tworzy jeden aktywny koszt.
- Addytywna tabela obserwacji KSeF `InvoiceKsefReconciliation` przeszła SPEC i QUALITY: trwałe powiązanie z oryginalnym szkicem, wersja, snapshot i granice rozmiaru. Poprawki blokują zastępowanie rekordów również przez ukryte aliasy SQLite; `WITHOUT ROWID` ma rzeczywisty test zgodności wygenerowanego klienta Prisma. **12/12 testów migracji PASS**, także świeży łańcuch, aktualizacja wcześniejszego łańcucha i restart bez zmiany istniejącego kosztu 123 PLN. Serwis rozstrzygania i UI nie są jeszcze podłączone.
- Usunięto z synchronizacji KSeF wnioskowanie o zapłacie z braku terminu oraz fikcyjną datę zapłaty równą dacie wystawienia. Nowa faktura bez potwierdzenia otrzymuje UNKNOWN/null; synchronizacja zachowuje dotychczasowe pola płatności istniejącej faktury. Wąskie SPEC i QUALITY PASS, świeże **19/19 testów sync i ochrony starych writerów PASS** oraz typecheck. Reguły jawnych znaczników XML są przygotowywane osobno; nie wykonano automatycznej korekty danych historycznych.
- Dopasowanie KSeF i świadome rozstrzygnięcia są podłączone. Obserwacja zachowuje fakturę, koszt, klasyfikację i oryginał; zmienia wyłącznie snapshot, wersję szkicu i audyt. KEEP_LOCAL jest decyzją, a nie pozorną zgodnością; APPLY_TO_DRAFT wymaga OPEN, chroni klasyfikację i ręczne dane przed spóźnionym AI. Każda nowa różnica ponownie blokuje zatwierdzenie. Przeglądy domeny, HTTP, synchronizacji oraz list SPEC/QUALITY PASS. Rzeczywisty zakres SQLite synchronizacji: **25/25**, domena **52/52**, HTTP **4/4**, podsumowania list **6/6**; m.in. współbieżne zatwierdzenie podczas pobierania XML, rollback końcowego audytu, cache, pełne identyfikatory, odmowa po zmianie roli i brak dodatkowego kosztu.
- Ekran pokazuje zapis administratora obok różnic KSeF, status rozstrzygnięcia i instrukcję cofnięcia kosztu przed APPLY. Brak/nieaktualny odczyt blokuje zatwierdzenie, nie zapis poprawek. Po utracie odpowiedzi ponawiane jest dokładnie to samo żądanie; po drugiej utracie odświeżane są szczegół i obie listy bez deklarowania sukcesu. Oznaczenia konfliktów korzystają z rzeczywistych liczników, nie `externalId`. Oddzielne SPEC/QUALITY wszystkich wycinków PASS; **53/53 testy hooka/workspace/edytora**, panel **32/32**, inbox + bulk selection **40/40**. Usunięto wyłącznie testowe ostrzeżenia Radix przez prawidłowe oczekiwanie na otwarcie menu.
- Regresja 12 września 12:22: **2570 PASS, 2 testy opt-in pominięte**. Oba uruchomiono następnie z przypiętym CLI i wyłącznie lokalnym sztucznym dostawcą: **2/2 PASS**, bez OAuth. Aktualny `typecheck:app` i produkcyjny build **145 stron PASS**, build ID `iWG9l6LT7mMJy_v8e2dQk`. Nie jest to jeszcze końcowy odbiór paczki ani wdrożenie.
- **Odbiór KSeF UI/SQLite PASS**: zgodność → konflikt → KEEP → nowy konflikt → anulowanie/potwierdzenie zmiany zamkniętego miesiąca → revoke → APPLY → oddzielne approve. Jedna faktura, 123 VOID i jeden aktywny koszt 369 PLN, zgodny dashboard, identyczny pobrany oryginał, restart i telefon 390 px bez poziomego przepełnienia. Niezależny audyt bazy/audytów/SHA i kontrola zrzutów PASS. Nadejście KSeF zasymulowane, zero OAuth i zero prób AI. [Dokładne dowody i granice](docs/plans/2026-09-12-invoice-ksef-ui-acceptance.md).
- **Rozszerzony odbiór UI PASS**: dwie rzeczywiste karty i podwójne kliknięcie dają 200/409 oraz tylko jeden nowy koszt; przeniesienie daty wrzesień→październik wymaga zgody na oba zamknięte okresy (dashboard 0/369 PLN); przerwany rzeczywisty multipart nie zwiększa liczby szkiców/plików/zadań/kosztów, ponowienie wskazuje duplikat. Osobny odczyt SQLite/SHA/zrzutów PASS; szczegółowe granice w raporcie KSeF UI.
- **Mieszana paczka UI/OAuth PASS**, run `1789210854836-39e08cae`: 6 wejść → 4 oryginały i 4 rzeczywiste odczyty po jednej próbie, 1 duplikat, 1 uszkodzony PDF odrzucony. Dwustronicowy EUR odczytany; pusta strona i ujemna korekta nie tworzą kosztów. Ręczne potwierdzenie 430 PLN dla 100 EUR + 123 PLN daje dokładnie 2 aktywne koszty i dashboard 553 PLN. Next/bezczynny worker restart, 5 pobrań i historia zachowane. Niezależny audyt SQLite/SHA/zrzutów PASS.
- **Brak logowania i ręczna obsługa UI PASS**, run `1789210797204-965851dc`: pusty OAuth, BLOCKED/AUTH/1; ręczne zatwierdzenie jednego kosztu 123 PLN; pominięcie/archiwizacja/przywrócenie/nowy odczyt pustego dokumentu, Next-only restart i 4 pobrania. Końcowe joby AUTH/1, CANCELLED/0, QUEUED/0; worker tylko raz uruchomiony, sesja właściciela nietknięta. [Raport obu odbiorów](docs/plans/2026-09-12-invoice-batch-manual-acceptance.md).
- Regresja 12 września 13:02: **2620/2620 PASS, 253 pliki, zero pominięć**, z rzeczywistym CLI i syntetycznym dostawcą; `typecheck:app` PASS. Końcowy przegląd integracji w toku; nie jest to jeszcze zgoda na wdrożenie.
- Końcowy przegląd wykrył dwie poprawione luki: starszy formularz pozwalał powielić koszt importu, a Markdown encyklopedii mógł automatycznie pobrać adres obrazu z odpowiedzi modelu. Wspólna atomowa deduplikacja create/approve, pełny zagraniczny identyfikator i przycisk istniejącego dokumentu przeszły oddzielne SPEC/QUALITY (141/109 testów). Renderer obrazów AI zwraca wyłącznie opis tekstowy, zachowując formatowanie i jawnie klikane linki; SPEC/QUALITY i niezależne 20/20 PASS.
- Odbiór przeglądarkowy duplikatów `1789212004439-aca60623` PASS na świeżym buildzie `g1oUIEPrwMYhq9zCtnhyo`: realne POST 409/201/409, odczytowy GET po testowym 503 → realne 200, zachowany formularz, pełny DE123456789 i tylko jeden aktywny koszt 369 PLN. Druga odrębna faktura legacy 17 PLN pozostaje NEW bez kosztu. Niezależny odczyt SQLite/SHA i trzech zrzutów PASS; zero prób AI. [Dowody](docs/plans/2026-09-12-invoice-ksef-ui-acceptance.md).
- Regresja po obu poprawkach, 12 września 13:18: **2653/2653 PASS, 255 plików, zero pominięć**; `typecheck:app`, scoped ESLint wszystkich zmienionych plików, `git diff --check` i produkcyjny build **145 stron PASS**. CLI opt-in korzysta wyłącznie z lokalnego sztucznego dostawcy bez OAuth.
- Nadal wymagane: odbiór docelowego amd64/środowiska, zgoda na commit/push, backupy/migracja klonu i wdrożenie.
- Lokalny obraz amd64 `sha256:574999e9ae63b60912061fb870cb159fe923af604b47127eebc29007be2d54e9`: zgodne 14 hashy runtime, UID1000, katalogi 0700, ZERO-tools **4/4 PASS** z kompletnymi syntetycznymi żądaniami. Niezależny audyt siedmiu requestów PASS. Test blokady na ARM/emulowanym amd64 zakończył się przed snapshotem; nie zaliczono go. W odtworzeniu exit133/OOMKilled=false i błąd pliku tymczasowego `ThreadContextFcntl.cpp`; dokładna przyczyna niepotwierdzona. Własne kontenery i syntetyczne wolumeny usunięto, dowody zachowano. Nie zmieniono zabezpieczeń ani sesji właściciela.

**Przygotowanie wdrożenia, 12 września:** uzupełniono wykluczenia prywatnych danych z kontekstu Dockera oraz jawny wybór lokalnego socketu w natywnej bramce Linux. Dodano `WALLDECOR_SKIP_SEED=true` dla istniejącej prawidłowej bazy: po kopii i migracjach pomija seed odtwarzający identyfikatory checklist; świeża baza i nieprawidłowe wartości flagi są odrzucane. Pełna regresja po poprawkach: **2729/2729**, 257 plików PASS. Osobna spójna kopia produkcyjnej SQLite przeszła kontrolę integralności; nie wykonano migracji produkcji ani przełączenia czatów.

**Następny krok:** publikacja zatwierdzonego kodu, odbiór natywnego amd64, docelowego OAuth i migracji klonu, a następnie kontrolowane przełączenie produkcji. Cały plan importu nadal nie jest ukończony.

## Aktualny zakres finansowy — 10.09.2026

Gałąź `feat/finance-actuals-cash-ledger`, odizolowany checkout `walldecor-ksef`. Lokalny odbiór zakończony; 10.09.2026 właściciel zatwierdził commit i push tej gałęzi. Merge i wdrożenie nie są objęte tą zgodą. Poniższe ustalenia zastępują historyczne opisy planu sprzedaży i dashboardu M3/M4; nie zmieniają budżetów kosztowych.

- [x] Przychody: wyłącznie miesięczne rzeczywiste kwoty brutto po korektach, zastępowanie zapisu, brak/zero/ujemna korekta, opcjonalny stan na dzień, import/eksport CSV. Historyczne `RevenueBudget` zachowane; czynne endpointy planu zwracają 410 po autoryzacji.
- [x] `/` i `/dashboard`: wspólny model, wybrany miesiąc i sumy narastające, brak fallbacku do planu, kontrola kompletności i porównywalności r/r, istniejące alokacje kosztów, środki osobno od wyniku.
- [x] `/cashier` + `GET/POST /api/cashier`: ręczny start, aktualne uprawnienia, dzienne wpływy/operacje, kasa stała, policzona gotówka, zamknięcie, depozyt, odbiór i osobne przeliczenie, ograniczona audytowana korekta, historia i filtry.
- [x] Migracja addytywna `20260910070000_finance_actuals_cashier`: `Revenue.asOfDate` i pięć tabel kasy. Brak automatycznego uruchamiania salonów i przypisywania rachunków.
- [x] Lokalny odbiór: 1657/1657 testów PASS, build/TypeScript, migracje clean+upgrade, browser UI/API+role+restart, zakresowy lint i niezależny przegląd. [Raport i warunki publikacji](docs/superpowers/plans/2026-09-10-finance-cashier-acceptance.md).
- [ ] Publikacja po zgodzie właściciela, kopii SQLite i weryfikacji wdrożenia.
- [ ] Uruchomienie PUL/JAG: potwierdzone rachunki, daty i salda startowe oraz właściwe pola raportu Subiekta; nie zgadywać ani dublować istniejącej gotówki.

Kontrakt: [finanse i kasa salonu](docs/superpowers/specs/2026-09-10-finance-cashier-design.md). Etapy i dowody: [plan wykonania](docs/superpowers/plans/2026-09-10-finance-cashier-plan.md). Nowa logika: `src/lib/cashier/`, `src/lib/finance/actual-dashboard*.ts`; UI kasy: `src/components/cashier/`. Testy pełnego przebiegu: `scripts/validate-finance-cashier.mjs`; migracje: `scripts/validate-finance-migrations.mjs`.

---

## Status ogólny

```
M1  — Project Bootstrap           [x] Ukończone (2026-03-01)
M2  — Budżet: Planowanie          [x] Ukończone (2026-03-02)
M3  — Budżet: Wykonanie (+ P&L)   [x] Ukończone (2026-03-02)
M4  — Dashboard KPI + CSS         [x] Ukończone (2026-03-02)
M5  — Alerty i przypomnienia      [ ] Nie rozpoczęta  ← NASTĘPNY
M6  — HR: Pracownicy              [x] Ukończone (2026-03-28)
M7  — HR: Urlopy i nieobecności   [x] Ukończone (2026-03-28)
M8  — HR: Czas pracy              [x] Ukończone (2026-03-28)
M9  — Migracja danych             [ ] Nie rozpoczęta
M10 — Operacje / Playbook         [x] MVP start (2026-05-18)
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

### M6 — HR: Pracownicy ✅ UKOŃCZONE
```
[x] Lista pracowników per lokal (imię, stanowisko, typ umowy, status)
[x] Profil pracownika: dane osobowe + aktywna umowa (zakładki)
[x] Dodawanie / edycja / dezaktywacja pracownika (ADMIN)
[x] Struktura organizacyjna — widok drzewa działów
[x] API: GET/POST /api/hr/employees, GET/PUT/DELETE /api/hr/employees/[id]
[x] API: /api/hr/departments, /api/hr/divisions, /api/hr/positions
[x] Komponenty: employee-avatar.tsx, employee-filters.tsx, employee-select.tsx
[x] Strony: /hr/employees, /hr/employees/[id], /hr/employees/new, /hr/employees/structure
```

---

### M7 — HR: Urlopy i nieobecności ✅ UKOŃCZONE
```
[x] Formularz wniosku urlopowego (EMPLOYEE): typ, daty, note
[x] Lista wniosków z akcją zatwierdź/odrzuć (slide-in panel)
[x] Saldo urlopowe: widok per pracownik + carryover
[x] Widok kalendarza nieobecności (absence-calendar.tsx)
[x] Walidacja: wniosek nie może przekroczyć salda
[x] Typy urlopów: CRUD + kolory + kody (ADMIN)
[x] API: /api/hr/leave-requests (GET/POST + approve/reject/export/pending)
[x] API: /api/hr/leave-types (GET/POST/PUT/DELETE)
[x] API: /api/hr/leave-balances (GET/POST/PUT + carryover)
[x] API: /api/hr/leave/calendar, /api/hr/leave/summary
[x] API: /api/hr/holidays
[x] Strony: /hr/leave, /hr/leave/requests, /hr/leave/types, /hr/leave/balances, /hr/leave/approval
[x] Testy jednostkowe: 28 testów (__tests__/unit/hr/utils.test.ts)
[x] Ręczne zarządzanie saldem: przycisk "Dodaj saldo" + "Edytuj saldo" (ADMIN/MANAGER) na karcie pracownika
```

**Sesja 9 (2026-03-30) — Ręczne zarządzanie saldem urlopowym:**
- `leave-tab-client.tsx` — nowy Client Component zastępujący statyczny `LeaveTab` na karcie pracownika
- Modal obsługuje tryb `add` (typ urlopu + rok + dni) i `edit` (zmiana liczby dni)
- Obsługa błędu 409 (duplikat salda)
- Rozszerzono uprawnienia POST `/api/hr/leave-balances` i PATCH `/api/hr/leave-balances/[id]` do MANAGER
- **Fix:** `leave-requests-view.tsx` — przekazanie `isAdmin={isAdminOrManager}` do `LeaveRequestForm`; ADMIN bez rekordu pracownika widział pusty modal (brak formularza) — naprawiono

---

### M8 — HR: Czas pracy i nadgodziny ✅ UKOŃCZONE
```
[x] Rejestracja czasu pracy: clock-in / clock-out / przerwy
[x] Grafik pracy + kopiowanie szablonu grafiku
[x] Okresy rozliczeniowe: CRUD + zamykanie okresu
[x] Widok nadgodzin + wnioski nadgodzin (approve/reject)
[x] Raporty: attendance, overtime, timecard, plan-vs-actual, projects, PDF miesięczny
[x] API: /api/hr/time-tracking (GET/POST + approve/reject + bulk + weekly)
[x] API: /api/hr/time-tracking/clock-in, /clock-out, /break/start, /break/end, /current
[x] API: /api/hr/overtime-requests (GET/POST + approve/reject)
[x] API: /api/hr/billing-periods (GET/POST/PUT/DELETE + close)
[x] API: /api/hr/schedules (GET/POST + copy + template)
[x] API: /api/hr/reports (attendance/overtime/timecard/plan-vs-actual/projects/export)
[x] Strony: /hr/time-tracking, /hr/time-tracking/clock, /hr/time-tracking/schedule
[x]         /hr/time-tracking/overtime, /hr/time-tracking/periods, /hr/time-tracking/reports
[x] HR Sidebar z wszystkimi linkami (hr-sidebar.tsx)
```

**Sesja 13 (2026-07-02) — HR privacy hardening i domknięcie M6-M8:**
- Centralna polityka dostępu HR: `src/lib/hr/access.ts`.
- ADMIN widzi pełne dane HR, w tym umowy, historię wynagrodzeń i relacje poufne.
- MANAGER widzi wyłącznie pracowników, urlopy, nadgodziny, grafiki i raporty z własnego oddziału; brak podpiętego profilu pracownika nie daje fallbacku do pełnej firmy.
- EMPLOYEE widzi tylko własny profil, własne wnioski, własny czas pracy i nie ma dostępu do danych płacowych innych osób.
- Stare placeholdery `/hr`, `/hr/leaves`, `/hr/timesheets` przekierowują do aktywnych modułów.
- Ręczny flow miesięczny jest domknięty: CSV dla karty czasu, obecności, nadgodzin, plan-vs-actual, projektów oraz PDF miesięczny.
- Automatyczny cron/e-mail do kadrowej oraz sejf dokumentów pracowniczych są świadomie poza M6-M8; wymagają osobnego modelu storage, retencji i audytu dostępu.
- Testy regresyjne HR: `__tests__/unit/hr/access.test.ts`, `employees-access-route.test.ts`, `operational-access.test.ts`, `reports-access.test.ts`, `legacy-routes.test.ts`.

---

### M9 — Migracja danych historycznych
```
[ ] Parser CSV/XLSX dla danych 2025 (koszty + przychody)
[ ] Dry-run import z podglądem przed zapisem
[ ] Import wyników rocznych 2023/2024 jako agregat (YoY)
[ ] Weryfikacja: dashboard pokazuje dane historyczne poprawnie
```

---

### M10 — Operacje / Playbook ✅ MVP START
**Cel:** Delegowalne procedury i checklisty wykonania dla powtarzalnych procesów firmy. Pierwszy moduł: Finanse → Koniec miesiąca.
```
[x] Nowy dział sidebar: Operacje
[x] Strony: /operations, /operations/procedures, /operations/templates, /operations/runs
[x] Szczegół wykonania: /operations/runs/[id] — checklist + how-to split view
[x] API: GET/POST /api/operations/runs
[x] API: GET /api/operations/runs/[id]
[x] API: PATCH /api/operations/runs/[id]/items/[itemId]
[x] API: GET /api/operations/templates i /api/operations/templates/[id]
[x] Prisma: OperationArea, OperationModule, ChecklistTemplate, ChecklistTemplateItem, ChecklistRun, ChecklistRunItem
[x] Seed: Finanse → Koniec miesiąca → Księgowość - koniec miesiąca (13 zadań)
[x] Reuse Encyklopedii: Article.type=procedure + ArticleViewer dla instrukcji how-to
[x] Testy unit: operations/run-factory.test.ts
```
**Decyzja produktowa:** Encyklopedia (`/knowledge`) zostaje ogólną bazą wiedzy. Operacje są osobnym działem do wykonywalnych procedur: szablonów i konkretnych wykonań miesięcznych/procesowych.

---

### Konta użytkowników — mechanika logowania i haseł ✅ (Sesja 12 — 2026-07-01)
**Cel:** Logowanie po loginie zamiast e-maila, hasła tymczasowe przy tworzeniu/resecie konta i wymuszona zmiana hasła przy pierwszym logowaniu.
```
[x] Logowanie EMAIL → USERNAME: LoginSchema (username + password), lookup po username w src/lib/auth.ts
[x] Fallback dla starych kont: dopasowanie po znormalizowanej części lokalnej e-maila + backfill username przy pierwszym logowaniu
[x] Nowe pola User: username String? @unique, mustChangePassword Boolean @default(false), passwordChangedAt DateTime?
[x] Hasła tymczasowe: 12-znakowe, crypto.randomInt — generateTemporaryPassword (src/lib/accounts/security.ts)
[x] ADMIN tworząc konto lub resetując hasło dostaje jednorazowe hasło pokazane w UI; konto z mustChangePassword: true; API nigdy nie zwraca passwordHash
[x] Wymuszona zmiana hasła: middleware src/proxy.ts przekierowuje na /change-password (403 dla /api/*) — deny-list matcher obejmuje wszystkie trasy dashboardu
[x] (dashboard)/layout.tsx również przekierowuje przy mustChangePassword
[x] Flow zmiany hasła: strona /change-password, formularz, API /api/account/change-password (waliduje bieżące hasło, blokuje ponowne użycie, czyści mustChangePassword, ustawia passwordChangedAt)
[x] Zarządzanie kontami (ADMIN): tworzenie z hasłem tymczasowym + reset hasła w /settings/users
[x] Fix: legacy login dla e-maili z kropką (jan.kowalski@… → jankowalski) — porównanie po znormalizowanej części lokalnej e-maila
[x] Testy jednostkowe: __tests__/unit/accounts/account-security.test.ts, __tests__/unit/accounts/auth-validation.test.ts
```
**Nowe pliki:** `src/lib/accounts/policy.ts` (normalizeUsername, normalizeEmailLocalPart, isStrongPassword), `src/lib/accounts/security.ts` (generateTemporaryPassword).

**Aktualizacje:** `src/lib/validations/auth.ts` (LoginSchema, ChangePasswordSchema), `src/lib/auth.ts`, `src/proxy.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/users/[id]/reset-password/route.ts`, `src/components/settings/users-management.tsx`, `src/app/(dashboard)/settings/users/page.tsx`, `src/app/(dashboard)/layout.tsx`.

**Nowe strony/komponenty:** `src/app/(auth)/change-password/page.tsx`, `src/components/shared/change-password-form.tsx`, `src/app/api/account/change-password/route.ts`.

**Workspace/branche (praca równoległa):**
- `/Users/piotr/projekty/walldecor-app` → `feature/company-health-finance` → workspace mechaniki kont (ta sesja).
- `/Users/piotr/projekty/walldecor-app-ksef` (git worktree) → `feature/ksef-inbox` → workspace KSeF / kontrola kosztów (agent „Codex").
- Oba branche mają wspólny commit bazowy `a66ecf2` (mieszany WIP) i rozchodzą się do przodu; scalenie później.

---

## Następna sesja

**Finanse (10.09.2026):** commit/push gałęzi zatwierdzony przez właściciela. Wdrożenie i aktywacja kas to osobne kroki wymagające decyzji, kopii bazy, odczytu po migracji i potwierdzenia danych startowych. Historyczny backlog poniżej pozostaje poza tym zakresem.

### Historyczny backlog: Operacje — edytor szablonów

> Sesja 13 (2026-07-02): domknięcie HR M6-M8 po testach prywatności i dostępów.
>
> **Co jest następne (HR):**
> - Osobny moduł dokumentów pracowniczych: storage, szyfrowanie/retencja, role, audyt pobrań.
> - Automatyzacja raportów miesięcznych do kadrowej: harmonogram, odbiorcy, retry, log wysyłek.
> - Panel uprawnień do treści operacyjnych: widoczność procedur/szablonów/wykonań per użytkownik.
>
> Sesja 12 (2026-07-01): mechanika kont użytkowników (login, hasła tymczasowe, wymuszona zmiana hasła).
>
> **Co jest następne (konta):**
> - Uruchomić `npm run test:e2e` na żywo dla scenariusza wymuszonej zmiany hasła (login → redirect /change-password → zmiana → dostęp do dashboardu).
> - Później: scalić branch `feature/ksef-inbox` (workspace KSeF z worktree `walldecor-app-ksef`) do wspólnej linii.
>
> Sesja 11 (2026-05-18): dodano MVP działu Operacje / Playbook.
>
> **Co jest następne (Operacje):**
> - Edytor szablonów checklist w UI.
> - Dodawanie/edycja zadań i podpinanie procedur z Encyklopedii.
> - Przypisywanie domyślnych właścicieli zadań.
> - Filtry wykonania po module/statusie/miesiącu.
>
> Testy: `npm test` → 83 passed. Build: `npm run build` → OK.

```
1. CRUD przypomnień o płatnościach (ADMIN: nazwa, kwota, dzień miesiąca, lokal)
2. Lista nadchodzących płatności na dashboardzie (następne 14 dni)
3. Alert przekroczenia budżetu kategorii (konfigurowalny próg %)
```

---

## Kluczowe pliki projektu

### API — Finanse
| Endpoint | Metoda | Opis | Role |
|---|---|---|---|
| /api/budget | GET, POST | Plan budżetowy | GET: wszyscy; POST: ADMIN |
| /api/actuals | GET, POST | Wykonanie kosztów | ADMIN, MANAGER |
| /api/revenue | GET, POST | Przychody rzeczywiste | ADMIN, MANAGER |
| /api/revenue-budget | GET, POST | Plan przychodów | ADMIN |
| /api/subcategories | POST | Dodaj podkategorię | ADMIN, MANAGER |
| /api/subcategories/[id] | PUT, DELETE | Rename/delete podkat. | ADMIN, MANAGER |
| /api/categories/[id] | PUT, DELETE | Rename/delete kategorii | ADMIN |

### API — HR
| Endpoint | Metoda | Opis |
|---|---|---|
| /api/hr/employees | GET, POST | Lista/tworzenie pracowników |
| /api/hr/employees/[id] | GET, PUT, DELETE | Profil pracownika |
| /api/hr/departments, /divisions, /positions | GET, POST, PUT, DELETE | Struktura org |
| /api/hr/leave-requests | GET, POST | Wnioski urlopowe |
| /api/hr/leave-requests/[id]/approve | POST | Zatwierdzenie wniosku |
| /api/hr/leave-requests/[id]/reject | POST | Odrzucenie wniosku |
| /api/hr/leave-types | GET, POST, PUT, DELETE | Typy urlopów |
| /api/hr/leave-balances | GET, POST, PUT | Salda urlopowe |
| /api/hr/leave-balances/carryover | POST | Przeniesienie salda na nowy rok |
| /api/hr/leave/calendar | GET | Kalendarz nieobecności |
| /api/hr/holidays | GET, POST | Święta/dni wolne |
| /api/hr/time-tracking | GET, POST | Rejestracja czasu pracy |
| /api/hr/time-tracking/clock-in | POST | Rozpoczęcie pracy |
| /api/hr/time-tracking/clock-out | POST | Zakończenie pracy |
| /api/hr/time-tracking/break/start, /end | POST | Przerwy |
| /api/hr/time-tracking/current | GET | Bieżący wpis czasu |
| /api/hr/overtime-requests | GET, POST + approve/reject | Wnioski nadgodzin |
| /api/hr/billing-periods | GET, POST, PUT, DELETE + close | Okresy rozliczeniowe |
| /api/hr/schedules | GET, POST + copy + template | Grafiki pracy |
| /api/hr/reports/* | GET | Raporty: attendance/overtime/timecard/plan-vs-actual |

### API — Operacje
| Endpoint | Metoda | Opis | Role |
|---|---|---|---|
| /api/operations/templates | GET | Lista szablonów checklist | zalogowani |
| /api/operations/templates/[id] | GET | Szczegóły szablonu | zalogowani |
| /api/operations/runs | GET, POST | Lista wykonań / uruchomienie wykonania z szablonu | GET: zalogowani; POST: ADMIN, MANAGER |
| /api/operations/runs/[id] | GET | Szczegóły wykonania | ADMIN/MANAGER: całość; EMPLOYEE: własne zadania |
| /api/operations/runs/[id]/items/[itemId] | PATCH | Zmiana statusu/notatki zadania | ADMIN/MANAGER lub właściciel zadania |

### API — Konta użytkowników
| Endpoint | Metoda | Opis | Role |
|---|---|---|---|
| /api/users | GET, POST | Lista kont / tworzenie konta z hasłem tymczasowym | ADMIN |
| /api/users/[id] | PUT, DELETE | Edycja / blokowanie konta (nigdy nie zwraca passwordHash) | ADMIN |
| /api/users/[id]/reset-password | POST | Reset hasła → jednorazowe hasło tymczasowe + mustChangePassword | ADMIN |
| /api/account/change-password | POST | Zmiana własnego hasła (waliduje bieżące, blokuje reuse, czyści mustChangePassword) | zalogowani |

### Komponenty — Konta użytkowników
| Plik | Opis |
|---|---|
| src/lib/accounts/policy.ts | normalizeUsername, normalizeEmailLocalPart, isStrongPassword |
| src/lib/accounts/security.ts | generateTemporaryPassword (12 znaków, crypto.randomInt) |
| src/lib/auth.ts | NextAuth: logowanie po username + fallback dla starych kont |
| src/proxy.ts | Middleware: wymuszona zmiana hasła (redirect /change-password, 403 dla API) |
| src/components/settings/users-management.tsx | Zarządzanie kontami: tworzenie + reset hasła (ADMIN) |
| src/components/shared/change-password-form.tsx | Formularz zmiany hasła |

### Komponenty — Finanse
| Plik | Opis |
|---|---|
| src/components/shared/budget-grid.tsx | Siatka budżetu + zarządzanie kategoriami/podkategoriami |
| src/components/shared/actuals-grid.tsx | Siatka wykonania (plan vs real) |
| src/components/shared/revenue-plan-grid.tsx | Plan przychodów per kanał |
| src/components/shared/revenue-actuals-grid.tsx | Wykonanie przychodów |
| src/components/shared/pnl-view.tsx | P&L: KPI + wykres + tabela |
| src/components/shared/dashboard-view.tsx | Dashboard: 5x KPI + wykres + tabela CC |
| src/lib/bep.ts | calcBep() — formuła Break-Even Point |

### Komponenty — HR
| Plik | Opis |
|---|---|
| src/components/hr/hr-sidebar.tsx | Nawigacja HR z grupami (Czas pracy, Urlopy) |
| src/components/hr/employees/employee-avatar.tsx | Avatar + inicjały pracownika |
| src/components/hr/employees/employee-filters.tsx | Filtry listy pracowników |
| src/components/hr/employees/employee-select.tsx | Dropdown wyboru pracownika |
| src/components/hr/leave/approval-list.tsx | Lista wniosków + slide-in panel szczegółów |
| src/components/hr/leave/leave-balance-card.tsx | Karta salda urlopowego |
| src/components/hr/leave/leave-request-form.tsx | Formularz wniosku urlopowego |
| src/components/hr/leave/leave-requests-view.tsx | Widok listy wniosków |
| src/components/hr/leave/absence-calendar.tsx | Kalendarz nieobecności |
| src/components/hr/employees/leave-tab-client.tsx | Zakładka saldo urlopowe na karcie pracownika — dodaj/edytuj saldo (ADMIN/MANAGER) |

### Komponenty — Operacje
| Plik | Opis |
|---|---|
| src/components/operations/run-detail-client.tsx | Split view wykonania: checklist + instrukcja how-to |
| src/components/operations/runs-list.tsx | Lista wykonań z postępem i blokerami |
| src/components/operations/templates-list.tsx | Lista szablonów checklist |
| src/components/operations/start-run-button.tsx | Uruchamia wykonanie bieżącego miesiąca z szablonu |
| src/lib/operations/run-factory.ts | Tworzenie pozycji wykonania z szablonu + liczenie postępu |
| src/lib/operations/queries.ts | Query helpery dla modułów, szablonów i wykonań |

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
