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

- [ ] RED: testy rachunku: `360.20 × 4.25 = 1530.85`, `0.01 × 4.255 = 0.04`, brak netto/VAT pozostaje null; kurs zerowy/ujemny/nieskończony/niepoprawny jest odrzucany. BigInt lub równoważne dokładne dziesiętne mnożenie, bez błędów binarnych float przy zaokrągleniu half-up do groszy.
- [ ] GREEN: schema metadanych, parser kursu i funkcja `convertEurAmounts` używane przez serwer i formularz. Ograniczyć długość i precyzję wejścia, sprawdzać bezpieczny zakres groszy. Eksporty i argumenty udokumentować w pliku testów.
- [ ] RED: test NBP z wstrzykiwanym Fetch: dla zapłaty 2026-09-14 wynik pochodzi z 2026-09-11; wynik z dnia zapłaty, inna waluta/tabela, niepełna odpowiedź, timeout, błędna/future data nie mogą dać ważnego kursu.
- [ ] GREEN: `getNbpEurRate(paymentDate, dependencies)` pobiera wyłącznie stały host i ścieżkę `https://api.nbp.pl/api/exchangerates/rates/a/eur/{start}/{end}/?format=json`. `end` to dzień przed zapłatą, `start` to 31 dni wcześniej. Ograniczony timeout i rozmiar odpowiedzi, brak przekierowań na obcy host, walidacja Zod, wybór najpóźniejszej poprawnej tabeli. Dziś wyznaczać w strefie Europe/Warsaw. Brak wyników to czytelny błąd z możliwością ręcznego kursu, nie kurs dzisiejszy.
- [ ] RED: test endpointu: niezalogowany 401, nieaktywny/inny niż ADMIN 403, poprawna data daje JSON kursu, nieprawidłowa 422, niedostępny NBP bez surowych szczegółów 502/503. Endpoint `GET ?paymentDate=YYYY-MM-DD` nie przyjmuje dowolnego URL ani danych faktury.
- [ ] GREEN: użyć istniejącego `respond`/`actor` w `http.ts`; route Node.js, force-dynamic, wywołuje handler. Klient waliduje wynik przed użyciem. Wstrzykiwanie pobierania kursu w handlerach ułatwia test bez prawdziwego NBP.
- [ ] RED: integracyjne testy zapisu i zatwierdzania sprawdzają metadane po odczycie, audyt, kontrolę wersji, unieważnienie potwierdzenia po zmianie `paidAt`, kursu i kwot PLN; niezgodna kwota wyliczona nie może zostać zatwierdzona. Stary szkic bez metadanych nadal działa.
- [ ] GREEN: rozszerzyć opcjonalny kontrakt i listę pól chronionych. W `editDraft` walidować spójność merged danych z metadanymi; zapis nieukończonego szkicu dozwolony, zatwierdzenie wymaga kompletnej zgodnej podstawy. `approval-policy` ponownie sprawdza kurs i wynik, aby ominiecie UI nie ominęło kontroli. Przeliczenie NBP nie może mieć fałszywie oznaczonej daty/tabeli; weryfikować źródło po stronie serwera przed przyjęciem nowej potwierdzonej podstawy, poza długą transakcją DB. Nie pobierać kursu przy każdym odczycie ani przeliczać już zatwierdzonych kosztów.
- [ ] RED/GREEN: przyjęcie danych KSeF ze zmienionym `paidAt` unieważnia istniejące potwierdzenie, tak jak zmiana kwot. Test usługi zachowuje ślad tej zmiany w audycie; metadane nie znikają bez decyzji operatora.
- [ ] Uruchomić testy nowych modułów oraz integracyjne testy zmienionych usług. Commit tylko własnych plików. Przegląd zgodności i jakości.

## Task 3 — Operator przelicza, poprawia, zapisuje i ponownie otwiera

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

## Końcowa bramka i wdrożenie

- [ ] `npm test -- __tests__/unit/invoice-import __tests__/integration/invoice-import` — wszystko zielone.
- [ ] `npm run typecheck:app` i `npm run build` — poprawny rzeczywisty build Next.js 16.
- [ ] `node scripts/validate-invoice-eur-ui.mjs` z parametrami opisanymi przez walidator; zapis outputu dowodowego, bez sekretów.
- [ ] Pełny audyt interakcji zmienionego UI: działające przyciski, edycja, zapis/odczyt, archiwizacja, trwałość po restarcie, bajty pobrania i odmowa dla nieuprawnionej roli.
- [ ] Niezależny końcowy code review. Błędy ważne zamknięte przed publikacją.
- [ ] Zgodnie z `coolify-deploy`: sprawdzić aktualny HEAD produkcji, backup, skip-seed, stan kolejki i schedulerów; nie nadpisywać obcych zmian. Push i deploy dopiero po bramkach. Nie wznawiać/pauzować usług bez potrzeby, a każdą wymaganą pauzę jawnie odtworzyć.
- [ ] Odczyt rzeczywistego wdrożonego commita i health. Publiczny podgląd oryginału przez proxy w osobnej karcie, bez odświeżania niezapisanego formularza użytkownika. Ewentualna konieczność zamknięcia/odświeżenia tego formularza wymaga uzgodnienia z użytkownikiem.
- [ ] Raport DOWÓD rozdziela: kod/testy, izolowany flow, push, wdrożony commit, zweryfikowany rezultat publiczny i wszelkie pozostałe blokery.
