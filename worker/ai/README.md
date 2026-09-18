# Prywatny wykonawca AI — bramki uruchomienia

Status: **lokalny Linux ARM64, blokada sesji, smoke OAuth, oba rzeczywiste czaty UI, restart i brak logowania PASS**, 2026-09-11. [Dowody i ograniczenia](../../docs/plans/2026-09-11-shared-ai-linux-acceptance.md).
Nie wdrożono. Właściciel ukończył logowanie; przypięty model zwrócił zwalidowane dane fikcyjnej faktury oraz obu kontekstów czatu. Jedna wcześniejsza próba miała nieodtworzone `VALUE_MISMATCH` — to nie certyfikacja dokładności OCR. Test braku logowania użył pustego tmpfs, bez cofania sesji właściciela. Restart czatów dotyczył otwartego panelu i tych samych trwałych zadań, nie odtwarzania historii po reload. Zaktualizowany obraz importu Linux ARM64 `sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab` przeszedł izolację i [pełny rzeczywisty przebieg jednej faktury UI/OAuth](../../docs/plans/2026-09-11-invoice-single-oauth-acceptance.md), wraz z pobraniem oryginału i restartem. Następnie [mieszana paczka/PDF oraz ręczna obsługa po AUTH](../../docs/plans/2026-09-12-invoice-batch-manual-acceptance.md) przeszły odbiór 12 września: 4 rzeczywiste odczyty, dwa koszty 123+430=553 PLN, identyczne pobrania i trwałość po restartach. Obraz i środowisko docelowe amd64 wymagają osobnego odbioru.
Nie przełączać produkcyjnych czatów przed odbiorem docelowego środowiska, kopią/migracją klonu oraz zgodą na publikację.

Aktualizacja 12 września: [końcowy odbiór lokalny](../../docs/plans/2026-09-12-invoice-final-local-acceptance.md) aplikacji PASS, 2653 testy i świeży build. Lokalny obraz amd64 `sha256:574999e9ae63b60912061fb870cb159fe923af604b47127eebc29007be2d54e9` przeszedł ZERO-tools, lecz test blokady w środowisku ARM/emulowanym amd64 zatrzymał się przed oceną mechanizmu. **Nie jest odebrany do produkcji.** Potrzebna natywna bramka amd64 i dedykowane logowanie w środowisku docelowym; nie kopiować lokalnego OAuth.

## Zakres i granice

- Codex CLI `0.153.4`, model `gpt-5.6-luna`, reasoning `low`. Brak parametrów zmiany dostawcy/modelu i brak płatnego fallbacku.
- W obrazie są tylko pliki wykonawcy, przypięty katalog modelu i minimalne zależności. Brak kodu aplikacji, klienta bazy, danych SQLite, publicznego portu czy dostępu do Docker socket.
- Kontener działa jako UID/GID 1000. `/oauth` to osobny prywatny trwały wolumen tego właściciela; `/runtime` to prywatne dane tymczasowe. Nie montować repozytorium, katalogu domowego, plików `.env`, bazy ani wolumenu aplikacji.
- Proces Codexa dostaje jawnie ograniczone środowisko bez klucza kolejki. Oryginał jest pobierany wyłącznie przez aktualny lease i renderowany w prywatnym `/runtime/documents`; do Codexa trafiają tylko zwalidowane obrazy. Każde zadanie ma pusty katalog roboczy, osobny stan i zwalidowane obrazy; po zamknięciu procesu jego katalogi tymczasowe są usuwane. Dokumenty są niezaufanymi danymi.
- Deklaracje narzędzi muszą być puste w każdym żądaniu. Nie wystarczy `read-only`: katalog usuwa również narzędzia patchowania; próba narzędzia, nieznane zdarzenie lub stderr kończą zadanie błędem.
- `AUTH`, `QUOTA`, `MODEL_UNAVAILABLE` wstrzymują wspólną kolejkę. Sam restart nie omija pauzy. Po naprawie administrator/właściciel uprawnionego zadania wybiera „Ponów zadanie”.
- Wszystkie tryby używające sesji blokują `/oauth/.session.lock`. Nie usuwać ani nie podmieniać tego pliku. Wykonawca zatrzymuje FD 9, rzeczywisty launcher npm Codexa dziedziczy tę samą blokadę jako FD 3 i trzyma ją do zamknięcia natywnego dziecka. Linux/SIGKILL nadzorcy potwierdzony; nie dowiedziono ochrony po osobnym zabiciu launchera z pozostawieniem natywnego CLI.

Consumer obsługuje oba czaty i odczyt faktury. Zadanie faktury pobiera wyłącznie oryginał przypisany do aktualnego joba i lease, sprawdza limit, MIME, długość oraz SHA-256, renderuje PDF przez przypięte binaria Popplera i czeka na pełne zakończenie Codexa przed sprzątaniem. Uruchomienie produkcyjne nadal wymaga odbioru docelowego obrazu i środowiska.

## Przygotowane polecenia lokalnej bramki Linux

Poniższe polecenia są instrukcją odbioru, nie dowodem, że zostały wykonane. Wymagają działającego Dockera. Uruchamiać z katalogu głównego tego checkoutu.

```sh
docker build -f worker/ai/Dockerfile -t walldecor-ai-gate:local .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /runtime:rw,exec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=256m \
  --memory 512m --pids-limit 128 walldecor-ai-gate:local validate
```

`validate` to jedyny tryb domyślny. Używa lokalnego sztucznego serwera i pustego katalogu OAuth; niczego nie wysyła do OpenAI. Sprawdza przypięty model, obraz, JSON Schema i wymuszone `exec_command`, `apply_patch`, `functions.exec`. Przed uruchomieniem sesji wymagane `passed: true` dla wszystkich przypadków w rzeczywistym obrazie Linux.

Opcja `exec` dotyczy **wyłącznie syntetycznego testu `validate`**: test tworzy w `/runtime` skrypt przekierowujący CLI do lokalnego sztucznego serwera. Docker domyślnie montuje tmpfs z `noexec`, co zatrzymuje ten skrypt przed uruchomieniem CLI. W trybach `login`, `smoke` i `worker` zachować `noexec`; wykonują one zainstalowany CLI z niezmiennego obrazu, bez testowego przekierowania dostawcy. Nie zmieniać ustawień produkcji, aby uruchomić atrapę modelu.

Osobno sprawdzić współbieżność dwóch kontenerów korzystających z jednego syntetycznego wolumenu oraz zabicie samego procesu nadzorcy podczas odczytu: drugi wykonawca nie może rozpocząć pracy przed zamknięciem potomnego CLI. Nigdy nie wykonywać tej próby na aktywnej sesji produkcyjnej.

Powtarzalna próba tej granicy: `node scripts/validate-ai-linux-lock.mjs --image walldecor-ai-gate:local`. Domyślnie korzysta z lokalnego Docker Desktop. Na natywnym hoście Linux amd64 uruchomić `node scripts/validate-ai-linux-lock.mjs --image sha256:<pełne-ID-odebranego-obrazu> --docker-host unix:///var/run/docker.sock`; obraz musi już istnieć na tym hoście. Socket udostępnia wyłącznie gospodarz skryptowi odbioru, nie montować go do workera. Test używa nowych syntetycznych wolumenów i testowego nadzorcy/PID 1, nie loguje się i nie wywołuje OpenAI. Wymaga PASS próby pozytywnej oraz wykrycia kontroli negatywnej.

## Logowanie i rzeczywisty test — wyłącznie właściciel

Po pozytywnym odbiorze Linuksa utworzyć dedykowany prywatny wolumen OAuth. Właściciel uruchamia obraz w trybie `login` w interaktywnym terminalu z tym wolumenem zamontowanym jako `/oauth` i wykonuje logowanie urządzenia pokazywane przez oficjalny CLI. Nie kopiować sesji desktopowej, nie wyświetlać pliku poświadczeń i nie zapisywać kodu logowania w raporcie.

Następnie, z **tym samym wolumenem**, uruchomić `smoke --confirm-synthetic-oauth`. Tryb jawnie wykonuje trzy kolejne wywołania: odczyt fikcyjnej faktury PNG, pytanie finansowe i pytanie o przygotowany artykuł. Zapisuje tylko kontrolowane wyniki sprawdzeń, bez tokenów i surowych odpowiedzi. Wynik `MODEL_UNAVAILABLE` jest blokadą do decyzji właściciela; nie zmieniać modelu samoczynnie.

To test runtime, a nie pełny import faktur. Rzeczywiste UI obu czatów należy następnie sprawdzić z tym samym wykonawcą, wraz z restartem i utratą dostępu. Testy z atrapą modelu sprawdzają transport i błędy, lecz nie zastępują tego kroku.

Osobny harness UI: `node scripts/validate-ai-chat-oauth.mjs --confirm-synthetic-oauth --image sha256:<pełne-ID-odebranego-obrazu> --oauth-volume <istniejący-dedykowany-wolumen>`. Używa nowej syntetycznej SQLite i rzeczywistego workera, planuje trzy zadania modelu i osobne cofnięcie roli fikcyjnego użytkownika bez inferencji. Nie loguje się, nie czyta poświadczeń i nie usuwa wolumenu OAuth. Najpierw muszą przejść logowanie i smoke; nie uruchamiać równocześnie. Cofnięcie roli aplikacyjnej nie jest testem odwołania OAuth. Aktualne wyniki prób i ich ograniczenia są w raporcie odbioru.

Osobny test rzeczywistego braku logowania: `node scripts/validate-ai-auth-loss.mjs --confirm-missing-auth --image sha256:<pełne-ID-odebranego-obrazu>`. Nie przyjmuje wolumenu właściciela: montuje pusty, jednorazowy `/oauth` i sprawdza `AUTH`, wstrzymanie drugiego zadania bez próby, widoczne komunikaty oraz trwałość blokady po restarcie. Nie testuje zdalnego cofnięcia sesji w trakcie inferencji ani późniejszego przywrócenia poświadczeń.

## Konfiguracja docelowa w Coolify

1. Osobna prywatna aplikacja/worker, jedna replika, bez domeny i otwartych portów. Zbudowany i odebrany obraz przypiąć do digestu. Nie ustawiać automatycznych aktualizacji CLI/katalogu.
2. Wspólny z aplikacją sekret `AI_WORKER_SECRET` (losowy, minimum 32 znaki ASCII), wyłącznie w prywatnych zmiennych środowiska. `AI_WORKER_URL` wskazuje dokładny wewnętrzny adres `/api/internal/ai-worker`, bez przekierowań, query i fragmentu. Klucz nie upoważnia do dowolnych zapytań ani plików.
3. Trwały prywatny `/oauth`, właściciel UID/GID 1000 i uprawnienia `0700`; tylko ten wykonawca i ręczny tryb logowania mogą korzystać z wolumenu. Nowy wolumen dziedziczy te ustawienia z obrazu; dla istniejącego montowania potwierdzić je osobno. `/runtime` jako ograniczony tmpfs z UID/GID 1000 i `0700`. Ograniczyć pamięć/liczbę procesów; brak uprawnień roota, dodatkowych capabilities i hostowych montowań.
4. Przed migracją aplikacji: kopia SQLite i prywatnych plików, migracja klonu, kontrola integralności i zachowania danych. Trzy migracje `20260910180000_shared_ai_queue`, `20260911150000_invoice_import_drafts` i `20260911190000_invoice_ksef_reconciliation` są addytywne. Używać istniejącego bezpiecznego `migrate deploy`, nie `db push`/reset. Aplikacja wymaga prywatnych trwałych katalogów `INVOICE_ORIGINALS_DIR` i `INVOICE_PROCESSING_DIR`; Poppler jest dołączony do obrazu aplikacji.
   Dla tego wdrożenia na istniejącej bazie ustawić w aplikacji `WALLDECOR_SKIP_SEED=true`: bieżący seed odtwarza elementy szablonów checklist z nowymi identyfikatorami, więc jego pominięcie chroni historyczne odwołania. Flaga pomija wyłącznie seed po udanej kopii i `migrate deploy`; wymaga niepustej bazy z poprawną historią migracji, bez nierozwiązanej nieudanej migracji. Brak flagi lub `false` zachowuje dotychczasowe obowiązkowe seedowanie; pusta lub inna wartość zatrzymuje start przed zmianami. Nie używać `true` do świeżej instalacji. Kontrola integralności i zachowania danych na klonie nadal obowiązuje.
5. Dopiero po wszystkich bramkach i zgodzie na publikację: polecenie `worker`, `AI_WORKER_ENABLED=true`. Zamknięcie procesu musi czekać na zakończenie/ubicie CLI; zapewnić przynajmniej 30 s łagodnego zatrzymania. Nie wymuszać równoległego uruchomienia podczas logowania.
6. Sprawdzić odpowiedź przez rzeczywisty panel administratora i encyklopedię menedżera; odczytać stan zadania po restarcie. Przy braku dowodu nie ogłaszać wdrożenia ukończonym.

Oficjalne podstawy: [prywatna automatyzacja z logowaniem ChatGPT](https://learn.chatgpt.com/docs/auth/ci-cd-auth), [modele Codex](https://learn.chatgpt.com/docs/models).
