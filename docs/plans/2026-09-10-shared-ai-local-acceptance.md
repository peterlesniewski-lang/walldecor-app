# Wspólne AI — lokalny odbiór części implementacji

Data: 2026-09-10. Checkout `walldecor-invoice-ai`, gałąź `feat/invoice-import-codex-ai`, baza `391518d`.

**Cały plan NIE jest ukończony.** Zaimplementowano i sprawdzono lokalny mechanizm kolejki, transport, oba czaty oraz przygotowany runtime. Nie ma jeszcze odbioru Linux/OAuth, przepływu importu faktury ani wdrożenia. Nie wykonano commitu/pusha, nie zmieniano produkcji, nie kopiowano sesji właściciela.

## Zaimplementowany zakres

- Wspólny loader rzeczywistych danych finansowych dashboardu i czatu; jawna projekcja agregatów, dat pokrycia, null/zero i kompletności, bez dostawców oraz sald/kursów pobieranych do innych części dashboardu.
- Addytywna migracja `20260910180000_shared_ai_queue`: trwałe `AiJob` i `AiQueueLease`, priorytet czatów, jedna aktywna praca w bazie, właściciel, idempotencja, blokada AUTH/QUOTA/MODEL_UNAVAILABLE i kontrolowane ponowienie. Ocena terminu następuje po uzyskaniu blokady zapisu SQLite, więc czekający stary wykonawca nie odnawia wygasłego zadania.
- Asynchroniczne API obu czatów, GET i retry wyłącznie dla uprawnionego właściciela, aktualna rola/aktywność konta. ADMIN korzysta z finansów; ADMIN/MANAGER z encyklopedii.
- Panele z kolejką, odpowiedzią, kontrolowanymi błędami i odzyskaniem niepewnego żądania bez drugiego zadania. Finansowy widget nie zasłania asystenta w encyklopedii; oba panele mieszczą się na wąskich ekranach.
- Wąski protokół wykonawcy HTTP: klucz tylko po stronie serwera, brak przekierowań, ograniczone dane wejściowe/odpowiedzi, heartbeat i potwierdzanie zadania. Wykonawca czeka na rzeczywiste zakończenie procesu także po utracie prawa do zadania; nie powtarza inferencji samodzielnie po niepewnym `finish`.
- Przypięty CLI `0.153.4` i `gpt-5.6-luna/low`, katalog bez narzędzi, osobny pusty katalog na zadanie, ograniczone środowisko i niezależna walidacja JSON. Brak Anthropic oraz płatnego fallbacku. Oficjalny CLI ma sam zarządzać dedykowanym OAuth.
- Przygotowany minimalny obraz nonroot i tryby `validate`, `login`, `smoke`, `worker`. Domyślnie wyłącznie walidacja syntetyczna. Sesja współdzieli systemowy `flock`; FD jest przekazywany potomkowi. Dowód skuteczności tej blokady na Linuksie nadal pozostaje otwarty.
- Konto z historią AI nie jest usuwane: kontrolowany 409 i wskazanie blokady konta. Także rzeczywisty wyścig enqueue/DELETE zachowuje historię. Dezaktywacja oraz usuwanie konta bez historii działają jak dotąd.

## Dowody wykonane lokalnie

| Bramka | Wynik i granica dowodu |
|---|---|
| Czyste zależności | `npm ci --ignore-scripts --no-audit --no-fund --offline` PASS; 851 pakietów. Ponowne `prisma generate` PASS. `npm ls` potwierdza `sharp@0.34.5`, bez Anthropic. |
| Pełny zestaw testów | `CODEX_VALIDATION_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex npm test`: **212 plików, 1846/1846 PASS**, bez pominięć; ostatni przebieg 19:38–19:39 Europe/Warsaw. |
| TypeScript | `npm run typecheck:app` PASS oraz osobny strict typecheck samodzielnych skryptów worker/validator/smoke. |
| Build | `npm run build` PASS po ostatniej zmianie endpointu użytkowników, 143 generowane strony. Kompilacja wykonana poza sandboxem po zdiagnozowaniu lokalnego zawieszenia procesu kompilatora; kod nie był zmieniany w celu obchodzenia błędów buildu. |
| Lint i spójność diffu | Zakresowy ESLint wszystkich nowych/zmienionych plików AI/API/UI/testów i `git diff --check`: PASS. Nie jest to deklaracja czystości lint całego historycznego repozytorium. |
| Rzeczywisty CLI na macOS | Cztery próby przeciw lokalnemu sztucznemu serwerowi: PNG + JSON Schema, puste narzędzia we wszystkich żądaniach; wymuszone exec_command/apply_patch/functions.exec odrzucone. Pusty katalog OAuth, bez poświadczeń i bez wysłania dokumentu do OpenAI. |
| Błąd limitu CLI | Przypięty CLI rzeczywiście zwrócił exit 1, pusty stderr i JSONL z HTTP 429; po poprawce wynik jest QUOTA, nie RUNNER_ERROR. Testy obejmują także AUTH i MODEL_UNAVAILABLE. |
| SQLite i HTTP | Rzeczywiste migracje, kilku klientów SQLite, HTTP handler/transport/consumer, priorytet, globalna pauza, retry, właściciel, wyścigi i spóźnione odpowiedzi. Modelem w testach jest jawna atrapa. |
| Interfejs Playwright | Produkcyjny Next w odizolowanym katalogu/bazie: oba czaty przez UI → HTTP → kolejkę → protokół worker HTTP → widoczną odpowiedź; QUOTA, osobne oczekujące zadanie, retry tego samego ID, role i obcy właściciel. Jedynie wynik modelu jest podstawiany. |
| Mobilność | 9 PNG: desktop, 390×844 i 320×568. Końcowy przebieg bez uciętych paneli i błędów strony. Wykryty wcześniej rzeczywisty błąd panelu wiki `x=-18` został poprawiony i ponownie sprawdzony. |
| Restart Next | Dwa rzeczywiste restarty procesu serwera, API readback wyników i oczekującego zadania, następnie zakończenie tego zadania i ponowny odczyt. Strony są zamknięte przed restartami: to dowód trwałości, nie odporności otwartego czatu na awarię ani restartu workera OAuth. |
| Niezależny przegląd | Poszczególne bloki, runtime, transport, smoke, UI, harness oraz zabezpieczenie DELETE: bez pozostałych uwag blokujących w przejrzanym lokalnym zakresie. |

Raport przeglądarkowy: [`report.json`](../../test-results/ai-chat-2026-09-10T17-36-07-146Z/report.json). W tym katalogu są screenshoty i log serwera, wyłącznie z syntetycznymi danymi. Wcześniejszy eksperyment z otwartą stroną podczas wyłączenia Next zgłosił `Failed to fetch`; nie jest traktowany jako pozytywny dowód odporności aktywnej rozmowy.

Bezpośredni odczyt zachowanej syntetycznej bazy `/var/folders/7f/x06rxsrd6090fqsnn44dxvxm0000gn/T/wd-ai-browser-XLO7Cx/browser.sqlite`:

- FINANCE_CHAT: 2 SUCCEEDED; WIKI_CHAT: 3 SUCCEEDED.
- `KsefInvoice`: 0; `CostEvent`: 0; jedyny przygotowany `Revenue.amount`: 12345, bez zmiany.
- `PRAGMA integrity_check`: `ok`; `foreign_key_check`: brak naruszeń.

## Otwarte bramki — następny krok wymaga udziału właściciela

1. Uruchomić działające środowisko Docker/Linux. Lokalny `docker info` nadal zwraca brak połączenia z daemonem. Nie wykonywano resetu ani reinstalacji Dockera.
2. Zbudować rzeczywisty obraz i powtórzyć dowód pustych narzędzi. Sprawdzić współdzielony flock między dwoma kontenerami oraz po SIGKILL nadzorcy, przez faktyczny zainstalowany launcher CLI.
3. Właściciel loguje się do osobnego prywatnego runtime. Bez kopiowania lokalnej sesji, odczytywania tokenów czy publicznego CI.
4. Wykonać prawdziwy `smoke --confirm-synthetic-oauth`: faktura syntetyczna + oba konteksty, dokładnie Luna/low. Następnie oba panele z rzeczywistym wykonawcą, restart i utrata dostępu. Żaden dotychczasowy mock nie zastępuje tych prób.
5. Dopiero po tej bramce przejść do jednego dokumentu, następnie paczek według [zatwierdzonego planu](2026-09-10-invoice-import-codex-ai.md).

Pozostały pełny import: trwałe szkice i prywatne oryginały, renderer PDF, upload/edycja/archiwizacja/pobranie, transakcyjne zatwierdzenie kosztu, deduplikacja i późniejszy KSeF, waluty/PLN, zamknięte miesiące, cofnięcie i edycja, clean-DB akceptacja mieszanej paczki. Obecny consumer odrzuca odczyt faktury bez obrazów; nie udaje działającego importu.

Zgoda na commit/push jest osobną otwartą decyzją. Publikacja dodatkowo wymaga kopii bazy/plików, próby migracji na klonie i rzeczywistego odbioru. Instrukcja przygotowanego runtime: [worker/ai/README.md](../../worker/ai/README.md).
