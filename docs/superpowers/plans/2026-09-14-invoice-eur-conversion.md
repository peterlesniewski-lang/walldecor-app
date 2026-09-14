# Invoice EUR Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Administrator ogląda poprawny oryginał faktury mimo kompresji transportu i zapisuje zweryfikowaną wartość EUR → PLN według daty zapłaty, z ręcznymi korektami.

**Architecture:** Istniejący prywatny import faktur pozostaje źródłem danych i uprawnień. Osobne moduły obsługują kurs NBP i rachunek dziesiętny; metadane trafiają do wersjonowanego JSON szkicu, a przeliczone kwoty do obecnych pól raportowych. UI zachowuje ręczne dane i odrzuca spóźnione odpowiedzi.

**Tech Stack:** Next.js 16, React 19, Zod 4, Prisma 5/SQLite, Vitest, Playwright, oficjalne API NBP; bez nowych zależności.

**Workspace:** `/Users/piotr/projekty/ksiegowosc/walldecor-invoice-ai`, istniejący izolowany worktree `feat/invoice-import-codex-ai`. Bazowy commit specyfikacji: `b3434c2`.

## Zasady i granice

- Żaden widoczny element interaktywny nie jest atrapą: działa albo nie istnieje.
- Plik oznacza bajty, PDF to prawdziwy PDF, formularz czyta dane z bazy, zapis zmienia bazę.
- Logika domenowa pozostaje poza komponentem. Brak nowych pakietów i masowych migracji dokumentów.
- Zakres nie obejmuje automatycznego VAT/WNT, różnic kursowych, zmiany istniejących zatwierdzonych kosztów ani kursów innych niż EUR. Dotychczasowy ręczny flow innych walut działa nadal.
- Realnej otwartej faktury i niezapisanych pól użytkownika nie dotykamy. Testy mutujące wykonujemy na izolowanych, syntetycznych danych.
- Wykonanie: jeden agent implementacyjny na zadanie; następnie niezależny przegląd zgodności i dopiero potem jakości. Właściciel zadania usuwa wykryte błędy.
- Każdy loop kończy dowód zachowania, nie deklaracja. Maksymalnie pięć nieudanych iteracji tej samej bramki przed raportem blokera.

## Task 1 — Oryginał przechodzi weryfikację niezależnie od kompresji

**Files:**
- Modify: `src/lib/invoice-import/client.ts`.
- Modify: `__tests__/unit/invoice-import/client.test.ts`.
- Create: `__tests__/integration/invoice-import/original-transport.test.ts`.

- [x] RED: dopisać testy poprawnego ciała odpowiedzi bez `Content-Length` oraz z `Content-Encoding: gzip` i długością kompresji. Dane Response odpowiadają już rozkodowanemu strumieniowi Fetch:

```ts
const fetcher = vi.fn(async () => new Response(bytes, {
  headers: { 'content-type': 'image/png', 'content-encoding': 'gzip', 'content-length': '24' },
}))
const blob = await createInvoiceImportClient(fetcher).original('draft', expected)
expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
```

- [x] Uruchomić `npm test -- __tests__/unit/invoice-import/client.test.ts`; nowe testy mają przed poprawką kończyć się `INVALID_ORIGINAL`.
- [x] GREEN: uzależnić wstępną kontrolę rozmiaru od reprezentacji transportowej, zachować dokładną kontrolę końcowego strumienia oraz SHA-256:

```ts
const length = response.headers.get('content-length')
const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
const identity = !encoding || encoding === 'identity'
const badLength = identity && length !== null && length !== String(expected.byteSize)
if (!response.ok || response.headers.get('content-type') !== expected.mimeType || badLength) {
  void response.body?.cancel().catch(() => {})
  throw new Error()
}
```

- [x] Test integracyjny uruchamia lokalny HTTP server na 127.0.0.1, zwraca syntetyczny PDF zarówno bez kompresji, jak i przez `gzipSync`. Prawdziwy Fetch i klient mają zwrócić identyczne bajty. Złe SHA-256, skrócenie i nadmiar danych nadal odrzucane; serwer zamykany w `finally`.
- [x] Uruchomić oba pliki testów. Zatwierdzić tylko własne pliki commitem `fix(finance): verify decoded invoice originals through compression`.
- [x] Przegląd specyfikacji, następnie jakości. Dowód: output testów i odczyt blobu o oczekiwanych bajtach, bez poluzowania dostępu do pliku.

DOWÓD Task 1: commit `a548017`; RED 7/32 zakończone `INVALID_ORIGINAL`, GREEN 32/32.
Własny ponowny test kontrolera 2026-09-14 14:55 CEST: oba pliki, 32/32 PASS.
Niezależne przeglądy zgodności i jakości PASS, bez uwag. To dowód lokalny;
publiczny podgląd po wdrożeniu pozostaje częścią końcowej bramki.

## Task 2 — Kurs, zapis i walidacja EUR po stronie serwera

**Files:**
- Create: `src/lib/invoice-import/eur-conversion.ts` (schema metadanych i dziesiętne przeliczenie).
- Create: `src/lib/invoice-import/nbp-rate.ts` (jedno ograniczone pobranie EUR).
- Create: `src/app/api/finance/invoice-import/exchange-rate/route.ts`.
- Modify: `src/lib/invoice-import/contracts.ts`, `draft-service.ts`, `approval-policy.ts`, `http.ts`, `client.ts`.
- Modify: `src/lib/invoice-import/http-errors.ts`, `ksef-reconciliation-policy.ts` oraz odpowiadające testy (polskie błędy i unieważnienie potwierdzenia po zmianie daty zapłaty przez KSeF).
- Test: nowe `__tests__/unit/invoice-import/eur-conversion.test.ts`, `nbp-rate.test.ts`; istniejące integracyjne `draft-service.test.ts`, `approval-service.test.ts`, `http.test.ts`.

Kontrakt metadanych nazwany `conversion` jest opcjonalny/null dla starych szkiców. Zawiera `mode: 'NBP' | 'MANUAL_RATE' | 'MANUAL_AMOUNT'`, dodatni kurs dziesiętny w `rate` albo null dla ręcznej kwoty, `paymentDate`, `rateDate`, `tableNumber`. Tylko NBP ma numer tabeli i datę publikacji. Kwoty pozostają w `reportingGross`, `reportingNet`, `reportingVat`. AI nie dostaje prawa do modyfikacji metadanych.

Doprecyzowanie po przeglądzie Task 3: `MANUAL_RATE` z `rate: null` oznacza
nieukończony szkic, nigdy zatwierdzone przeliczenie. Pozwala zachować ręczny
wybór bez zamieniania go po odczycie w legacy `MANUAL_AMOUNT` lub auto-NBP.

- [x] RED: testy rachunku: `360.20 × 4.25 = 1530.85`, `0.01 × 4.255 = 0.04`, brak netto/VAT pozostaje null; kurs zerowy/ujemny/nieskończony/niepoprawny jest odrzucany. BigInt lub równoważne dokładne dziesiętne mnożenie, bez błędów binarnych float przy zaokrągleniu half-up do groszy.
- [x] GREEN: schema metadanych, parser kursu i funkcja `convertEurAmounts` używane przez serwer i formularz. Ograniczyć długość i precyzję wejścia, sprawdzać bezpieczny zakres groszy. Eksporty i argumenty udokumentować w pliku testów.
- [x] RED: test NBP z wstrzykiwanym Fetch: dla zapłaty 2026-09-14 wynik pochodzi z 2026-09-11; wynik z dnia zapłaty, inna waluta/tabela, niepełna odpowiedź, timeout, błędna/future data nie mogą dać ważnego kursu.
- [x] GREEN: `getNbpEurRate(paymentDate, dependencies)` pobiera wyłącznie stały host i ścieżkę `https://api.nbp.pl/api/exchangerates/rates/a/eur/{start}/{end}/?format=json`. `end` to dzień przed zapłatą, `start` to 31 dni wcześniej. Ograniczony timeout i rozmiar odpowiedzi, brak przekierowań na obcy host, walidacja Zod, wybór najpóźniejszej poprawnej tabeli. Dziś wyznaczać w strefie Europe/Warsaw. Brak wyników to czytelny błąd z możliwością ręcznego kursu, nie kurs dzisiejszy.
- [x] RED: test endpointu: niezalogowany 401, nieaktywny/inny niż ADMIN 403, poprawna data daje JSON kursu, nieprawidłowa 422, niedostępny NBP bez surowych szczegółów 502/503. Endpoint `GET ?paymentDate=YYYY-MM-DD` nie przyjmuje dowolnego URL ani danych faktury.
- [x] GREEN: użyć istniejącego `respond`/`actor` w `http.ts`; route Node.js, force-dynamic, wywołuje handler. Klient waliduje wynik przed użyciem. Wstrzykiwanie pobierania kursu w handlerach ułatwia test bez prawdziwego NBP.
- [x] RED: integracyjne testy zapisu i zatwierdzania sprawdzają metadane po odczycie, audyt, kontrolę wersji, unieważnienie potwierdzenia po zmianie `paidAt`, kursu i kwot PLN; niezgodna kwota wyliczona nie może zostać zatwierdzona. Stary szkic bez metadanych nadal działa.
- [x] GREEN: rozszerzyć opcjonalny kontrakt i listę pól chronionych. W `editDraft` walidować spójność merged danych z metadanymi; zapis nieukończonego szkicu dozwolony, zatwierdzenie wymaga kompletnej zgodnej podstawy. `approval-policy` ponownie sprawdza kurs i wynik, aby ominiecie UI nie ominęło kontroli. Przeliczenie NBP nie może mieć fałszywie oznaczonej daty/tabeli; weryfikować źródło po stronie serwera przed przyjęciem nowej potwierdzonej podstawy, poza długą transakcją DB. Nie pobierać kursu przy każdym odczycie ani przeliczać już zatwierdzonych kosztów.
- [x] RED/GREEN: przyjęcie danych KSeF ze zmienionym `paidAt` unieważnia istniejące potwierdzenie, tak jak zmiana kwot. Test usługi zachowuje ślad tej zmiany w audycie; metadane nie znikają bez decyzji operatora.
- [x] Uruchomić testy nowych modułów oraz integracyjne testy zmienionych usług. Commit tylko własnych plików. Przegląd zgodności i jakości.

DOWÓD Task 2: commit `27c53dd`; niezależne przeglądy zgodności i jakości PASS.
Własny pełny zestaw kontrolera 2026-09-14 15:09 CEST: 34 pliki, 620/620 PASS.
Rzeczywisty moduł NBP oraz połączenie z kontenera produkcyjnego zwróciły
kurs 4.3228 z 2026-09-11, tabela 177/A/NBP/2026, dla zapłaty 2026-09-14.
Brak migracji bazy i nowych zależności. To nie jest jeszcze wdrożenie funkcji.

Preflight wykrył też zależność pakowania workera: nowy kontrakt importuje
`eur-conversion.ts`. Wymagane jest dopisanie tego jednego modułu do COPY oraz
restrykcyjnej allowlisty Dockerfile, bez restartu obecnego workera i bez dostępu
do bazy. Nowy test importuje rzeczywistą paczkę z odizolowanego katalogu:
RED `Cannot find module './eur-conversion'`, GREEN 7/7; zestaw workera i
konfiguracji wdrożenia 103/103 PASS. To nie zastępuje budowy obrazu Linux.

## Task 3 — Operator przelicza, poprawia, zapisuje i ponownie otwiera

Status zadania: wykonane i odebrane; szczegółowe dowody poniżej.

**Files:**
- Modify: `src/lib/invoice-import/review-form.ts`.
- Modify: `src/components/invoice-import/invoice-review-editor.tsx`.
- Create: `src/components/invoice-import/invoice-eur-conversion.tsx` (kontrolki przeliczenia, bez rozrostu głównego edytora).
- Modify: `__tests__/unit/invoice-import/review-form.test.ts`.
- Test: `__tests__/unit/invoice-import/invoice-eur-conversion.test.tsx` oraz istniejące testy edytora.
- Create: `scripts/validate-invoice-eur-ui.mjs` na wzorcu `scripts/validate-invoice-manual-auth-ui.mjs`.

- [ ] RED: test UI wpisuje `360,20` EUR, datę zapłaty, ręczny kurs `4,25` i widzi `1530,85` PLN; potwierdza, zapisuje, ponownie otwiera i widzi te same dane. NBP działa automatycznie dopiero po podaniu daty i nigdy nie nadpisuje trybu ręcznego.
- [ ] GREEN: formularz przechowuje metadane oraz ma działające kontrolki pobrania/przywrócenia NBP i ręcznej korekty. `conversionConfirmed` resetuje się po zmianach podstawy. Komponent odpowiada tylko za interakcję, używa funkcji dziedzinowych z Task 2.
- [ ] RED: spóźniony request NBP nie zastępuje ręcznej korekty ani nowszej daty; utrata połączenia umożliwia wpisanie kursu; brak daty/future date nie używa dzisiejszego kursu. Konflikt wersji i rebase nie przenoszą potwierdzenia na inną podstawę.
- [ ] GREEN: abort + identyfikator generacji żądania, ochrona dirty/rebase i blokad edytora. Stare ręczne kwoty PLN otwierają się w trybie niepozwalającym na automatyczne nadpisanie. Inne waluty zachowują obecną obsługę.
- [ ] RED: EUR bez VAT nie zmienia kwoty przez 1,23, nie zeruje nieznanego VAT. Etykieta główna „Kwota do zapłaty (EUR)”; „Kwota netto” i „Kwota VAT” nadal odnoszą się do dokumentu.
- [ ] GREEN: zmiana etykiet zależna od waluty, bez migracji kwot dokumentu.
- [ ] Testy jednostkowe oraz pełny flow UI na czystej izolowanej bazie: logowanie administratora → upload syntetycznego PDF → podgląd/pobranie → edycja faktury EUR bez VAT → kurs ręczny i próba NBP → korekta PLN → zapis → ponowne otwarcie → zatwierdzenie → rzeczywisty CostEvent w PLN → cofnięcie/archiwizacja. Drugą rolą potwierdzić odmowę. Restart testowej aplikacji ma zachować dane i plik. Walidator nie modyfikuje danych użytkownika.
- [ ] Commit tylko własnych plików. Przegląd specyfikacji i jakości.

DOWÓD przed poprawką końcową: Task 3 commit `0a0480f`; SPEC PASS 68/68.
Własny zestaw kontrolera: 1416/1416 PASS (dwa odrębne testy zewnętrzne pominięte),
`typecheck:app` PASS. QUALITY wykrył P2 nieobjęte tymi testami:
niepoprawny kurs → zapis `conversion: null` ze starymi PLN → odczyt jako ręczna
kwota → możliwe zatwierdzenie.

P2 zamknięte w `b95df3d`: testy błędnego kursu → zapis → odczyt → próba
zatwierdzenia, w tym ponowne połączenie z rzeczywistą SQLite. SPEC 180/180 PASS,
QUALITY 84/84 PASS oraz niezależny reproduktor `INVALID_EUR_CONVERSION`.
Kontroler 2026-09-14 15:47 CEST: 1418/1418 PASS, dwa odrębne testy zewnętrznego
AI pominięte; `typecheck:app` i produkcyjny `npm run build` PASS.
Build ID `O2Vfm6G2bPuVCL_k5YQAG` zawiera kod aplikacji z `b95df3d`.

Pierwszy pełny UI run zatrzymał się na `NATIVE_PDF_PLUGIN_NOT_VISIBLE`:
domyślny headless-shell nie ma natywnego czytnika. `d66e76d` wybiera prywatny
pełny Chromium tak jak istniejąca bramka batch, bez osłabiania asercji pliku.
Test konfiguracji RED → GREEN 4/4. Oryginalny syntetyczny PDF ma czytelne dwie
strony i fakty zgodne z formularzem, potwierdzone osobnym renderem PDFium
oraz oględzinami obu stron.

DOWÓD pełnego UI: drugi run `invoice-eur-ui-1789393821359-9075f2c2` PASS 6/6,
raport w `test-results/invoice-eur-ui-1789393821359-9075f2c2/report.json`.
Rzeczywisty NBP 4.3228; kurs ręczny 4.25 daje 1530.85; świadoma korekta na
1500 PLN pozostaje po zapisie i ponownym otwarciu, tworzy jeden CostEvent,
trwa po restarcie tej samej prywatnej aplikacji i bazy. PDF przed/po restarcie
ma identyczne SHA-256; cofnięcie i archiwizacja zachowują historię. Manager 403,
zero wykonań AI, integralność bazy PASS. Kontroler niezależnie odczytał SQLite
(ARCHIVED, EUR 360.2, MANUAL_AMOUNT 1500, koszt VOID PLN 1500/1500/0), obejrzał
desktop NBP/kurs ręczny i ekran mobilny. Browser/server cleanup potwierdzone.
Harness-only SPEC oraz QUALITY po `d66e76d`: oba PASS, 4/4 testów konfiguracji.

## Końcowa bramka i wdrożenie

Granice wdrożenia: aktualizacja istniejącej aplikacji WallDecor-App w kontekście
`wallvps`, UUID `pwc0sk0w8cw8k8wkgwokgogk`, repozytorium produkcyjne `main`.
Nie zmieniamy zmiennych, domen, wolumenów, seedowania ani procesu AI.
Przed push ponownie odczytać zdalny commit, a przed restartem wykonać i
sprawdzić prywatny snapshot SQLite oraz kopię oryginałów. Startup dodatkowo
wykonuje `.backup` i `migrate deploy`, z potwierdzonym `WALLDECOR_SKIP_SEED=true`.

Preflight 2026-09-14 przed push: zdalny main nadal `bcd35a9`, docelowa
aplikacja/repo/domena bez zmian. Kopia `/data/backups/eur-20260914-NNfdiJ`
zawiera `walldecor.db` (9179136 B) i `invoice-files.tar.gz` (34574 B).
SQLite integrity PASS, foreign_key_check bez naruszeń; archiwum odczytywalne,
3 wpisy. Katalog 700, oba pliki 600; SHA-256 obliczone na serwerze.

Rollback wymaga uwagi: nowe pole `conversion` w JSON i liście pól ręcznych
jest nieznane starym ścisłym parserom. Po zapisaniu nowych danych nie wolno
po prostu uruchomić starego obrazu ani przywrócić całej bazy, tracąc nowsze
zmiany użytkownika. Preferowana naprawa to kolejny kompatybilny commit.
Powrót do starego kodu jest dopuszczalny tylko po potwierdzeniu braku zapisów
nowego formatu; odtwarzanie danych wymaga osobnej decyzji operatora.

- [x] `npm test -- __tests__/unit/invoice-import __tests__/integration/invoice-import` — wszystko zielone.
- [x] `npm run typecheck:app` i `npm run build` — poprawny rzeczywisty build Next.js 16.
- [x] `node scripts/validate-invoice-eur-ui.mjs` z parametrami opisanymi przez walidator; zapis outputu dowodowego, bez sekretów.
- [x] Pełny audyt interakcji zmienionego UI: działające przyciski, edycja, zapis/odczyt, archiwizacja, trwałość po restarcie, bajty pobrania i odmowa dla nieuprawnionej roli.
- [x] Niezależny końcowy code review. Błędy ważne zamknięte przed publikacją.
- [ ] Zgodnie z `coolify-deploy`: sprawdzić aktualny HEAD produkcji, backup, skip-seed, stan kolejki i schedulerów; nie nadpisywać obcych zmian. Push i deploy dopiero po bramkach. Nie wznawiać/pauzować usług bez potrzeby, a każdą wymaganą pauzę jawnie odtworzyć.
- [ ] Odczyt rzeczywistego wdrożonego commita i health. Publiczny podgląd oryginału przez proxy w osobnej karcie, bez odświeżania niezapisanego formularza użytkownika. Ewentualna konieczność zamknięcia/odświeżenia tego formularza wymaga uzgodnienia z użytkownikiem.
- [ ] Raport DOWÓD rozdziela: kod/testy, izolowany flow, push, wdrożony commit, zweryfikowany rezultat publiczny i wszelkie pozostałe blokery.
