# Task 2 — katalog, formularze i zakresy montaży

## Checkpoint interfejsu przed implementacją

### CatalogManager

- **Intent:** administrator lub manager utrzymuje prawdziwy katalog bez edycji kodu; widzi strukturę kategoria → typ → produkt i może ją spokojnie rozszerzyć, przestawić lub zarchiwizować.
- **Palette:** `--plaster` jako tło, `--paper` jako pojedyncza powierzchnia edycji, `--sand` dla pól oraz `--masking-tape` tylko dla zapisu/dodawania. Ceglasty czerwony jest zarezerwowany dla archiwizacji i błędów.
- **Depth:** grupy katalogu są na poziomie 1 z bardzo subtelnym cieniem; zagnieżdżone typy i produkty nie dostają osobnych dekoracyjnych kart.
- **Surfaces:** rodzic `plaster`, sekcja `paper`, pola `sand`, komunikat błędu bez dodatkowej nakładki; menu kolejności działa przez jawne przyciski góra/dół.
- **Typography:** panel pozostaje przy istniejącym `Plus Jakarta Sans`; identyfikatory kodów produktów używają wyłącznie istniejącej klasy numerycznej.
- **Spacing:** 4 px jako baza, najczęściej 8/12/16/24 px; przyciski mają co najmniej 44 px wysokości.

### TemplateBuilder

- **Intent:** administrator buduje i publikuje wersję formularza bez kodu, ze świadomym rozróżnieniem szkicu od opublikowanej, niemutowalnej wersji.
- **Palette:** te same tokeny operacyjne; bursztyn oznacza zapis szkicu/publikację, ochra jest przeznaczona dla pytania wysokiego ryzyka, nie dla ozdoby.
- **Depth:** jedna powierzchnia `paper` na builder, bez modala całego procesu.
- **Surfaces:** pola `sand`, publikacja jest wyraźnie odseparowana ciepłym obramowaniem; komunikaty walidacji pozostają przy polu.
- **Typography:** `Plus Jakarta Sans`, a klucze pytań w mono tylko dla łatwego skanowania.
- **Spacing:** grupy pytania w rytmie 8/12/16 px; loading i disabled są widoczne na akcji zapisu/publikacji.

### RoomScopeEditor

- **Intent:** opiekun widzi mapę zlecenia jako listę realnych miejsc i może dodać pokoje, zakresy, produkty oraz poprawialne pomiary bez mieszania danych innych kart.
- **Palette:** `plaster` jako mapa tła, `paper` dla pokojów, `sand` dla formularzy; `masking-tape` wyłącznie dla dodawania, `site-red` dla trwałego usunięcia.
- **Depth:** pokój jest jedyną podniesioną powierzchnią; zakresy są rozdzielone linią, aby nie tworzyć stosu kart KPI.
- **Surfaces:** zakres i pomiary pozostają wewnątrz pokoju; historia snapshotu produktu jest czytelna po archiwizacji katalogu.
- **Typography:** istniejący krój panelu, mono tylko dla wymiaru i kodu.
- **Spacing:** 8/12/16/24 px; wszystkie działania mają stany loading, empty, error, disabled i focus.

## RED/GREEN

- RED walidatora pytań: brak modułu `@/lib/installations/question-schema`.
- GREEN walidatora pytań: `8/8` w `__tests__/unit/installations/question-schema.test.ts`.
- RED integracji katalogu: brak modułu `@/lib/installations/catalog-service`.
- GREEN integracji katalogu: realna świeża SQLite i pełen dotychczasowy łańcuch migracji, `11/11` wspólnie z testem walidatora.
- RED E2E panelu: po prawdziwym logowaniu `404 /installations/catalog`; serwer i izolowana baza wystartowały poprawnie.

## GREEN i bramki

- `npm test -- __tests__/unit/installations __tests__/integration/installations` — **GREEN**, 7 plików / 67 testów. Integracja `catalog-template.test.ts` uruchamia pełny, świeży łańcuch migracji na osobnej SQLite i sprawdza normalizację nazw, kolejność, v1/v2/snapshot, snapshot katalogowy oraz trzy zdarzenia audytu pomiaru.
- `node scripts/validate-installation-catalog.mjs` — **GREEN**. Skrypt tworzy tymczasową SQLite, aplikuje wszystkie committed migracje, loguje administratora i nieuprawnionego pracownika, wywołuje prawdziwe HTTP dla katalogu, template v1, snapshotu, pokoju, zakresu, produktu i pełnego CRUD pomiaru, archiwizuje produkt, restartuje serwer i odczytuje stan przez HTTP oraz Prisma/PRAGMA. Nie kontaktuje żadnej usługi zewnętrznej.
- `npm test` — **GREEN**, 58 plików / 345 testów.
- `npm run build` — **GREEN**, Next.js 16.1.6 skompilował wszystkie dynamiczne route handlers, w tym `params: Promise<…>` dla katalogu, template, snapshotu, pokojów, zakresów, produktów i pomiarów.
- Świeże ręczne zastosowanie **całego** łańcucha SQL migracji na `/private/tmp` — **GREEN**; `PRAGMA foreign_key_check` nie zwrócił wierszy, `PRAGMA integrity_check` zwrócił `ok`.

## E2E — formalny BLOCKED po limicie pięciu iteracji

Uruchamiany scenariusz `npm run test:e2e -- e2e/installations-catalog.spec.ts` korzysta z izolowanej bazy i prawdziwego UI. Piąta, ostatnia dozwolona iteracja doszła do końcowego odczytu po archiwizacji katalogu. Widok nowego zakresu zawierał dokładnie dwie opcje: `Wybierz aktywny produkt` i `Ciepły len`; historyczny snapshot `Misty Grey` pozostał widoczny w istniejącym zakresie.

Formalny fail nie dotyczy zachowania aplikacji, tylko niejednoznacznego lokatora testu:

```text
expect(getByLabel('Produkt dla Drugi zakres').locator('option')).not.toContainText('Misty Grey')
strict mode violation: locator resolved to 2 elements
<option value="">Wybierz aktywny produkt</option>
<option value="…">Ciepły len</option>
```

Nie wykonano szóstej naprawy ani nie osłabiono scenariusza, zgodnie z limitem. Bramka E2E jest więc oznaczona jako BLOCKED mimo pozytywnego odczytu funkcjonalnego; wymaga decyzji prowadzącego o dalszej, osobnej iteracji testowej.

## Ograniczenie środowiska Prisma

`DATABASE_URL=file:/private/tmp/... npx prisma migrate deploy` na świeżej bazie zwrócił ogólny `Schema engine error` bez nazwy migracji (powtórzone także poza sandboxem i przy `prisma db push`). Lokalny `schema-engine-darwin-arm64 --version` uruchamia się poprawnie, a identyczny pełny łańcuch SQL przechodzi przez `sqlite3 -bail` wraz z kontrolami FK i integralności. To jest zarejestrowany blocker narzędzia Prisma/środowiska, a nie obejście migracji produkcyjnych: nie zmieniono wcześniejszych migracji ani entrypointu.

## Corrective loop Task 2 — provenance, archiwum i bramka migracji

### RED

1. Nowy test SQLite `task2-corrective.test.ts` przekazał zaufany kontekst
   pracownika oraz body ze `source: CLIENT`, cudzym `authorId` i
   `authorContext`. Poprzedni serwis przyjmował te pola bezpośrednio, a jego
   audit przyjmował wyłącznie string zamiast kontekstu aktora. To odtworzyło
   brak granicy provenance przed wykonaniem zapisu.
2. Ten sam test po archiwizacji karty wywołał bezpośrednio wszystkie mutacje
   room/scope/scopeProduct/measurement (create, update, delete, reorder).
   Pierwszy niechroniony przypadek `updateInstallationRoom()` zwrócił 200 i
   zmienił nazwę `Archiwalny salon` na `Niedozwolona zmiana`.
3. Test UI odtworzył zarchiwizowaną kartę ze starym `canEdit=true`: renderował
   pole `Nazwa pomieszczenia`, przyciski edycji oraz selektor produktu. Drugi
   przypadek pokazał `source: EMPLOYEE` w body przeglądarki; trzeci nie znalazł
   kontrolki wyboru starszego z dwóch draftów.
4. Route test odtworzył surowe przekazanie `CLIENT`, `foreign-employee` i
   `CLIENT:spoofed` do serwisu zamiast kontekstu sesji. Osobne przypadki
   potwierdziły wymagane 401 dla braku sesji i 403 dla INSTALLER/CLIENT.
5. Pierwsze dwie celowane próby Prisma na dwóch nowych bazach były formalnie
   czerwone: bezpośredni
   `node ./node_modules/prisma/build/index.js migrate deploy` oraz `npx prisma
   migrate deploy` zakończyły się `Schema engine error` bez dodatkowego stderr
   i bez utworzenia schematu. Engine `schema-engine-darwin-arm64 --version`
   działał; plik ma tylko atrybut `com.apple.provenance`.

### GREEN

- Dodano wyłącznie addytywną migrację
  `20260822020100_installation_measurement_provenance`: nullable
  `actorUserId` i `actorRole` oraz indeks czasu aktora. Committed
  `20260822020000_installation_catalog` pozostaje niezmieniona.
- Internal API usuwa z requestu `source`, `authorId`, `authorContext` oraz
  pola aktora. `measurementActorFromSession()` odczytuje rolę i aktywny
  `session.employeeId`. Serwis zapisuje niemutowalne provenance: EMPLOYEE lub
  INSTALLER jako source, employee ID wyłącznie gdy aktywne, a zawsze bezpieczny
  `actorUserId`, `actorRole` i `ROLE:userId`. ADMIN/MANAGER bez Employee FK
  zapisuje `authorId=null`, nie podszywa się pod pracownika. PATCH nie ma już
  pól provenance w schema ani w update data.
- Walidator HTTP wysyła teraz rzeczywiste spoofowane create i PATCH; odczyt
  zwraca `source=EMPLOYEE`, `authorId=null`, `actorRole=ADMIN`, bezpieczny
  context `ADMIN:*` i ten sam provenance po korekcie. UI nie wysyła żadnego
  pola provenance.
- Wspólny guard serwisowy odrzuca nieistniejącą albo archiwalną kartę przed
  każdą mutacją room/scope/scopeProduct/measurement, także przy reorder.
  Reorder wykonuje guard i zapis w jednej transakcji. Test dowodzi braku zmian
  rekordów i braku nowego audytu po odrzuceniu wszystkich 14 operacji.
- `canEditInstallationOrder()` i detail uwzględniają `archivedAt` oraz status
  `ARCHIVED`; detail przekazuje do edytora zakresów tylko aktywną możliwość
  edycji. Karta archiwalna ma czytelny stan read-only, bez aktywnych kontrolek.
- Builder pokazuje każdy istniejący draft w deterministycznym selektorze.
  Test wybiera starszy z dwóch szkiców. Opublikowane wersje i snapshot v1
  nadal przechodzą istniejący test niemutowalności.
- Ostatnia asercja E2E nie jest już ogólnym `not.toContainText`: potwierdza
  dokładnie brak opcji `Misty Grey` i obecność aktywnej opcji `Ciepły len` w
  selekcie nowego zakresu.

### Świeże bramki korekty

| Bramka | Wynik |
| --- | --- |
| targeted Task 2 + installation | 10 plików, 76/76, exit 0 |
| `npm test` | 61 plików, 354/354, exit 0 |
| `npm run build` | exit 0; TypeScript i 133 route'ów |
| `node scripts/validate-installation-catalog.mjs` | exit 0; realny HTTP/API/DB readback spoof provenance |
| `npm run test:e2e -- e2e/installations-catalog.spec.ts` | 1/1, exit 0 (13.1 s) |
| fresh direct `migrate deploy` #3 | 20/20 migracji, exit 0 |
| fresh `npx prisma migrate deploy` #4 | 20/20 migracji, exit 0 |
| `foreign_key_check` + `integrity_check` dla obu fresh DB | pusto + `ok` |

Próby Prisma są jawne i nie używają wrappera ani ręcznego `sqlite3` jako
zamiennika: #1 direct i #2 npx były czerwone, #3 direct z `RUST_LOG=debug` i
#4 npx z `RUST_LOG=debug` są niezależnymi zielonymi świeżymi bazami. Nie
zmieniono entrypointu ani wcześniejszych migracji.

## Corrective loop Task 2 — dostępny snapshot formularza i historia kolekcji

### RED

1. Świeży test SQLite wywołał bezpośrednio
   `createInstallationOrderFormSnapshot()` po archiwizacji karty. Poprzednio
   rekord snapshotu został zapisany zamiast odrzucenia i zerowej zmiany
   snapshot/audit.
2. Druga próba snapshotu na aktywnej karcie kończyła się ogólną kolizją
   unikalności `name`, zamiast jednoznacznym błędem `orderId` dla już
   niezmiennej instancji.
3. Detail nie renderował panelu snapshotu: brakowało wyboru opublikowanej
   wersji, stanu po przypięciu i stanu read-only archiwum. `RoomScopeEditor`
   nie pokazywał zapisanego `collectionSnapshot`.
4. Nowy E2E wymagał kliknięcia panelu przez opiekuna, zmiany nazwy produktu
   przez panel katalogu oraz kontroli snapshotu name + collection po rename i
   archive. Przed poprawką nie mógł znaleźć kontrolki wyboru formularza.

### GREEN

- `createInstallationOrderFormSnapshot()` korzysta z tego samego fail-closed
  `assertActiveInstallationOrder()` co mutacje room/scope/measurement. Przed
  insertem sprawdza również istniejący snapshot i przy kolizji wyścigu zwraca
  ten sam jawny błąd `orderId`. Karta ma dokładnie jedną niezmienną instancję;
  Task 3 może odczytać ją przez `getInstallationOrderFormSnapshot()`.
- Detail pobiera wyłącznie opublikowane wersje, prawdziwy snapshot i przekazuje
  je do panelu. Uprawniony opiekun/zastępca/delegat/admin/manager wybiera
  wersję, wysyła wyłącznie `templateId` do istniejącego autoryzowanego API i
  natychmiast widzi niezmienną nazwę, wersję oraz listę pytań. Panel ma stany
  empty/loading/error/disabled/focus; archiwum nie renderuje aktywnej kontrolki.
- `RoomScopeEditor` pokazuje `collectionSnapshot` obok historycznych
  name/code/manufacturer. Integracja, HTTP readback i E2E dowodzą, że po
  rename/archive katalogu pozostają stare `Misty Grey`, `MG-01`, `WallDecor`
  i `Kolekcja: Misty`.
- E2E zachowuje dwa pokoje i różne produkty; tworzy snapshot przez UI, zmienia
  `Misty Grey` przez kontrolkę edycji katalogu (PATCH UI), znajduje nową nazwę
  w aktywnym selektorze, a po archiwizacji dowodzi braku produktu w nowym
  zakresie. Historyczny scope nadal pokazuje pierwotny snapshot.
- Formalny blocker E2E z wcześniejszej sekcji dotyczył wyłącznie niejednoznacznej
  ostatniej asercji selektora. Został zastąpiony ścisłą kontrolą opcji i bieżący
  scenariusz kończy się GREEN; nie osłabiono wcześniejszych kroków.

### Świeże bramki korekty

| Bramka | Wynik |
| --- | --- |
| RED → targeted serwis/UI/route | 5 czerwonych asercji odtwarzających cztery luki; potem 4 pliki / 12/12 GREEN |
| targeted Task 2 + installation | 11 plików / 80 testów, exit 0 |
| `npm test` | 62 pliki / 358 testów, exit 0 |
| `npm run build` | exit 0; TypeScript i 133 route'ów |
| `node scripts/validate-installation-catalog.mjs` | exit 0; realny HTTP snapshot, zakaz zastąpienia immutable snapshotu, SSR panelu i collection readback |
| `npm run test:e2e -- e2e/installations-catalog.spec.ts` | 1/1, exit 0 (14.7 s) |
| fresh direct `node ./node_modules/prisma/build/index.js migrate deploy` | 20/20 migracji, nowa `/private/tmp` SQLite, exit 0 |
| fresh `npx prisma migrate deploy` | 20/20 migracji, druga nowa `/private/tmp` SQLite, exit 0 |
| `foreign_key_check` + `integrity_check` dla obu fresh DB | pusto + `ok` |

W tym loopie nie zmieniono migracji ani entrypointu. Dwa realne `migrate
deploy` są osobnymi zielonymi próbami; `sqlite3` służył wyłącznie do kontroli
FK/integrity po sukcesie Prisma, nie jako substytut migracji.

## Quality corrective loop Task 2 — trwały hierarchy guard i request validation

### RED

1. Odtworzono finding review bezpośrednim Prisma: aktywny
   `InstallationCatalogType` powstał pod zarchiwizowaną kategorią. Ten sam
   zestaw testów wykazał aktywne dzieci pod nieaktywnym rodzicu w równoległym
   archive-versus-write przebiegu.
2. Test 40 rund na dwóch klientach SQLite uruchamiał category archive z create
   type/product oraz type archive z create/reactivate product, na zmianę w obu
   porządkach startu. Przed migracją odczyt znalazł aktywne typy pod
   nieaktywną kategorią.
3. `YES_NO_UNKNOWN`, `NUMBER`, `DIMENSION`, `TEXT` i `FILE` przyjmowały
   `options`, choć nie są pytaniami wyboru.
4. Route snapshotu dereferencjował `null` (500), nie trimował `templateId` i
   przekazywał `{}`, tablicę, string, puste oraz rozszerzone body do serwisu.

### GREEN

- Addytywna migracja
  `20260822020200_installation_catalog_active_hierarchy` dodaje sześć
  triggerów SQLite. Blokują one INSERT/UPDATE (aktywację i reassignment)
  aktywnego type pod inactive category oraz aktywnego product pod inactive
  type/category. Dwa symetryczne trigery blokują także direct SQL/Prisma
  archive rodzica z aktywnymi dziećmi. Nie zmieniono wcześniejszych migracji.
- Istniejące archive category/type pozostają pojedynczą transakcją children
  first, parent last. Z triggerami każdy porządek współbieżnych writerów kończy
  się albo odrzuceniem write/archive, albo zarchiwizowaniem wszystkich dzieci;
  baza nie może zapisać niedozwolonego końcowego stanu.
- Test direct Prisma pokrywa create, direct parent archive, reactivation oraz
  parent reassignment. Test równoległości ma 40 deterministycznych rund i po
  każdej sprawdza trzy niedozwolone relacje w bazie; akceptuje wyłącznie
  odrzucenia constraintu triggera (`P2003`/`P2004`), nie maskuje locków ani
  timeoutów.
- `options` są wymagane, niepuste i unikalne dla `SINGLE`/`MULTI`; wszystkie
  pozostałe typy odrzucają je z polskim błędem. Istniejący schemat glifów
  (YES/NO/UNKNOWN + conditional DIMENSION) pozostaje poprawny.
- POST snapshotu waliduje strict Zod plain object `{ templateId }`, trimuje ID
  i dla `null`, `{}`, `[]`, stringa, pustego oraz dodatkowego pola zwraca
  polski 400 bez wywołania serwisu.

### Świeże bramki korekty

| Bramka | Wynik |
| --- | --- |
| RED → focused invariants/schema/route | 14 czerwonych asercji; następnie 3 pliki / 24/24 GREEN |
| targeted Task 2 + installation | 12 plików / 94 testy, exit 0 |
| `npm test` | 63 pliki / 372 testy, exit 0 |
| `npm run build` | exit 0; TypeScript i 133 route'ów |
| `node scripts/validate-installation-catalog.mjs` | exit 0; prawdziwy HTTP/API/DB readback |
| `npm run test:e2e -- e2e/installations-catalog.spec.ts` | 1/1, exit 0 (13.8 s) |
| fresh direct `migrate deploy` | 21/21 migracji, exit 0; 6 triggerów, child + parent direct Prisma blocked, FK puste, integrity `ok` |
| upgrade `npx prisma migrate deploy` | kopia SQLite z 20 migracjami → zastosowano wyłącznie `20260822020200`; 6 triggerów, child + parent blocked, FK puste, integrity `ok` |

Kontrola triggerów po obu realnych `migrate deploy` użyła bezpośredniego
Prisma na tych samych tymczasowych DB; nie zastępowała migracji ręcznym SQL.
