# Dowód — Loop 4 planu walldecor-bridge: przychody z Subiekta obok wpisanych, „Zastosuj”

Data: 2026-11-02 · gałąź `feat/subiekt-bridge-revenue` (od `main` 5846188) · plan: `PLAN-WALLDECOR-BRIDGE-2026-11-01.md` (repo walldecor-portal), Loop 4, decyzje 6a/6b/6c/7.

Mostek walldecor-bridge powstaje równolegle; ta gałąź jest rozwijana i testowana przeciw kontraktowi REST (`GET /api/sales/summary?from&to&group_by=month_warehouse_kind`) i lokalnej atrapie (`e2e/subiekt-bridge-mock.ts` — wyłącznie fixture testowy, nie jest częścią aplikacji).

## Co powstało

| Element | Plik |
|---|---|
| Model + migracja `SubiektRevenueSnapshot` | `prisma/schema.prisma`, `prisma/migrations/20261102120000_subiekt_revenue_snapshot/migration.sql` |
| Klient REST mostka | `src/lib/finance/subiekt-bridge-client.ts` |
| Mapa magazynów, odczyt 13 mies., widok, „Zastosuj” | `src/lib/finance/subiekt-revenue.ts`, wspólny zapis `src/lib/finance/revenue-store.ts` (używany też przez `POST /api/revenue`) |
| Harmonogram 07:30 Europe/Warsaw | `src/lib/finance/subiekt-auto-sync.ts`, `src/instrumentation.ts` |
| API (ADMIN) | `src/app/api/finance/subiekt-revenue/refresh/route.ts`, `…/apply/route.ts` |
| UI `/finance/revenue` | `src/components/shared/subiekt-revenue-panel.tsx`, `revenue-actuals-grid.tsx`, `revenue-tabs.tsx`, `revenue-ui.module.css`, `src/app/(dashboard)/finance/revenue/page.tsx` |
| Czat finansowy | `src/lib/ai/finance-context.ts` (blok `subiektRevenue` + zdanie interpretacji), `src/lib/ai/chat-http.ts` (ładowanie serwerowe, błąd odczytu nie blokuje czatu) |
| Konfiguracja | `.env.example`: `SUBIEKT_BRIDGE_URL`, `SUBIEKT_BRIDGE_TOKEN`, `SUBIEKT_BRIDGE_WAREHOUSE_MAP`, `SUBIEKT_BRIDGE_AUTO_SYNC` |
| Testy | `__tests__/unit/finance/subiekt-revenue-mapping.test.ts` (20), `subiekt-bridge-client.test.ts` (7), `subiekt-auto-sync.test.ts` (10), `subiekt-revenue-ui.test.tsx` (9), `finance-context.test.ts` (+1: blok i zdanie interpretacji), `__tests__/integration/finance/subiekt-revenue.test.ts` (18, świeża baza SQLite z migracji), `__tests__/integration/finance/subiekt-auto-sync-scheduler.test.ts` (1: prawdziwy tick harmonogramu przeciw atrapie HTTP), `e2e/finance-revenue-subiekt.spec.ts`, `scripts/validate-subiekt-revenue.mjs` |

## Odstępstwa od planu (świadome)

1. **Klucz snapshotu = magazyn × rodzaj, nie centrum × kanał.** Plan §2.4 zakładał `@@unique([year, month, costCenterId, channel])`. Zapis surowego odczytu (`warehouseSymbol`, `kind`) z wynikiem mapowania w kolumnach `costCenterId`/`channel` (null = nieprzypisany) sprawia, że zmiana mapy nie wymaga ponownego odczytu, a magazyn spoza mapy nie ginie (jest listowany jako ostrzeżenie). Widok agreguje do komórek miesiąc × centrum × kanał.
2. **Harmonogram:** `src/instrumentation.ts` i `ksef-auto-sync.ts` istnieją w repo (plan miał rację) — zastosowano ten sam wzorzec: `register()` tylko w runtime Node, sprawdzenie co 5 min, jeden przebieg na slot dzienny (`subiekt_bridge.auto_sync_slot`), slot zajmowany przed wywołaniem sieci, nadrabianie po restarcie. Różnica wobec KSeF: harmonogram startuje **wyłącznie** przy `SUBIEKT_BRIDGE_AUTO_SYNC=on` (także na produkcji), zgodnie z poleceniem „domyślnie off”.
3. **Role:** `/finance/revenue` jest w tym repo stroną wyłącznie dla ADMIN (inne role są przekierowywane do `/finance`), więc punkt planu „STAFF/MANAGER widzą kolumnę bez przycisków” nie ma zastosowania; widok „Cała firma” pokazuje sumy z Subiekta bez przycisków.
4. **Stan ostatniego odczytu** w `AppSetting` (`subiekt_bridge.last_fetch_at`, `last_error`, `last_error_at`), bez osobnej tabeli.
5. **ECOMMERCE** dostaje kwotę z Subiekta tylko przez wpis mapy z wymuszonym kanałem (`INT:PUL:ECOMMERCE`); bez niego komórka pokazuje „Subiekt: —” i nie ma przycisku. Próba „Zastosuj” kanału niedozwolonego dla centrum kończy się błędem walidacji `RevenueEntrySchema` (test integracyjny).
6. **Magazyn z mapy bez dokumentów (np. INT) nie dostaje wiersza ani ostrzeżenia** — zgodnie z zadaniem 5 i §0.2 planu („brak wiersza, nie zero”), a nie z dosłownym brzmieniem dopisku 6b, który sugerował wiersz zerowy. Komórka pokazuje „Subiekt: —” bez przycisku; test integracyjny „mapped warehouse the bridge returns no rows for”.
7. **Rodzaj pozycji `INNE`** (kontrakt mostka dopuszcza `kind` inny niż TOWAR/USLUGA): wiersz jest zapisywany w snapshocie (CHECK migracji rozszerzony o `INNE` — migracja była tylko na tej niezmergowanej gałęzi, nigdzie nie wdrożona, więc poprawiona w miejscu zamiast dokładać drugą), nigdy nie trafia do komórki ani do „Zastosuj”, a w panelu pojawia się ostrzeżenie „nieobsługiwany rodzaj pozycji INNE (magazyn X, mies rok): kwota”. Testy: mapowanie, agregacja, integracyjny (łącznie z liczbami jako napisami z mostka — `z.coerce.number()`), UI.

## Poprawki po przeglądzie PR #37 (2026-11-02)

- Zdanie interpretacji bloku `subiektRevenue` w `finance-context.ts` (brutto wg daty wystawienia, `difference = subiektGross − enteredAmount`, `enteredAmount: null` = brak wpisu nie zero, znaczenie `lastError`/`unmapped`) + test jednostkowy sprawdzający blok i zdanie.
- Harmonogram: `refreshSubiektRevenue` w `try/catch`; rzucony błąd (np. zablokowana baza) zapisuje `auto_sync_status=ERROR` z ogólnym komunikatem po polsku **i przywraca poprzedni slot**, więc następne sprawdzenie (5 min) ponawia próbę; błąd mostka obsłużony (`{ok:false}`) nadal zużywa slot. Test: rzucony błąd → slot nietknięty → drugi tick kończy się OK. Tick wydzielony do `runSubiektAutoSyncTick(db, now, log)` (jedna linia JSON na przebieg).
- `applySubiektRevenueMonth` działa w jednym `db.$transaction` — odmowa któregoś kanału nie zostawia częściowo zapisanego miesiąca (test integracyjny: 0 wierszy `Revenue` po odmowie).
- Siatka: `router.refresh()` w `finally` (także po błędzie „Zastosuj”), `aria-describedby` z przycisku edycji na wiersz „Subiekt: …” tej komórki (test UI).
- `RevenueTabs` dostaje jawne `isAdmin` (strona przekazuje `session.user.role === 'ADMIN'`); „Odczytaj teraz” widoczne tylko dla admina.
- Klient mostka: liczby przez `z.coerce.number()` (DECIMAL serializowany jako napis), `kind` dopuszcza `INNE`; przy błędnym kształcie odpowiedzi ścieżki pól zod trafiają wyłącznie do logu serwera (`SUBIEKT_BRIDGE_INVALID_RESPONSE`), komunikat dla klienta pozostaje ogólny.

### Harmonogram uruchomiony raz lokalnie (test integracyjny `subiekt-auto-sync-scheduler.test.ts`)

Świeża baza SQLite z łańcucha migracji, atrapa HTTP mostka z pakietu Playwright na losowym porcie, konfiguracja wyłącznie z `process.env` (jak w produkcji), slot ustawiony na wczoraj (`2026-11-01`), zegar `2026-11-02T07:00:00Z` = 08:00 Europe/Warsaw (po 07:30):

```
SCHEDULER-PROOF log: {"event":"SUBIEKT_AUTO_SYNC","ran":true,"slot":"2026-11-02","status":"OK","message":"Odczytano 2 wierszy z Subiekta."}
SCHEDULER-PROOF fetchedAt: 2026-11-02T07:00:00.000Z last_fetch_at: 2026-11-02T07:00:00.000Z
```

Sprawdzone w tym samym teście: jedno wywołanie `GET /api/sales/summary?from=2025-11-01&to=2026-11-02&group_by=month_warehouse_kind` z nagłówkiem `Authorization: Bearer <token>`, dwa snapshoty (`PUŁ→PUL/SALON 12 345,67`, `MAG→JAG/MONTAZ 2 300`) z `fetchedAt` równym zegarowi ticku, `subiekt_bridge.auto_sync_slot=2026-11-02`, `auto_sync_status=OK`, tabela `Revenue` pusta (harmonogram nie stosuje), drugi tick 5 min później → `NOT_DUE` bez drugiego wywołania mostka.

## Bramka (uruchomione 2026-11-02, Mac, Node v26.7.0)

```
npm test                 → Test Files 1 failed | 301 passed | 2 skipped (304); Tests 11 failed | 3803 passed | 2 skipped (3816)
                           jedyny FAIL: __tests__/unit/finance/ksef-sync.test.ts (11) — pada identycznie na czystym main 5846188 (sprawdzone po git stash); niezwiązany z tą gałęzią
npm run typecheck:app    → ✓ Types generated successfully, tsc bez błędów
npm run build            → ✓ Compiled successfully; nowe trasy ƒ /api/finance/subiekt-revenue/apply, ƒ /api/finance/subiekt-revenue/refresh
npx playwright test finance-revenue-subiekt → 1 passed (10.5s)
node --preserve-symlinks --import tsx scripts/validate-subiekt-revenue.mjs → All Subiekt revenue checks passed (15/15)
```

### Walidator (`scripts/validate-subiekt-revenue.mjs`) — wynik z 2026-11-02

Świeża baza SQLite z `prisma migrate deploy`, atrapa mostka na losowym porcie, prawdziwy `fetch`, odczyt `Revenue` przez `sqlite3`:

```
OK   refresh ok with 4 rows and ZEW unmapped
OK   bridge called with bearer token
OK   sqlite3: 4 snapshot rows stored
OK   view: PUL cells
OK   view: unmapped ZEW listed
OK   sqlite3: manual value before apply
OK   apply ok
OK   sqlite3: Revenue replaced by Subiekt amount with last day of month
OK   apply month ok (2 channels)
OK   sqlite3: both PUL channels written
OK   apply negative correction month for JAG
OK   ECOMMERCE without a forced-map warehouse is refused
OK   bridge down → refresh reports unavailable
OK   bridge down → last snapshot kept
OK   bridge down → view keeps fetchedAt and exposes the error

All Subiekt revenue checks passed.
```

Wiersz z bazy po „Zastosuj” (sqlite3): `SELECT amount, asOfDate FROM Revenue WHERE year=2026 AND month=10 AND costCenterId='PUL' AND channel='SALON'` → przed: `9000.0|2026-10-20`, po: `10000.0|2026-10-31`.

### Scenariusz Playwright (`e2e/finance-revenue-subiekt.spec.ts`)

Izolowana baza E2E, ADMIN z `global-setup`, atrapa mostka na porcie 38787 (`SUBIEKT_BRIDGE_URL` w env serwera testowego). Kroki wykonane i sprawdzone asercjami:

1. Ręczny wpis 10 000 zł (PUL/SALON, poprzedni miesiąc) przez `/api/revenue`.
2. `/finance/revenue?costCenterId=PUL`: status „Brak odczytu z Subiekta”, komórki „Subiekt: —”, brak przycisków „Zastosuj”.
3. „Odczytaj teraz” → „Odczytano 4 wierszy z Subiekta. Nieprzypisane magazyny: ZEW.”; komórka SALON: `12 345,67 zł · dok. 14 · różnica +2 345,67 zł`; MONTAZ `2 300,00 zł`; ECOMMERCE „Subiekt: —” bez przycisku; blok „nieprzypisany magazyn ZEW … 77,77 zł”; atrapa odnotowała wywołanie `/api/sales/summary?…` z nagłówkiem `Bearer e2e-subiekt-bridge-token`. Zrzut: `subiekt-revenue-2026-11-02/01-po-odczycie.png`.
4. „Zastosuj” (SALON) → komunikat „Zastosowano z Subiekta (…)”, wpisana kwota = 12 345,67 zł, dopisek „zgodne”; **wiersz `Revenue` odczytany Prismą z bazy E2E: amount 12345.67, asOfDate = ostatni dzień miesiąca.** Zrzut: `02-po-zastosuj.png`.
5. Przeładowanie strony → kwota nadal 12 345,67 zł.
6. „Zastosuj wszystkie w miesiącu” → MONTAZ w bazie = 2300.
7. „Cała firma”: SALON = 12 345,67 + 4 100,50 (MAG→JAG) zł, zero przycisków „Zastosuj”. Zrzut: `03-cala-firma.png`.
8. Zatrzymanie atrapy → „Odczytaj teraz” pokazuje „Mostek Subiekt jest niedostępny…” (bez stack trace), status „Mostek niedostępny — dane z <data>”, ostatni snapshot widoczny, „Zastosuj” dla JAG/SALON działa (4 100,50 zł zapisane w bazie). Zrzut: `04-mostek-niedostepny.png`.

## Checklist audytu atrap (plan §5, punkty dotyczące aplikacji)

- [x] Każdy widoczny element na `/finance/revenue` związany z Subiektem kliknięty w e2e: „Odczytaj teraz”, „Zastosuj”, „Zastosuj wszystkie w miesiącu”; brak przycisku tam, gdzie nie ma danych (ECOMMERCE, Cała firma, przed odczytem).
- [x] „Zastosuj” sprawdzone w bazie (`Revenue` przez Prismę w e2e i przez `sqlite3` w walidatorze), nie tylko na ekranie; po przeładowaniu wartość jest.
- [x] Wyłączony mostek: czytelny błąd po polsku, nic się nie wiesza, ostatni snapshot zostaje, „Zastosuj” nadal działa.
- [x] Dane w UI pochodzą z bazy aplikacji (snapshoty), a snapshoty z odpowiedzi HTTP mostka — brak stałych w kodzie; miesiąc bez dokumentów nie ma wiersza (test „absence, not zero”).
- [x] Token nie trafia do przeglądarki (tylko server components / route handlers; brak `NEXT_PUBLIC_`), komunikaty błędów nie zawierają tokena (test klienta).
- [ ] Porównanie z SSMS / raportem sprzedaży GT — wymaga prawdziwego mostka (niżej).

## Do wykonania przez użytkownika (poza tą gałęzią)

- Uruchomienie walldecor-bridge na PC `SERWER` i Tailscale na VPS Coolify (Loop 0–1 planu mostka), token ze scope `sales:read` dla aplikacji.
- W Coolify (app `pwc0sk0w8cw8k8wkgwokgogk`): `SUBIEKT_BRIDGE_URL`, `SUBIEKT_BRIDGE_TOKEN`, `SUBIEKT_BRIDGE_WAREHOUSE_MAP`, `SUBIEKT_BRIDGE_AUTO_SYNC=on`; wdrożenie wg `docs/GITHUB-ACTIONS-BUILD.md` (migracja `SubiektRevenueSnapshot` przez `migrate deploy` w entrypoint).
- DoD planu wymagające prawdziwych danych: komórka 2026-10 / PUL / SALON równa `sales_summary` (magazyn PUŁ, TOWAR); porównanie 2 miesięcy z raportem „Sprzedaż wg magazynów” w GT przed pierwszym „Zastosuj”; log harmonogramu na produkcji po 07:30; pytanie w czacie finansowym o różnicę Puławskiej z kontrolą, że w logu mostka nie ma wywołań z tokena aplikacji w czasie pytania.
- Decyzja: czy pierwsze „Zastosuj” ma objąć tylko zamknięty miesiąc (plan Loop 7).
