# Wspólne AI — lokalna bramka Linux

Data: 2026-09-11. Checkout `walldecor-invoice-ai`, gałąź `feat/invoice-import-codex-ai`, baza `391518d`.

**Linux ARM64: mechanizmy, rzeczywisty smoke OAuth, oba czaty UI, restart i brak logowania PASS. Import faktur pozostaje otwarty.** Ten raport uzupełnia [odbiór z 10 września](2026-09-10-shared-ai-local-acceptance.md); nie zmienia historycznych wyników tego raportu. Aktualne dowody znajdują się w końcowych sekcjach. Brak wdrożenia, commitu i pusha.

## Obraz i izolacja

- Działający lokalny Docker Desktop 4.90.0, daemon 29.7.2, Linux ARM64. Instalacja i wyłączenie opcjonalnego Rosetta wykonane wcześniej na polecenie właściciela; bez resetowania wcześniejszych danych Dockera.
- Zbudowano `worker/ai/Dockerfile` dla `linux/arm64`. Obraz: `walldecor-ai-gate@sha256:b09bfaa4ea84a4905c65a950a81df6a38dd804038f3f9350ef659795427ab770`.
- Faktyczny CLI w obrazie: `codex-cli 0.153.4`; niezmieniony przypięty model `gpt-5.6-luna`, reasoning `low`.
- Inspekcja obrazu: UID/GID 1000, puste prywatne katalogi `/oauth` i `/runtime` 0700, minimalne zależności wykonawcy, bez aplikacji, klienta Prisma i danych SQLite. Hash plików granicy/runnera/entrypointu zgodny z checkoutem.
- Próby syntetyczne: sieć wyłączona, root filesystem read-only, brak capabilities, no-new-privileges; bez bazy, repo, katalogu użytkownika i Docker socket wewnątrz kontenera.

## Puste narzędzia w rzeczywistym CLI

Wynik: cztery przypadki PASS, łącznie siedem żądań do lokalnego sztucznego serwera. We wszystkich deklaracje narzędzi puste. Próba podstawowa potwierdza obraz i ścisły JSON Schema; wymuszone `exec_command`, `apply_patch` i `functions.exec` odrzucone przez niezmieniony runner. Brak poświadczeń i wywołania OpenAI.

Dowód: [summary.json](../../test-results/ai-linux-boundary-20260911-E0qR3b/summary.json).

Pierwsza próba zakończyła się `RUNNER_ERROR` przed żądaniem: Docker montuje tmpfs domyślnie jako `noexec`, a syntetyczny validator tworzy tam wykonywalny shim dostawcy. Zachowano [wynik pierwszej próby](../../test-results/ai-linux-boundary-20260911-E0qR3b/initial-summary.json). Ponowiono **wyłącznie syntetyczną walidację** z `exec` na `/runtime`; runtime produkcyjny nie został zmieniony. Tryby login/smoke/worker zachowują `noexec`. Pełne request bodies z tej próby nie są zachowane poza usuniętym kontenerem; zachowano wynik sprawdzeń, a kod walidatora poddano przeglądowi.

## Blokada sesji i SIGKILL

Uruchomiono `node scripts/validate-ai-linux-lock.mjs --image walldecor-ai-gate:20260911`. To test rzeczywistych entrypointu, `runCodexJob`, launchera npm i natywnego CLI. Specjalny supervisor oraz proces podtrzymujący przestrzeń procesów są jawnie testowe. Dostawca to wyłącznie lokalny syntetyczny serwer; `/runtime` pozostaje `noexec`.

| Próba konkurencyjnego kontenera | Poprawne dziedziczenie FD | Kontrola negatywna bez FD |
|---|---|---|
| Podczas pracy nadzorcy | 75, `AI_SESSION_IN_USE` | 75, `AI_SESSION_IN_USE` |
| Po SIGKILL tylko nadzorcy, gdy CLI nadal żyje | 75, `AI_SESSION_IN_USE` | 0 — niedozwolone wejście wykryte |
| Po naturalnym zakończeniu CLI kodem 0 | 0 — sesja dostępna | 0 |

Po SIGKILL nadzorcy PID 41 rzeczywisty launcher npm PID 104 utrzymał FD 3, a natywny CLI PID 111 nadal działał. Shim i proces PID 1 nie trzymały blokady. Inode pliku blokady w próbie pozytywnej pozostał `65025:146669`. Po zakończeniu CLI następny contender wszedł. Kontrola negatywna została odrzucona przez `REAL_CLI_LOCK_NOT_RETAINED` oraz `OVERLAPPING_SESSION_ENTERED`.

Dowody: [summary.json](../../test-results/ai-linux-lock-20260911125458-6bf842e0/summary.json), [transkrypt Dockera](../../test-results/ai-linux-lock-20260911125458-6bf842e0/docker-transcript.json), [szczegóły i ograniczenia](../../test-results/ai-linux-lock-20260911125458-6bf842e0/README.md). Ponowna ocena zapisanych przypadków bieżącym evaluator-em odtworzyła wynik. Wszystkie osiem kontenerów oraz dwa syntetyczne wolumeny usunięto po dokładnych nazwach; zachowano wyłącznie dowody i testowe pliki.

Granice dowodu:

- To odbiór mechanizmu blokady, nie całego workera HTTP/OAuth ani inferencji OpenAI.
- Sam natywny CLI nie dziedziczy FD 3; blokadę utrzymuje rzeczywisty launcher npm do zakończenia natywnego dziecka. Nie wykazano odporności na osobne zabicie launchera przy pozostawieniu jego dziecka.
- Testowy PID 1 utrzymuje potomków po SIGKILL nadzorcy. Testowy shim drenuje ich output, aby naturalnego zakończenia nie zakłócił zamknięty pipe rodzica. Nie wdrażano tych elementów do obrazu.
- Dowód dotyczy odebranego obrazu ARM64. Wersja amd64 na serwerze docelowym wymaga własnej bramki.

## Regresja i następna bramka

- `CODEX_VALIDATION_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex npm test`: **213 plików, 1852/1852 PASS**, bez pominięć; 11 września, 14:55 Europe/Warsaw.
- Sześć nowych testów evaluatora Linux, `node --check`, zakresowy ESLint i `git diff --check`: PASS.
- Pierwszy odbiór obejmował harness/testy i dokumentację bez zmiany obrazu. Późniejszą poprawkę polecenia logowania oraz ponowny odbiór obrazu opisano poniżej. Typecheck, build aplikacji i syntetyczny Playwright pozostają dowodami z 10 września.
- Dedykowany wolumen `wd-ai-oauth-piotr-local-20260911` utworzono od zera. Przed logowaniem odczyt metadanych potwierdził UID/GID 1000, 0700 i pustą zawartość. Nie kopiowano sesji desktopowej.

Następnie właściciel wykonuje oficjalne logowanie urządzenia w osobnym interaktywnym terminalu. Kod logowania nie trafia do czatu ani logów Dockera. Dopiero po logowaniu: rzeczywisty `smoke --confirm-synthetic-oauth` na fikcyjnych danych, następnie oba panele UI z rzeczywistym wykonawcą, restart i odmowa dostępu. Brak modelu/limitu/autoryzacji pozostaje jawną blokadą — bez zmiany modelu i bez płatnego fallbacku.

Pełny import faktur, paczki, przypadki finansowe, końcowy odbiór clean-DB i produkcyjne kopie/migracja/wdrożenie pozostają otwarte zgodnie z [zatwierdzonym planem](2026-09-10-invoice-import-codex-ai.md).

## Poprawka polecenia logowania i ponowny odbiór obrazu

Pierwsze oficjalne logowanie nie rozpoczęło uwierzytelnienia: CLI zwrócił exit 2, `unexpected argument '--ignore-user-config'`. Flaga jest obsługiwana dla wywołań `exec`, nie w pozycji globalnej polecenia `login`. Dodatkowy błąd lokalnego `pyenv` opóźnił start terminala; nie modyfikowano konfiguracji użytkownika.

- Dodano test pobierający rzeczywiste argumenty logowania z entrypointu i uruchamiający przypięty CLI z `--help` w pustym katalogu domowym, bez uwierzytelniania. Test najpierw odtworzył dokładnie exit 2, a po poprawce przeszedł.
- Jedyna poprawka runtime: usunięcie `--ignore-user-config` z trybu **login**. `env -i`, dedykowane prywatne HOME/OAuth, flock, wymuszone ChatGPT i magazyn plikowy pozostają. Runner/model/izolacja `exec` bez zmian. Niezależny przegląd poprawki: PASS.
- Nowy odebrany obraz: `walldecor-ai-gate@sha256:e00839406956bc1b48b76b4176161e594c0a385094c21e092176d8062ca19f67` (`linux/arm64`).
- Puste narzędzia ponownie **4/4 PASS**, siedem syntetycznych żądań, brak poświadczeń: [nowy wynik](../../test-results/ai-linux-loginfix-20260911-2ijkVe/zero-tools-summary.json).
- Blokada ponownie **PASS**, sekwencje `75 → 75 → 0` i kontrolne `75 → 0 → 0`; pozytywny inode `65025:146747`. [Nowy raport blokady](../../test-results/ai-linux-lock-20260911130552-0c5d3495/summary.json). Wszystkie własne kontenery/wolumeny testowe usunięte, sprzątanie PASS.
- Ocena zbiorcza wymaga teraz dokładnie dwóch oczekiwanych błędów kontroli negatywnej; trzy dodatkowe testy nie pozwalają zaliczyć próby przy niezwiązanej awarii inode/zwolnienia. Zapisane dowody przeszły ponowną ocenę tym kodem.
- Testy poprawki logowania, startu workera i policy: 16/16 PASS. Testy blokady: 9/9 PASS; składnia i zakresowy lint PASS. Pełny wynik 1852 opisany wyżej pochodzi sprzed dodania tych czterech testów.

Druga próba właściciela korzysta z nowego obrazu oraz tego samego dedykowanego wolumenu. Wyłączone logowanie Dockera; nie odczytujemy terminala ani pliku poświadczeń. Uruchomienie interaktywnego polecenia nie jest dowodem ukończonego OAuth.

## Przygotowanie następnego odbioru — jeszcze bez wywołań modelu

Dodano osobny `scripts/validate-ai-chat-oauth.mjs`. Nie zastępuje wcześniejszego testu z atrapą i **nie został uruchomiony**. Wymaga jawnego `--confirm-synthetic-oauth`, pełnego ID obrazu `sha256:…` oraz nazwy istniejącego wolumenu właściciela. Dopiero po zakończeniu logowania i pozytywnym trzyczęściowym smoke można nim sprawdzić rzeczywiste UI:

- Trzy zadania: finanse, artykuł, oczekujące pytanie z rzeczywistym restartem Next i workera. Weryfikacja poprawnych wartości, widocznej nowej odpowiedzi, aktualnych uprawnień oraz trwałości tych samych zadań.
- Czwarty wpis sprawdza cofnięcie roli wyłącznie fikcyjnego użytkownika: odmowa w UI i rzeczywistym claim, `ACCESS_REVOKED`, zero prób modelu. **Nie jest to cofnięcie ani dowód utraty OAuth właściciela.**
- Osobna czysta baza, losowe konta/sekrety testowe, prywatny katalog, Next tylko `127.0.0.1`. Jeśli Docker nie dosięgnie loopback przez `host.docker.internal`, skrypt kończy pracę, bez rozszerzania nasłuchu.
- Worker używa istniejącego obrazu i tej samej sesji, bez montowania bazy/repo/domu, z `/runtime` noexec oraz 30 s łagodnego zatrzymania. Sprzątanie nigdy nie usuwa wolumenu OAuth. Zwykły bridge ma ruch wychodzący — nie jest to wymuszona sieciowa lista dozwolonych adresów.
- Licznik dotyczy prób wykonania zadań kolejki, nie wewnętrznych żądań HTTP CLI. Wznowienie GET w otwartym panelu nie oznacza odtworzenia historii rozmowy po odświeżeniu strony.

Przygotowanie przeszło niezależne przeglądy zgodności i jakości oraz 37 testów pomocniczych (argumenty, granice, rzeczywiste wartości i sposób dopasowania odpowiedzi w DOM), kontrolę składni i zakresowy ESLint. Uwagę jakościową o dziedziczeniu środowiska przez Chromium usunięto przed uruchomieniem: przeglądarka otrzymuje wyłącznie stałe PATH/LANG i prywatne HOME/TMPDIR; testy potwierdzają odcięcie sekretów oraz użycie tej konfiguracji. To nie dowód przejścia całego testu UI.

**Końcowa pełna regresja po zakończeniu zmian: 215 plików, 1893/1893 PASS, bez pominięć**, 11 września 15:20 Europe/Warsaw. Uruchomiona z `CODEX_VALIDATION_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex`, czyli również z rzeczywistym CLI. Wcześniejszy przebieg w sandboxie nie przeszedł dwóch prób nasłuchu lokalnego (`listen EPERM`); ponowienie z uprawnieniem do lokalnych portów przeszło bez zmian aplikacji. Jeden pośredni przebieg pokrył się z celowym RED nowego testu formatowania; końcowy wynik pochodzi z zamrożonych plików po GREEN.

W tym momencie przygotowania nie było jeszcze prawdziwej inferencji ani odbioru OAuth. Późniejszy przebieg opisano poniżej; powyższe testy pozostają dowodami historycznymi.

## Logowanie właściciela i diagnoza rzeczywistego smoke

Właściciel ukończył trzecią próbę logowania w dedykowanym wolumenie. Potwierdzono exit 0 kontenera i oficjalne `codex login status` pod tą samą blokadą sesji: `CHATGPT_AUTHENTICATED`. Poprzednia próba wygasła po 15 minutach. Nie odczytywano poświadczeń ani kodów i nie kopiowano sesji desktopowej.

Rzeczywisty smoke na obrazie `e008…` zatrzymał się na odczycie fikcyjnej faktury z `RUNNER_ERROR`; nie wywołał następnie czatów. Jedno diagnostyczne powtórzenie, z obserwatorem ograniczonym do metadanych procesów, ustaliło:

- `--version`: exit 0, bez stderr.
- `exec`: exit 0, sekwencja `thread.started → turn.started → item.completed:agent_message → turn.completed`, bez zdarzeń narzędzi/błędów.
- Dokładnie 29 bajtów stderr, SHA-256 `3e75d28a6681c31400a3f0fcb564c7613fd42796fb83294e4d53fea86bcbd401`: hash odpowiada dokładnie stałemu komunikatowi `Reading prompt from stdin...\n`.
- Aktualny parser odrzucił ten zwykły komunikat. To ustalona przyczyna `RUNNER_ERROR`, nie błąd logowania. Poprawność pól odczytu nie została jeszcze zaliczona.
- Osobne ostrzeżenia Fontconfig pochodziły z renderowania syntetycznej ilustracji; nie przerwały generowania obrazu ani wykonania CLI. Nie uznano ich za przyczynę awarii parsera.

[Bezpieczny wynik diagnozy](../../test-results/ai-oauth-smoke-20260911-5Z5UpF/diagnostic-result.json) nie zawiera treści odpowiedzi modelu ani danych uwierzytelniających.

Dalsze śledzenie argumentów ujawniło właściwą przyczynę: wielowartościowe `--image` pochłaniało końcowe `-`, dlatego CLI odczytywał stdin jako brakujący prompt i wypisywał komunikat. Syntetyczny shim wstawiał konfigurację dostawcy przed ostatnim `-`, przypadkowo rozdzielając argumenty i maskując problem. Wycofano rozważany wyjątek parsera; stderr pozostaje ścisły. Poprawka dotyczy jawnego separatora opcji i zgodności shimów z rzeczywistą końcówką argumentów. Po RED/GREEN wymagane są nowy obraz, powtórzenie bramek oraz pełnego smoke. Model i dostawca pozostają bez zmian.

## Poprawka granicy argumentów — ponowny odbiór Linux

- Jedyna zmiana produkcyjna: końcówka argumentów `--`, `-`, także po obrazach. Model, reasoning, środowisko, wersja, katalog narzędzi i rygor stderr bez zmian.
- Oba syntetyczne shimy dodają wyłącznie konfigurację lokalnego dostawcy zaraz po sprawdzonym `exec`. Nie zmieniają już granicy między obrazem a promptem.
- Nowy obraz `sha256:e6f6e8105da3ec77bf05ccf8d48f20da36222b0e5897c86de5a8a8789099870c`, Linux ARM64, UID `node`. Zbudowany z tego samego bazowego digestu Node; nie zmieniono zależności ani entrypointu.
- Rzeczywisty Linux, sieć wyłączona: **ZERO-tools 4/4 PASS**, łącznie siedem syntetycznych żądań, obraz/ścisły JSON obecne, wszystkie próby narzędzi odrzucone. [Wynik](../../test-results/ai-linux-stdinfix-20260911-JtYSVC/zero-tools-summary.json).
- Rzeczywisty Linux/flock: **PASS**, sekwencja pozytywna `75 → 75 → 0`, kontrolna `75 → 0 → 0`. Inode pozytywny `65025:146938`; evaluator wykrył dokładnie oba oczekiwane błędy kontroli negatywnej. Sprzątnięto wyłącznie własne syntetyczne kontenery i dwa wolumeny. [Dowody](../../test-results/ai-linux-lock-20260911140042-add15b88/summary.json).
- Pełna regresja po poprawce: **215 plików, 1896/1896 PASS**, bez pominięć, 11 września 15:59 Europe/Warsaw; rzeczywisty CLI jawnie włączony przez `CODEX_VALIDATION_BINARY`. Późniejsze doprecyzowanie testów odbioru będzie odnotowane oddzielnie.
- Bieżący `npm run typecheck:app` oraz produkcyjny `npm run build`: PASS, 143 strony. Składnia skryptów i `git diff --check`: PASS.
- Doprecyzowano regresję dla 0/1/2 obrazów oraz odrzucania dokładnego komunikatu stdin. Końcowe **1897/1897 PASS**, 215 plików, bez pominięć, 16:05 Europe/Warsaw. Osobny strict typecheck skryptów worker/smoke/validator również PASS.
- Zapisana rzeczywista próba macOS RED/GREEN została odczytana przez wykonawcę, głównego agenta i niezależnego recenzenta: brak separatora odtwarza znany stderr i `RUNNER_ERROR`; dodanie separatora usuwa stderr i daje `SUCCEEDED`. [Zwięzły dowód i ścieżki oryginałów](../../test-results/ai-linux-stdinfix-20260911-JtYSVC/red-green.json).

## Rzeczywisty trzyczęściowy smoke OAuth — PASS z ograniczeniem dokładności

Na obrazie `e6f6…` pierwszy odczyt zwrócił wynik zgodny z produkcyjnym schematem, lecz niezgodny z jedną lub więcej oczekiwanymi wartościami fikcyjnej faktury (`VALUE_MISMATCH`). Nie zachowano surowej odpowiedzi. [Wynik tej próby](../../test-results/ai-linux-stdinfix-20260911-JtYSVC/oauth-smoke-initial-result.json).

Powtórzenie z obserwatorem porównującym wyłącznie stałe pola testowe przeszło **3/3 PASS**: wszystkie 12 pól faktury, sześć wartości finansowych (w tym brak jako null i niekompletność), trzy fakty z artykułu. Wszystkie wywołania CLI zakończyły się exit 0, bez stderr ani zdarzeń narzędzi. Obserwator działał tylko w procesie rodzica, bez zmiany argumentów/środowiska/promptu; CLI nie dziedziczy `NODE_OPTIONS`. [Wynik](../../test-results/ai-linux-stdinfix-20260911-JtYSVC/oauth-smoke-pass.json).

To potwierdza rzeczywisty odczyt i odpowiedzi przypiętego `gpt-5.6-luna/low` przez dedykowany OAuth właściciela. **Nie dowodzi deterministycznej dokładności OCR**: wcześniejszej niezgodności nie odtworzono, a jej pole pozostaje nieznane. Wymóg ręcznego sprawdzenia faktury przed kosztem pozostaje bez zmian. Nie zmieniono oczekiwanych wartości, promptu, schematu ani dostawcy, aby zaliczyć test.

## Pierwsza próba rzeczywistego UI

Uruchomiono przygotowany harness na nowej syntetycznej SQLite i aktualnym produkcyjnym buildzie. Migracje i połączenie Dockera z Next nasłuchującym **wyłącznie 127.0.0.1** przeszły. Próba zatrzymała się w `AUTHORIZATION_UI`, przed utworzeniem jakiegokolwiek zadania i przed startem wykonawcy. Kontenery, przeglądarka i serwer zamknięte; wolumen właściciela zachowany. [Raport](../../test-results/ai-chat-oauth-1789135869594-9668a612/report.json).

Odrębna próba pustej przeglądarki z tym samym ograniczonym środowiskiem przeszła. Odczyt bazy i kodu logowania wykazał błąd fikcyjnych danych: harness zapisał loginy z myślnikami, natomiast produkcyjne `normalizeUsername` usuwa znaki niealfanumeryczne przed lookup. Poprawka obejmuje wyłącznie tworzenie kont testowych, bez zmiany autoryzacji aplikacji. Odbiór UI/restart/brak autoryzacji nadal otwarty.

## Diagnoza harnessu rzeczywistego UI

Poprawka loginów przeszła RED/GREEN, niezależne przeglądy i 47 testów pomocniczych. Kolejne dwie próby dotarły do rzeczywistego pytania finansowego; za każdym razem zadanie zakończyło się `SUCCEEDED` po jednej próbie, lecz sam harness przerwał się w `REAL_FINANCE_UI`. Nie uznano tego za odbiór panelu. [Pierwszy raport](../../test-results/ai-chat-oauth-1789136279610-62f71cf1/report.json), [powtórzenie diagnostyczne](../../test-results/ai-chat-oauth-1789136822887-1eef2c5e/report.json).

Prywatny obserwator przeglądarki odczytał wyłącznie własne cztery strony syntetyczne przed ich zamknięciem. W chwili przerwania panel nadal pokazywał oczekiwanie; harness **nie doszedł do sprawdzenia tekstu odpowiedzi**. Odrębny test DOM potwierdził, że dopasowanie rzeczywistej zapisanej odpowiedzi działa w odtworzonym rendererze. Śledzenie kodu ustaliło przyczynę: zwykły Node ładuje produkcyjny plik TypeScript przez `tsImport` jako moduł CommonJS pod `default`, a harness pobierał nieistniejący eksport nazwany `aiChatResultSchema`. Rzeczywisty probe zwrócił `namedSchemaType: undefined` i prawidłowy schemat w `default`; wywołanie `.safeParse` przerywało test przed asercjami UI. To błąd narzędzia odbioru, nie dowód awarii panelu ani potrzeba zmiany modelu.

Obie próby posprzątały własne kontenery, Next i przeglądarkę; wolumen OAuth zachowany. Przygotowany osobno test braku uwierzytelnienia używa pustego tymczasowego `/oauth`, bez montowania ani zmiany sesji właściciela. Nie jest testem zdalnego cofnięcia OAuth w trakcie inferencji.

Poprawka importu schematu przeszła RED/GREEN, 48 testów pomocniczych oraz niezależne przeglądy. Zwykły proces Node ładuje prawdziwy schemat produkcyjny, przyjmuje poprawną odpowiedź i odrzuca liczbę/puste/obce pola. Kolejny rzeczywisty przebieg zaliczył **finanse: schemat, wszystkie oczekiwane wartości i widoczna odpowiedź**. Zatrzymał się przed pytaniem encyklopedii: fixture powtarza tytuł jako nagłówek H1 w treści, więc selektor testu trafia w dwa nagłówki. Lokalny probe na zachowanej syntetycznej bazie potwierdził dwa nagłówki, jeden działający przycisk asystenta i jedno pole pytania; bez nowego zadania/modelu. [Raport](../../test-results/ai-chat-oauth-1789137102830-b21d2a83/report.json), [probe UI](../../test-results/ai-chat-oauth-1789137102830-b21d2a83/wiki-ui-probe.json). Zmiana ma dotyczyć wyłącznie fixture, nie osłabienia asercji.

## Rzeczywisty brak uwierzytelnienia — PASS

Uruchomiono `scripts/validate-ai-auth-loss.mjs --confirm-missing-auth --image sha256:e6f6e8105da3ec77bf05ccf8d48f20da36222b0e5897c86de5a8a8789099870c`. Osobna zmigrowana baza, dwa fikcyjne konta ADMIN i pusty jednorazowy tmpfs `/oauth`; **bez montowania, odczytu ani zmiany sesji właściciela**. Kod po niezależnych przeglądach i 40 testach helperów.

- Dwa pytania dodane przez rzeczywisty interfejs, gdy wykonawca był zatrzymany. Rzeczywisty CLI bez autoryzacji spowodował `BLOCKED/AUTH`, jedna próba. Wykonawcę zatrzymano po zakończeniu pierwszego zadania; drugie pozostało `QUEUED`, zero prób, kolejka wstrzymana `AUTH`.
- Widoczne prawdziwe komunikaty o braku logowania i wstrzymaniu kolejki oraz przyciski ponowienia. Nie klikano ponowienia bez przywróconej autoryzacji.
- Restart Next i tego samego kontenera wykonawcy zachował oba zadania i blokadę. Aktualizacja dzierżawy dowodzi rzeczywistego ponownego sprawdzenia kolejki. Pełne odpowiedzi autoryzowanych GET przed/po restarcie zgodne; `private, no-store`; drugi właściciel nadal otrzymuje 404.
- Jedna próba wykonania łącznie, bez wyników i aktywnych dzierżaw; zero faktur i kosztów. SQLite integrity `ok`, brak naruszeń FK. Niezależny od harnessu odczyt SQLite potwierdził te skutki.
- Własny kontener, Next, przeglądarka i klient bazy zamknięte; syntetyczną bazę/dowody zachowano. [Raport i zrzuty](../../test-results/ai-auth-loss-1789137305053-ae560348/report.json).

Granice: brak logowania przy starcie, nie zdalne cofnięcie poświadczeń w trakcie wywołania ani ich późniejsze przywrócenie. Istniejące panele zachowały komunikaty; nie deklarujemy ich odtworzenia po przeładowaniu strony. Licznik dotyczy prób zadań, nie wewnętrznych żądań HTTP dostawcy. Cały pozytywny test encyklopedii/restartu pozostaje otwarty do naprawy fixture.

## Oba rzeczywiste czaty, restart i uprawnienia — PASS

Po minimalnej poprawce treści fikcyjnego artykułu (bez drugiego nagłówka H1; wszystkie fakty zachowane) oraz RED/GREEN i obu przeglądach uruchomiono ponownie nieinstrumentowany `scripts/validate-ai-chat-oauth.mjs`. Obraz i dedykowany wolumen bez zmian, nowa czysta zmigrowana SQLite, niezmieniony produkcyjny build `PPspZZxD09aUm6nQk2R0y`.

- **Finanse:** prawdziwe UI → 202 → kolejka → rzeczywisty OAuth → `SUCCEEDED` → widoczna odpowiedź. Wszystkie dziesięć oczekiwanych wartości potwierdzone, w tym 12 345 PLN, koszty niepotwierdzone, niekompletność, brak kanału jako null i brak porównania r/r.
- **Encyklopedia:** panel uprawnionego menedżera wyświetlił rzeczywiste `TEST-ALFA`, siedem minut i nieznany kolor jako null. Pracownik nie otrzymał dostępu do asystenta.
- **Restart:** następne pytanie zapisano przed zatrzymaniem Next; otwarty panel zauważył rzeczywistą awarię GET. Po restarcie Next i wykonawcy administrator testu kliknął `Sprawdź ponownie` w panelu menedżera. Ten sam identyfikator zadania uzyskał wynik i **nową widoczną odpowiedź**, mimo identycznej treści jak poprzednia. Poprzednie wyniki zachowane. Bez retry POST i bez deklaracji odtwarzania historii po reload.
- **Utrata roli:** czwarty wpis fikcyjnego menedżera, po cofnięciu roli w aplikacji, zakończył się `ACCESS_REVOKED` przy rzeczywistym claim, zero prób modelu, brak wyniku i widoczna odmowa. To nie jest odebranie OAuth właściciela.
- Łącznie trzy próby inferencji, każda zakończona sukcesem za pierwszym razem. Zero faktur i kosztów z pytań, przychód testowy niezmieniony. SQLite integrity `ok`, FK 0. Główny agent niezależnie odczytał końcowe statusy i liczby z SQLite oraz obejrzał zrzuty paneli.
- Sprzątanie własnego kontenera, Next, przeglądarki i klienta bazy PASS. Sesja właściciela zachowana. [Raport, identyfikatory i zrzuty](../../test-results/ai-chat-oauth-1789137521425-bf9640b9/report.json).

Pełna regresja końcowych plików: **216 plików, 1949/1949 PASS, zero pominięć**, 11 września 16:38 Europe/Warsaw, z `CODEX_VALIDATION_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex`. Skupione testy dwóch harnessów: 89/89 PASS. Bieżący typecheck aplikacji i produkcyjny build **PASS, 143 strony**. Pierwszy ponowny build w sandboxie utknął na kompilacji bez postępu; zatrzymano wyłącznie jego zweryfikowany proces i powtórzono bez zmian kodu poza ograniczeniem środowiska. Powtórzenie skompilowało się w 4,7 s i zakończyło exit 0. Wcześniejszy produkcyjny build tego samego kodu aplikacji został wykorzystany w obu testach UI.

Ten odbiór otwiera etap pełnego importu jednej faktury. Nie oznacza implementacji importu, odbioru docelowego amd64, produkcyjnego logowania ani wdrożenia.
