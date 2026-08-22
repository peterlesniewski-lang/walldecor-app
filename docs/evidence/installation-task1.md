# Montaże — dowód Tasku 1 po korekcie spec review

## Checkpoint designu

```text
Intent: pracownik tworzy trwałą kartę, natychmiast widzi odpowiedzialność
        primary/backup i pracuje spokojnie, bez generycznych KPI.
Palette: istniejący panel używa plaster/paper/sand/graphite/masking-tape;
         bursztyn oznacza działanie, bez fioletowych gradientów.
Depth: tylko subtelny cień dla podniesionych arkuszy; pola są lekko inset.
Surfaces: plaster strony, paper dla grup danych, sand dla pól i statusów.
Typography: panel pozostaje przy istniejącym Plus Jakarta Sans; Bricolage
            Grotesque i Spline Sans są wyłącznie kontraktem formularza klienta.
Spacing: wszystkie grupy i kontrolki utrzymują siatkę bazową 4 px.
```

## RED → GREEN

1. Test polityki instalatora najpierw zwrócił `undefined` dla instalatora A
   mimo konkretnego przypisania; parser jednocześnie przyjmował `ARCHIVED`.
   Po dodaniu `InstallationOrderInstaller`, corrective migration, query
   `installerAssignments`, polityki porównującej `employeeId` i walidacji
   statusu: 20/20 zielonych testów jednostkowych.
2. Testy POST zwróciły 201 dla EMPLOYEE wskazującego innego primary oraz dla
   EMPLOYEE bez `employeeId`. Po sprawdzeniu przed wywołaniem serwisu: 25/25.
   ADMIN/MANAGER mogą wskazać dowolne aktywne osoby; INSTALLER otrzymuje 403.
3. Testy kontrolek wykazały widoczne tworzenie/edycję/archiwizację mimo braku
   uprawnień. Props `canCreate`, `canEdit`, `canArchive` są teraz fail-closed;
   formularz EMPLOYEE blokuje primary na własnej osobie. Zielony wynik: 28/28.
4. Test usunięcia przypisanego instalatora początkowo dostał 200. Relacja
   `InstallationOrderInstaller` została dodana do prewencyjnego 409 HR;
   zielony wynik: 29/29.
5. Harness integracyjny przestał używać `migrate diff --from-empty`: stosuje
   wszystkie rzeczywiste `prisma/migrations/*/migration.sql` kolejno przez
   `sqlite3 -bail`, sprawdza exit code, włącza `PRAGMA foreign_keys=ON`,
   restartuje Prisma na tym samym pliku i usuwa temp DB. Pierwsze uruchomienie
   poprawiło selekcję `migration_lock.toml`; finalnie 2/2.
6. Re-review wykazał, że EMPLOYEE body `null` powodował TypeError, a tablica,
   string i liczba dostawały 403 przed walidacją. Test route był czerwony dla
   4 przypadków; po sprawdzeniu non-null plain object przed odczytem
   `primaryEmployeeId` wszystkie zwracają 400 z polskim `fieldErrors.form`,
   bez wywołania serwisu. Zielony targeted wynik: 33/33.

## Świeża bramka

| Komenda | Wynik |
| --- | --- |
| targeted unit + integration | 3 pliki, 51/51, exit 0 |
| `npm test` | 54 pliki, 329/329, exit 0 |
| `npm run build` | exit 0; Turbopack 3.5 s, TypeScript i 130 route'ów |
| `node scripts/validate-installation-order.mjs` ×2 | oba exit 0; oba `persistedStatus: ARCHIVED` |
| `npm run test:e2e -- e2e/installations-order.spec.ts` | 1/1, exit 0 (7.8 s) |
| `prisma migrate deploy` na świeżej SQLite | 18/18 migracji, `foreign_key_check` puste, `integrity_check: ok` |

## Dowód DB, API i UI

- Integracja seeduje admina, trzech aktywnych i jednego nieaktywnego pracownika.
  Dowodzi create/list/get/update/archive, unikalnego numeru, FK ownerów,
  unikalności i FK `InstallationOrderInstaller` oraz odczytu po restarcie.
- Walidator uruchamia Next na osobnym loopback i odizolowanej SQLite: loguje
  administratora oraz outsider EMPLOYEE przez Credentials/NextAuth, sprawdza
  HTTP 400 i 403, następnie POST → GET list/detail → PATCH → DELETE, restart
  serwera na tej samej DB, HTTP readback i bezpośredni readback Prisma.
- Pierwsze uruchomienie walidatora wewnątrz sandboxa zatrzymał zakaz listen
  (`EPERM`); uruchomienie lokalne poza sandboxem wykazało błędny probe oczekujący
  401, podczas gdy proxy przekierowuje anonimowy request na `/login`. Probe
  zmieniono na publiczne `/api/auth/csrf`; następny pełny roundtrip zakończył
  się exit 0.
- E2E pokazuje kartę na aktywnej liście po create, klika ją do detail, edytuje
  adres, odświeża, archiwizuje i widzi zniknięcie z aktywnych. Drugi kontekst
  outsider EMPLOYEE dostaje 403 na detail API.

## Zakres INSTALLER

Model, migracja, czysta polityka i test konkretnego `employeeId` instalatora są
gotowe. Globalne konto/rola NextAuth INSTALLER oraz jego logowanie E2E są
świadomie poza Taskiem 1 i pozostają do Tasku 6; E2E nadal pokrywa outsider
EMPLOYEE zgodnie z decyzją architektoniczną.

## Iteracje E2E

Pięć rzeczywistych prób mieści się w limicie: brak testowego sekretu NextAuth,
brak przekazanego `DATABASE_URL`, niezgodna nazwa domyślnej temp DB, zbyt szeroki
regex akceptujący `/installations/new`, a następnie zielone 1/1. Każda korekta
dotyczyła wyłącznie harnessu testowego; żadna nie osłabiła polityki lub testu.
`playwright.config.ts` używa tylko `E2E_DATABASE_URL`; gdy go nie ma, tworzy
stabilną ścieżkę `file:/tmp/walldecor-installations-e2e-<run-id>.db`, przekazuje
ją webServerowi jako `DATABASE_URL` i `E2E_DATABASE_URL`, wymusza lokalny
`NEXTAUTH_URL` oraz stały, testowy sekret. Config odrzuca nieizolowany URL
przed startem webServera. `reuseExistingServer: false` wyklucza
przypadkowe podłączenie do obcego dev servera. Po tym hardeningu wykonano
osobne potwierdzenie tego samego scenariusza: 1/1, exit 0 (6.6 s).

## Re-review jakości Tasku 1 — izolacja i invariants

### RED → GREEN

1. Nowy test integracyjny dla dwóch kart z tym samym e-mailem był czerwony:
   druga karta dostała ten sam `clientId` (`expected ... not to be ...`).
   Model zmieniono na relację 1:1, migracja kopiuje historycznie współdzielony
   rekord dla każdej późniejszej karty, a serwis zawsze tworzy klienta przy
   create i aktualizuje tylko `current.clientId` przy PATCH. Zielony wynik:
   4/4 integracyjne; edycja B nie zmienia klienta ani audytu A.
2. Targeted test policy/null/HR był czerwony w 8 przypadkach: pusty numer
   lokalu nie stawał się `null`, inactive EMPLOYEE nadal widział kartę,
   brakowało osobnych praw edit/archive, delegat mógł archiwizować, a HR PATCH
   nie zatrzymywał dezaktywacji ownera. Po minimalnych zmianach: 42/42
   jednostkowych. Polityka ma jawne `canView`, `canEdit`, `canArchive`;
   aktywność EMPLOYEE jest odczytywana z `Employee.active` przez route'y i
   Server Components.
3. Fresh-chain test najpierw wskazał FK do celowo niezasianych historycznych
   ownerów. Fixture skorygowano do prawdziwych rekordów `Employee` i
   `CostCenter`; finalnie kolejno stosuje wszystkie committed SQL, seeduje
   współdzielonego dawnego klienta przed corrective migration, a następnie
   dowodzi osobnych snapshotów oraz pustego `foreign_key_check`.
4. Migracja `20260822010200...` odbudowuje `InstallationOrder` z DB-level
   `CHECK (primaryEmployeeId <> backupEmployeeId)`, FK oraz indeksami.
   Bezpośredni `PrismaClient.installationOrder.create` z tym samym ownerem
   kończy się `CHECK constraint failed`.
5. Pierwszy build po zmianie wykrył wyłącznie błąd TypeScript w generycznym
   typie helpera patcha; po minimalnej korekcie targeted testy są zielone.
   Kolejna kompilacja zatrzymała się po TypeScript bez nowego outputu i przez
   ponad 2 minuty trzymała `.next/lock` (PID 95892, rodzic PID 95376).
   Żywy proces zatrzymano kontrolowanie `SIGTERM`, bez kasowania locka;
   kolejny całkowicie świeży build zakończył się exit 0.
6. Pierwszy `prisma migrate deploy` na pustym pliku zwrócił tylko
   `Schema engine error` bez utworzenia `_prisma_migrations`. Diagnostyczne
   ponowienie na tym samym, nadal pustym pliku zastosowało 18/18 migracji;
   `PRAGMA foreign_key_check` nie zwróciło wierszy, a `integrity_check` zwrócił
   `ok`. Tymczasową DB i sidecary usunięto.

### Dowód zachowań

- EMPLOYEE jest fail-closed po dezaktywacji zarówno dla list/detail API, jak i
  create; primary/backup mogą edytować i archiwizować. Aktywny delegat może
  edytować dane operacyjne, lecz route blokuje zmianę primary/backup i DELETE.
  INSTALLER zachowuje wyłącznie konkretnie przypisany widok, bez mutation.
- Zwykły PATCH formularza przesyła `null` po wyczyszczeniu numeru budynku lub
  lokalu; schema i serwis traktują to jako trwałe wyczyszczenie, nie jako
  odtworzenie poprzedniej wartości.
- HTTP walidator po re-review przeszedł z odizolowaną SQLite: login,
  400/403, POST → list/detail → PATCH → DELETE, restart serwera i direct DB
  readback (`ARCHIVED`). E2E 1/1 sprawdza create → aktywna lista → detail →
  edit/refresh → archive oraz 403 outsider EMPLOYEE.

### Granica wdrożenia migracji

Nie zmieniano `docker-entrypoint.sh`: aktualny runtime produkcyjny nadal
wykonuje `prisma db push --skip-generate`. `migrate deploy` jest dowiedziony
wyłącznie na świeżej, lokalnej SQLite. To **nie** jest deklaracja gotowości
produkcji: przed deployem wymagany jest osobny gate baseline/reconcile na
klonie produkcyjnej SQLite (backup, porównanie `_prisma_migrations`,
`foreign_key_check`, `integrity_check` i plan rollbacku), zanim zmieni się
tryb entrypointu lub zastosuje migracje na produkcji.

## Re-review jakości Tasku 1 — atomowa dezaktywacja ownera

### RED → GREEN

1. Test route interleaving był czerwony: przy dawnej sekwencji `count` →
   `employee.update` odpowiedź była 200 i testowy pracownik stawał się
   nieaktywny, mimo że w przerwie pojawiła się aktywna karta. Realny test
   SQLite odtwarza tę samą kolejność: legacy count zwraca 0, następnie tworzy
   kartę, a próba dezaktywacji musi zachować `Employee.active=true`.
2. GREEN: `deactivateEmployeeIfNoActiveInstallationOrder()` wykonuje jeden
   `UPDATE "Employee" ... WHERE id = ? AND NOT EXISTS (aktywny primary/backup)`.
   `affectedRows=0` jest rozróżniane dopiero potem jako 404 albo zachowane 409
   z polskim komunikatem. SQLite serializuje writerów, więc create/update
   ownera i ten warunkowy zapis nie zostawiają stanu `active=false` z aktywną
   kartą ownera. Targeted wynik: 51/51; realna integracja: 5/5.
3. Test helpera walidatora był czerwony, bo helper nie istniał. GREEN:
   `stopServerGracefully` przyjmuje wyłącznie SIGTERM wysłany przez harness,
   sprawdza zwolnienie tego samego portu przez bind/close i nadal odrzuca crash
   przed shutdownem albo inny sygnał. Unit helpera: 3/3.

### Świeży dowód wykonania

- `npm test`: 54 pliki, 329/329, exit 0; świeży build zakończył się exit 0
  i wygenerował 130 route'ów. Wcześniejszy build po testach był aktywny bez
  postępu przez ponad 2 minuty (PID 2243, rodzic PID 1692), więc został
  kontrolowanie zatrzymany SIGTERM po potwierdzeniu żywego locka; locku nie
  usuwano ręcznie. Następny build był zielony.
- Walidator HTTP uruchomiono **dwa razy z rzędu** na niezależnych temp SQLite:
  oba pełne roundtripy zwróciły exit 0 i `persistedStatus: ARCHIVED`, co jest
  realnym dowodem kontrolowanego SIGTERM i zwolnienia portu przed restartem.
- E2E workflow: 1/1, exit 0 (7.8 s). Fresh `migrate deploy` po pierwszym
  pustym `Schema engine error` został diagnostycznie ponowiony na tym samym
  pustym pliku: 18/18 migracji, puste `foreign_key_check`,
  `integrity_check: ok`; plik temp i sidecary zostały usunięte.

## Finalny minor — własność shutdownu walidatora

### RED → GREEN

1. Nowy test helpera ustawił `exitCode=0` przed wywołaniem shutdownu. RED:
   promise błędnie się rozwiązywał, `kill` nie był wywołany, a helper mimo to
   sprawdzał port. Po usunięciu tej ścieżki każdy już zakończony proces — także
   z kodem 0 — kończy walidację błędem i nie wykonuje ani `kill`, ani proby
   portu. Test jednostkowy: 5/5.
2. Zbadano również rzeczywisty proces Next. Po SIGTERM wysłanym przez harness
   Next kończy się kontrolowanie z `exitCode=0`, a nie `signalCode=SIGTERM`.
   To prawidłowe graceful shutdown, ale jest akceptowane tylko po potwierdzonym
   `server.kill('SIGTERM')`; helper czeka na jego exit i dopiero potem robi
   bind/close tego samego portu. Proces z wcześniejszym crashem, SIGKILL albo
   kodem 0 sprzed własnego SIGTERM pozostaje błędem.

### Świeża bramka końcowa

| Komenda | Wynik |
| --- | --- |
| targeted validator + order rules + integration | 3 pliki, 53/53, exit 0 |
| `npm test` | 54 pliki, 331/331, exit 0 |
| `npm run build` | exit 0; Turbopack 3.4 s, TypeScript i 130 route'ów |
| `node scripts/validate-installation-order.mjs` ×2 | oba exit 0, `persistedStatus: ARCHIVED` |
| `npm run test:e2e -- e2e/installations-order.spec.ts` | 1/1, exit 0 (8.0 s) |
| `prisma migrate deploy` na świeżej SQLite | 18/18 migracji; `foreign_key_check` puste, `integrity_check: ok` |

Pierwsze dwa zwykłe wywołania `migrate deploy` zwróciły wyłącznie `Schema engine
error` bez utworzenia DB. Diagnostyczne ponowienie z `RUST_LOG=debug` na tym
samym pustym pliku zastosowało pełne 18/18 migracji. Tymczasowe DB i
`test-results/` zostały usunięte po bramce.
