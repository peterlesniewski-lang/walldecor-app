# Faktury UE z Subiekta + uzgodnienie płatności — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faktury zakupu od dostawców z UE wprowadzane raz — w Subiekcie GT (FZ/KFZ, już w PLN) — pojawiają się automatycznie w WallDecor-App, a aplikacja pokazuje listę faktur opłaconych w aplikacji, które trzeba jeszcze rozliczyć w Subiekcie (oraz odwrotnie).

**Architecture:** Mostek `walldecor-bridge` zostaje tylko do odczytu; dostaje narzędzie `purchase_documents` (FZ + KFZ ze zobowiązaniem, terminem, walutą i numerem obcym) pod nowym zakresem `purchases:read`. Aplikacja pobiera te dokumenty miesiąc po miesiącu, zakłada brakujące faktury UE jako `KsefInvoice` z `source = "SUBIEKT"` i `externalId = "subiekt:<dok_Id>"` (bez zmiany schematu Prisma), a uzgodnienie płatności liczy na żądanie czystą funkcją porównującą status w aplikacji ze stanem zobowiązania w Subiekcie. Do Subiektu nic nie zapisujemy (droga A; Sfera — ewentualnie w osobnym planie).

**Tech Stack:** Mostek: Node 22, TypeScript, mssql, zod 4, `node --test`, SQL Edge w Dockerze. Aplikacja: Next.js 16, React 19, Prisma 5/SQLite, Zod 4, Vitest, Playwright.

---

## Zasady i granice

- Żaden widoczny element nie jest atrapą: przycisk albo działa end-to-end, albo go nie ma.
- Mostek nie dostaje prawa zapisu. Login `portal_reader` bez zmian (`DENY INSERT, UPDATE, DELETE, EXECUTE`).
- Bez migracji Prisma. Źródło i identyfikator dokumentu GT siedzą w istniejących polach `KsefInvoice.source` / `externalId`.
- Import zakłada **tylko** faktury zagraniczne (waluta ≠ PLN albo NIP z prefiksem kraju ≠ PL). Krajowe FZ przychodzą z KSeF — import ich nie dubluje; uzgodnienie płatności obejmuje natomiast **wszystkie** FZ.
- Istniejące faktury w aplikacji (dodane dotąd ręcznie / importem PDF) nie są modyfikowane przez import — dopasowanie je pomija i raportuje jako „już w aplikacji”.
- Nazwy kolumn GT dla zakupów są hipotezą do czasu Bramki A2. Wszystkie siedzą w jednym pliku (`src/queries/purchases.ts` mostka); po sondzie poprawia się tylko ten plik i seed testowy.
- Commit/push wyłącznie po potwierdzeniu użytkownika (CLAUDE.md).

## Mapa plików

### `walldecor-bridge` (osobne repo, gałąź `bridge/purchases`)

| Plik | Odpowiedzialność |
|---|---|
| `src/queries/columns.ts` (mod) | zapytania sondy dla zakupów |
| `src/main.ts` (mod) | sekcja sondy „Zakupy FZ/KFZ” |
| `src/auth.ts` (mod) | zakres `purchases:read` |
| `src/queries/purchases.ts` (nowy) | stałe typów/kolumn zakupów + SQL listy |
| `src/tools/purchase_documents.ts` (nowy) | narzędzie MCP/REST |
| `src/tools/index.ts` (mod) | rejestracja narzędzia |
| `tests/docker/seed.sql` (mod) | kolumny i dane FZ/KFZ |
| `tests/helpers.ts` (mod) | token `test-purchases` |
| `tests/purchases.test.ts` (nowy) | testy narzędzia na SQL Edge |
| `README.md` (mod) | narzędzie, zakres, token aplikacji |
| `docs/PURCHASES-PROBE-<data>.md` (nowy) | wynik sondy z SERWER i decyzje D1–D5 |

### `walldecor-app` (ten worktree)

| Plik | Odpowiedzialność |
|---|---|
| `src/lib/finance/subiekt-bridge-client.ts` (mod) | wspólny `bridgeGetJson` + `fetchPurchaseDocuments` |
| `src/lib/finance/subiekt-purchase-matching.ts` (nowy) | czyste funkcje: klucze, „zagraniczna?”, dopasowanie, klasyfikacja uzgodnienia |
| `src/lib/finance/subiekt-purchases.ts` (nowy) | pobranie okna miesięcy, import faktur UE, uzgodnienie, ustawienia statusu |
| `src/app/api/finance/subiekt-purchases/import/route.ts` (nowy) | POST — import (ADMIN) |
| `src/app/api/finance/subiekt-purchases/reconciliation/route.ts` (nowy) | GET — uzgodnienie (ADMIN) |
| `src/components/shared/subiekt-purchases-panel.tsx` (nowy) | panel na `/finance/ksef` |
| `src/app/(dashboard)/finance/ksef/page.tsx` (mod) | osadzenie panelu |
| `src/lib/finance/subiekt-auto-sync.ts` (mod) | codzienny import po odczycie sprzedaży |
| testy w `__tests__/unit/finance/` i `__tests__/integration/finance/` | patrz zadania |

---

# Część A — `walldecor-bridge`

**Realizuje Codex na PC `SERWER`** według pliku przekazania `docs/PLAN-PURCHASES-2026-11-18.md` w repo `walldecor-bridge`, gałąź `bridge/purchases` (commit `026e94f`; tam też kontrakt REST, od którego zależy Część B). Poniższa treść jest kopią referencyjną — przy rozbieżności obowiązuje plik w repo mostka. Część B realizują subagenci na Macu równolegle, testując na syntetycznych odpowiedziach zgodnych z kontraktem.

### Task A1: Sonda zakupów (`--probe`)

Cel: jeden raport z prawdziwej bazy rozstrzyga nazwy kolumn i semantykę kwot, zanim powstanie jakikolwiek SQL narzędzia.

**Files:**
- Modify: `src/queries/columns.ts`
- Modify: `src/main.ts` (funkcja `probe`, po sekcji „Rodzaje pozycji”)

- [ ] **Step 1: Dodaj zapytania sondy do `src/queries/columns.ts`**

```ts
// --- Sonda zakupów (FZ = 1, KFZ = 5) — rozstrzyga decyzje D1–D5 planu faktur UE ---

/** Kolumny dok__Dokument i nz__Finanse, które mogą nieść walutę, kurs, numer obcy, termin i kontrahenta zakupu. */
export const SQL_PURCHASE_CANDIDATE_COLUMNS = `
SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = 'dbo' AND (
       (c.TABLE_NAME = 'dok__Dokument' AND (c.COLUMN_NAME LIKE '%Wal%' OR c.COLUMN_NAME LIKE '%Kurs%' OR c.COLUMN_NAME LIKE '%Oryg%'
            OR c.COLUMN_NAME LIKE '%Termin%' OR c.COLUMN_NAME LIKE '%Otrzym%' OR c.COLUMN_NAME LIKE '%Odbiorca%' OR c.COLUMN_NAME LIKE '%Transakc%'))
    OR c.TABLE_NAME = 'nz__Finanse'
    OR (c.TABLE_NAME = 'adr_Historia' AND (c.COLUMN_NAME LIKE '%Panstw%' OR c.COLUMN_NAME LIKE '%NIP%')))
ORDER BY c.TABLE_NAME, c.COLUMN_NAME`;

/** Liczność FZ/KFZ wg typu, podtypu i statusu od @since. */
export const SQL_PURCHASE_TYPE_COUNTS = `
SELECT d.dok_Typ, d.dok_Podtyp, d.dok_Status, COUNT(*) AS ile, SUM(d.dok_WartNetto) AS netto, SUM(d.dok_WartBrutto) AS brutto,
       SUM(CASE WHEN d.dok_PlatnikId IS NULL THEN 1 ELSE 0 END) AS bez_platnika
FROM dbo.dok__Dokument d
WHERE d.dok_Typ IN (1, 5) AND d.dok_DataWyst >= ${toDatetime('@since')}
GROUP BY d.dok_Typ, d.dok_Podtyp, d.dok_Status
ORDER BY d.dok_Typ, d.dok_Podtyp, d.dok_Status`;

/** Rodzaje rozrachunków podpiętych pod FZ/KFZ od @since — który nzf_Typ to zobowiązanie (D2). */
export const SQL_PURCHASE_FINANCE_TYPES = `
SELECT d.dok_Typ, f.nzf_Typ, COUNT(*) AS wiersze, SUM(f.nzf_WartoscPierwotna) AS pierwotna, SUM(f.nzf_Wartosc) AS pozostalo,
       SUM(CASE WHEN f.nzf_TerminPlatnosci IS NULL THEN 1 ELSE 0 END) AS bez_terminu
FROM dbo.nz__Finanse f
JOIN dbo.dok__Dokument d ON d.dok_Id = f.nzf_IdDokumentAuto
WHERE d.dok_Typ IN (1, 5) AND d.dok_DataWyst >= ${toDatetime('@since')}
GROUP BY d.dok_Typ, f.nzf_Typ
ORDER BY d.dok_Typ, f.nzf_Typ`;

/**
 * 10 najnowszych FZ/KFZ z pełnym wierszem nagłówka (SELECT d.* — tylko w sondzie, nigdy w narzędziu) + NIP kontrahenta
 * i suma rozrachunków. Pokazuje na prawdziwych dokumentach, gdzie GT trzyma walutę, kurs, numer obcy i jak liczy brutto WNT (D1, D3, D4).
 */
export const SQL_PURCHASE_SAMPLES = `
SELECT TOP 10 d.*, ah.adrh_NIP AS kontrahent_nip_historia, ae.adr_NIP AS kontrahent_nip_ewid,
       (SELECT SUM(f.nzf_WartoscPierwotna) FROM dbo.nz__Finanse f WHERE f.nzf_IdDokumentAuto = d.dok_Id) AS rozrachunki_pierwotna
FROM dbo.dok__Dokument d
LEFT JOIN dbo.adr_Historia ah ON ah.adrh_Id = d.dok_PlatnikAdreshId
OUTER APPLY (SELECT TOP 1 a.adr_NIP FROM dbo.adr__Ewid a WHERE a.adr_IdObiektu = d.dok_PlatnikId AND a.adr_TypAdresu = 1 ORDER BY a.adr_Id) ae
WHERE d.dok_Typ IN (1, 5) AND d.dok_DataWyst >= ${toDatetime('@since')}
ORDER BY d.dok_DataWyst DESC, d.dok_Id DESC`;
```

- [ ] **Step 2: Dodaj sekcje do `probe()` w `src/main.ts`** (import czterech stałych; wstaw tuż po sekcji „Rodzaje pozycji…”, przed `} finally {`)

```ts
        await section('Zakupy: kolumny kandydujące (waluta, kurs, numer obcy, termin, kraj, rozrachunki)', async () => {
            const rows = await queryRows<Record<string, unknown>>(pool, SQL_PURCHASE_CANDIDATE_COLUMNS);
            for (const row of rows) print(`  ${String(row.TABLE_NAME)}.${String(row.COLUMN_NAME)} (${String(row.DATA_TYPE)})`);
        });
        await section('Zakupy: FZ (1) / KFZ (5) wg podtypu i statusu (12 mies.)', async () => {
            const rows = await queryRows<Record<string, unknown>>(pool, SQL_PURCHASE_TYPE_COUNTS, sinceParam);
            for (const row of rows) print(`  ${Object.entries(row).map(([k, v]) => `${k}=${describeValue(v)}`).join(' ')}`);
            if (rows.length === 0) print('  (brak dokumentów zakupu)');
        });
        await section('Zakupy: rodzaje rozrachunków nz__Finanse na FZ/KFZ (12 mies.)', async () => {
            const rows = await queryRows<Record<string, unknown>>(pool, SQL_PURCHASE_FINANCE_TYPES, sinceParam);
            for (const row of rows) print(`  ${Object.entries(row).map(([k, v]) => `${k}=${describeValue(v)}`).join(' ')}`);
            if (rows.length === 0) print('  (brak rozrachunków)');
        });
        await section('Zakupy: 10 najnowszych FZ/KFZ — pełny nagłówek', async () => {
            const rows = await queryRows<Record<string, unknown>>(pool, SQL_PURCHASE_SAMPLES, sinceParam);
            for (const row of rows) {
                print(`  --- dok_Id=${describeValue(row.dok_Id)}`);
                for (const [k, v] of Object.entries(row)) if (v !== null && v !== '' && v !== 0) print(`    ${k}=${describeValue(v)}`);
            }
        });
```

(Wiersze próbek drukują tylko niepuste pola — raport zostaje czytelny mimo ~150 kolumn nagłówka.)

- [ ] **Step 3: Uruchom sondę na bazie testowej** (kontrola, że SQL jest poprawny składniowo; FZ jeszcze brak w seedzie)

Run: `npm run db:test:up && npm run build`, następnie z `.env` wskazującym bazę testową (`SUBIEKT_DB_SERVER=localhost`, port `14433`, baza `WD_sp_test`, login `portal_reader` / `Reader!Test2026` — wartości z `tests/testdb.ts`): `node dist/main.js --probe`
Expected: sekcje „Zakupy: …” bez linii `BŁĄD:`, `(brak dokumentów zakupu)`, `WYNIK: OK (kod 0)`.

- [ ] **Step 4: Typecheck i testy**

Run: `npm run typecheck && npm test`
Expected: PASS (bez zmian liczby testów).

- [ ] **Step 5: Commit** (po potwierdzeniu użytkownika)

```bash
git add src/queries/columns.ts src/main.ts
git commit -m "feat(probe): report purchase invoice columns, finance types and samples"
```

### Task A2: BRAMKA — sonda na SERWER i decyzje D1–D5

Wymaga człowieka przy PC `SERWER`. Bez tego raportu nie zaczynamy A3+.

- [ ] **Step 1: Użytkownik na SERWER:** `git pull && npm ci && npm run build && node dist\main.js --probe`; odsyła `logs\probe-RRRR-MM-DD.txt`.
- [ ] **Step 2: Z raportu zapisz `docs/PURCHASES-PROBE-<data>.md`** z odpowiedziami (każda z cytatem linii raportu jako dowodem):

| Id | Pytanie | Hipoteza planu |
|---|---|---|
| D1 | Kolumny waluty, kursu i numeru obcego faktury w `dok__Dokument` | `dok_Waluta`, `dok_WalutaKurs`, `dok_NrPelnyOryg` |
| D2 | `nzf_Typ` zobowiązania na FZ (i jak wygląda na KFZ) | `40` |
| D3 | Kontrola (decyzja biznesowa już podjęta 2026-11-18: faktura WNT nie zawiera polskiego VAT, kwota faktury = kwota płacona dostawcy): czy w próbkach `dok_WartBrutto` = `rozrachunki_pierwotna` na FZ UE | równe; jeżeli GT dolicza VAT naliczony samodzielnie do `dok_WartBrutto`, `toInvoiceAmounts` (Task B3) bierze `payable` zamiast `gross_total` |
| D4 | Gdzie GT trzyma identyfikator VAT UE dostawcy (`adrh_NIP` z prefiksem kraju czy osobne pole kraju) | `adrh_NIP` / `adr_NIP`, np. `DE123456789` |
| D5 | Czy `dok_PlatnikId` / `dok_PlatnikAdreshId` wskazują dostawcę na FZ (kolumna `bez_platnika` ≈ 0) | tak |

- [ ] **Step 3: Jeżeli którakolwiek hipoteza jest fałszywa** — popraw wyłącznie stałe w `src/queries/purchases.ts` (Task A4) i kolumny w `tests/docker/seed.sql`, a w tym planie dopisz pod tabelą „Korekta po sondzie: …”. Pozostałe zadania nie zmieniają się.
- [ ] **Step 4: Commit dokumentu sondy** (po potwierdzeniu)

```bash
git add docs/PURCHASES-PROBE-*.md
git commit -m "docs(bridge): purchase probe evidence and decisions D1-D5"
```

### Task A3: Zakres `purchases:read`

**Files:**
- Modify: `src/auth.ts:4`
- Modify: `tests/helpers.ts`
- Test: `tests/auth.test.ts`

- [ ] **Step 1: Test (czerwony)** — dopisz do `tests/auth.test.ts`:

```ts
test('parseTokens akceptuje zakres purchases:read', () => {
    const [record] = parseTokens(`walldecor-app:sales:read,purchases:read:${'a'.repeat(64)}`);
    assert.deepEqual([...(record?.scopes ?? [])].sort(), ['purchases:read', 'sales:read']);
});
```

- [ ] **Step 2: Run** `node --test tests/auth.test.ts` → FAIL `nieznane zakresy purchases:read`.
- [ ] **Step 3: Implementacja** — `src/auth.ts`:

```ts
export const SCOPES = ['sales:read', 'documents:read', 'contractors:read', 'finance:read', 'purchases:read'] as const;
```

oraz w `tests/helpers.ts`: `ALL_SCOPES` dostaje `'purchases:read'`, a `testConfig` czwarty token:

```ts
    const purchases = newTokenLine('test-purchases', ['purchases:read']);
    // tokens: parseTokens([full.line, sales.line, finance.line, purchases.line].join(';'))
    // return: tokens: { full: full.token, sales: sales.token, finance: finance.token, purchases: purchases.token }
```

(i typ `TestBridge['tokens']`: `{ full: string; sales: string; finance: string; purchases: string }`).

- [ ] **Step 4: Run** `node --test tests/auth.test.ts` → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(auth): add purchases:read scope`

### Task A4: Seed FZ/KFZ i stałe zakupów

**Files:**
- Create: `src/queries/purchases.ts` (tylko stałe w tym zadaniu)
- Modify: `src/queries/columns.ts` (`REQUIRED_COLUMNS.dok__Dokument`)
- Modify: `tests/docker/seed.sql`

- [ ] **Step 1: `src/queries/purchases.ts` — stałe (jedyne miejsce zależne od D1–D2)**

```ts
// SQL narzędzia purchase_documents. Nazwy kolumn zakupów potwierdzone sondą: docs/PURCHASES-PROBE-<data>.md (D1–D5).
import { toDatetime } from './columns.ts';
import { CONTRACTOR_JOINS, CONTRACTOR_NAME_SQL } from './documents.ts';

export const PURCHASE_DOC_TYPE_CODE = { FZ: 1, KFZ: 5 } as const;
/** nz__Finanse.nzf_Typ zobowiązania (D2). */
export const LIABILITY_FINANCE_TYPE = 40;
/** Kolumny nagłówka zakupu (D1). */
export const PURCHASE_COLUMNS = {
    originalNumber: 'dok_NrPelnyOryg',
    currency: 'dok_Waluta',
    exchangeRate: 'dok_WalutaKurs',
} as const;
```

- [ ] **Step 2: `REQUIRED_COLUMNS.dok__Dokument`** — dopisz `'dok_NrPelnyOryg', 'dok_Waluta', 'dok_WalutaKurs'` (sonda wtedy pilnuje ich obecności przy każdym starcie wdrożenia).

- [ ] **Step 3: Seed** — w `tests/docker/seed.sql` w `CREATE TABLE dbo.dok__Dokument` dopisz kolumny:

```sql
    dok_NrPelnyOryg varchar(60) NULL,
    dok_Waluta varchar(3) NOT NULL DEFAULT 'PLN',
    dok_WalutaKurs money NOT NULL DEFAULT 1,
```

Na końcu pliku (nowa partia):

```sql
-- Zakupy (FZ 1, KFZ 5): dostawca UE (EUR, WNT, brutto = netto), dostawca krajowy (PLN, KSeF). Zobowiązanie nz__Finanse typ 40.
INSERT INTO dbo.kh__Kontrahent VALUES (15, N'TAPETEN-DE', 0, NULL), (16, N'HURT-PL', 0, NULL);
INSERT INTO dbo.adr_Historia VALUES (1005, 15, N'Tapeten GmbH', N'Tapeten Fabrik GmbH', 'DE 123 456 789'), (1006, 16, N'Hurt PL', N'Hurt PL Sp. z o.o.', '526-000-00-00');
INSERT INTO dbo.ksef_NumerKSeF VALUES (3, '5260000000-20261010-ABCDEF000003-03', '2026-10-10 12:00:00');
GO
INSERT INTO dbo.dok__Dokument (dok_Id, dok_Typ, dok_Podtyp, dok_Status, dok_NrPelny, dok_DataWyst, dok_DoDokId, dok_DoDokNrPelny, dok_PlatnikId, dok_PlatnikAdreshId, dok_MagId, dok_WartNetto, dok_WartBrutto, dok_StatusFiskal, dok_StatusKSeF, dok_NumerKSeFId, dok_NrPelnyOryg, dok_Waluta, dok_WalutaKurs) VALUES
    (30, 1, 0, 1, 'FZ 1/MAG/10/2026',  '2026-10-03', NULL, NULL,               15, 1005, 1, 4250.00, 4250.00, 0, 0, NULL, 'RE-2026-0042',   'EUR', 4.2500),
    (31, 1, 0, 1, 'FZ 2/MAG/10/2026',  '2026-10-08', NULL, NULL,               15, 1005, 1, 2125.00, 2125.00, 0, 0, NULL, 'RE-2026-0050',   'EUR', 4.2500),
    (32, 1, 0, 1, 'FZ 3/MAG/10/2026',  '2026-10-10', NULL, NULL,               16, 1006, 1,  100.00,  123.00, 0, 5, 3,    'FV 10/10/2026',  'PLN', 1.0000),
    (33, 5, 0, 1, 'KFZ 1/MAG/10/2026', '2026-10-20', 30,   'FZ 1/MAG/10/2026', 15, 1005, 1, -425.00, -425.00, 0, 0, NULL, 'RE-2026-0042-K', 'EUR', 4.2500),
    (34, 1, 0, 1, 'FZ 9/MAG/12/2025',  '2025-12-15', NULL, NULL,               15, 1005, 1,  850.00,  850.00, 0, 0, NULL, 'RE-2025-0999',   'EUR', 4.2500);
GO
INSERT INTO dbo.nz__Finanse (nzf_Id, nzf_IdDokumentAuto, nzf_Typ, nzf_Wartosc, nzf_WartoscPierwotna, nzf_TerminPlatnosci) VALUES
    (9020, 30, 40, 4250.00, 4250.00, '2026-10-17'),
    (9021, 31, 40,    0.00, 2125.00, '2026-10-22'),
    (9022, 32, 40,  123.00,  123.00, '2026-10-24'),
    (9023, 34, 40,    0.00,  850.00, '2025-12-29');
GO
```

(KFZ 1 celowo bez zobowiązania — `remaining` i `is_paid` mają wtedy być `null`.)

- [ ] **Step 4: Run** `npm run db:test:up && npm test`
Expected: PASS — istniejące testy sprzedaży/należności filtrują po `dok_Typ` i `nzf_Typ = 39`, więc nowe wiersze ich nie ruszają. Jeżeli któryś test liczy wszystkie wiersze tabeli — popraw oczekiwanie i opisz w commicie.
- [ ] **Step 5: Commit** `test(bridge): seed purchase invoices FZ/KFZ with liabilities`

### Task A5: Narzędzie `purchase_documents`

**Files:**
- Modify: `src/queries/purchases.ts`
- Create: `src/tools/purchase_documents.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/purchases.test.ts`

- [ ] **Step 1: Test (czerwony)** — `tests/purchases.test.ts`:

```ts
// purchase_documents na SQL Edge: FZ/KFZ, zobowiązania typ 40, numer obcy, waluta, NIP UE z prefiksem.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, findTool, ToolError } from '../src/tools/registry.ts';
import { getJson, startTestBridge, type TestBridge } from './helpers.ts';

let t: TestBridge;
before(async () => { t = await startTestBridge(); });
after(async () => { await t?.stop(); });

type Row = Record<string, unknown>;
const run = async (input: Record<string, unknown>) => {
    const tool = findTool(t.runtime, 'purchase_documents');
    assert.ok(tool);
    const token = t.runtime.config.tokens.find((x) => x.name === 'test-purchases');
    assert.ok(token);
    return executeTool(t.runtime, tool, input, { facade: 'rest', token });
};
const code = async (input: Record<string, unknown>) => {
    try { await run(input); return 'ok'; } catch (e) { return e instanceof ToolError ? e.code : String(e); }
};

test('purchase_documents październik 2026: 4 dokumenty, najnowsze pierwsze', async () => {
    const { structuredContent: out } = await run({ from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual((out.rows as Row[]).map((r) => r.number), ['KFZ 1/MAG/10/2026', 'FZ 3/MAG/10/2026', 'FZ 2/MAG/10/2026', 'FZ 1/MAG/10/2026']);
    assert.deepEqual([out.truncated, (out.total as Row).documents], [false, 4]);
});

test('purchase_documents: FZ UE niezapłacona — numer obcy, EUR, kurs, NIP z prefiksem, zobowiązanie i termin', async () => {
    const { structuredContent: out } = await run({ from: '2026-10-01', to: '2026-10-31' });
    const fz1 = (out.rows as Row[]).find((r) => r.id === 30);
    assert.deepEqual(fz1, {
        id: 30, type: 'FZ', number: 'FZ 1/MAG/10/2026', original_number: 'RE-2026-0042', issued_at: '2026-10-03', parent_id: null,
        supplier_name: 'Tapeten Fabrik GmbH', supplier_tax_id: 'DE123456789', currency: 'EUR', exchange_rate: 4.25,
        net_total: 4250, gross_total: 4250, ksef_number: null, payable: 4250, remaining: 4250, is_paid: false, due_date: '2026-10-17',
    });
});

test('purchase_documents: zapłacona FZ → is_paid true; KFZ bez zobowiązania → is_paid null; FZ krajowa z KSeF', async () => {
    const { structuredContent: out } = await run({ from: '2026-10-01', to: '2026-10-31' });
    const byId = new Map((out.rows as Row[]).map((r) => [r.id, r]));
    assert.deepEqual([byId.get(31)?.is_paid, byId.get(31)?.remaining], [true, 0]);
    assert.deepEqual([byId.get(33)?.type, byId.get(33)?.parent_id, byId.get(33)?.is_paid, byId.get(33)?.remaining, byId.get(33)?.payable], ['KFZ', 30, null, null, null]);
    assert.deepEqual([byId.get(32)?.supplier_tax_id, byId.get(32)?.currency, byId.get(32)?.ksef_number], ['5260000000', 'PLN', '5260000000-20261010-ABCDEF000003-03']);
});

test('purchase_documents: limit, zakres i zakres tokena', async () => {
    const cut = await run({ from: '2026-10-01', to: '2026-10-31', limit: 2 });
    assert.deepEqual([(cut.structuredContent.rows as Row[]).length, cut.structuredContent.truncated, (cut.structuredContent.total as Row).documents], [2, true, 4]);
    assert.equal(await code({ from: '2024-01-01', to: '2026-10-31' }), 'RANGE_TOO_WIDE');
    assert.equal(await code({ from: '2026-10-01', to: '2026-10-31', limit: 1000 }), 'LIMIT_EXCEEDED');
    const rest = await getJson(`${t.url}/api/purchases/documents?from=2026-10-01&to=2026-10-31`, t.tokens.purchases);
    assert.equal(rest.status, 200);
    assert.equal((await getJson(`${t.url}/api/purchases/documents?from=2026-10-01&to=2026-10-31`, t.tokens.sales)).status, 403);
});
```

- [ ] **Step 2: Run** `node --test tests/purchases.test.ts` → FAIL (`findTool` zwraca `undefined`).

- [ ] **Step 3: SQL** — dopisz do `src/queries/purchases.ts`:

```ts
/** NIP/VAT UE dostawcy: wielkie litery, bez kresek/spacji/kropek; krajowy prefiks PL usunięty; prefiks innego kraju zostaje (D4). */
const RAW_TAX_ID = `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(ah.adrh_NIP, ae.adr_NIP), '-', ''), ' ', ''), '.', ''))`;
export const SUPPLIER_TAX_ID_SQL = `NULLIF(CASE WHEN ${RAW_TAX_ID} LIKE 'PL[0-9]%' THEN SUBSTRING(${RAW_TAX_ID}, 3, 64) ELSE ${RAW_TAX_ID} END, '')`;

const LIABILITY_APPLY = `
OUTER APPLY (
    SELECT SUM(f.nzf_WartoscPierwotna) AS payable, SUM(f.nzf_Wartosc) AS remaining, COUNT(*) AS liabilities,
           MIN(f.nzf_TerminPlatnosci) AS due_date
    FROM dbo.nz__Finanse f
    WHERE f.nzf_IdDokumentAuto = d.dok_Id AND f.nzf_Typ = ${LIABILITY_FINANCE_TYPE}
) l`;

const PURCHASE_FROM = `
FROM dbo.dok__Dokument d
${CONTRACTOR_JOINS}
LEFT JOIN dbo.ksef_NumerKSeF k ON k.ksefnr_Id = d.dok_NumerKSeFId
${LIABILITY_APPLY}
WHERE d.dok_Typ IN (${PURCHASE_DOC_TYPE_CODE.FZ}, ${PURCHASE_DOC_TYPE_CODE.KFZ})
  AND d.dok_DataWyst >= ${toDatetime('@from')} AND d.dok_DataWyst < ${toDatetime('@toExcl')}`;

export const SQL_PURCHASE_DOCUMENTS = `
SELECT TOP (@limit) d.dok_Id AS id, d.dok_Typ AS type_code, d.dok_NrPelny AS number,
       NULLIF(LTRIM(RTRIM(d.${PURCHASE_COLUMNS.originalNumber})), '') AS original_number,
       CONVERT(char(10), d.dok_DataWyst, 23) AS issued_at, d.dok_DoDokId AS parent_id,
       ${CONTRACTOR_NAME_SQL} AS supplier_name, ${SUPPLIER_TAX_ID_SQL} AS supplier_tax_id,
       UPPER(COALESCE(NULLIF(LTRIM(RTRIM(d.${PURCHASE_COLUMNS.currency})), ''), 'PLN')) AS currency,
       d.${PURCHASE_COLUMNS.exchangeRate} AS exchange_rate,
       d.dok_WartNetto AS net_total, d.dok_WartBrutto AS gross_total, k.ksefnr_NumerKSeF AS ksef_number,
       l.payable, l.remaining, l.liabilities, CONVERT(char(10), l.due_date, 23) AS due_date
${PURCHASE_FROM}
ORDER BY d.dok_DataWyst DESC, d.dok_Id DESC`;

export const SQL_PURCHASE_DOCUMENTS_TOTAL = `SELECT COUNT(*) AS documents ${PURCHASE_FROM}`;
```

- [ ] **Step 4: Narzędzie** — `src/tools/purchase_documents.ts`:

```ts
// Narzędzie purchase_documents: faktury zakupu FZ/KFZ ze zobowiązaniem (plan faktur UE, Task A5). Tylko odczyt.
import { z } from 'zod';
import { dateParam, queryRows } from '../db.ts';
import { SQL_PURCHASE_DOCUMENTS, SQL_PURCHASE_DOCUMENTS_TOTAL } from '../queries/purchases.ts';
import { money2, requirePool, type ToolDef, type ToolResult } from './registry.ts';
import { assertDateRange, docTypeName, isoDate, limitInput, nextDay, plural, resolveLimit, truncateToLimit } from './shared.ts';

export const PURCHASES_MAX = 500;
export const PURCHASES_DEFAULT = 500;
const PAID_EPSILON = 0.005;

export const purchaseDocumentsInput = z.object({
    from: isoDate.describe('Pierwszy dzień (data wystawienia), RRRR-MM-DD.'),
    to: isoDate.describe('Ostatni dzień włącznie, RRRR-MM-DD.'),
    limit: limitInput(PURCHASES_MAX, PURCHASES_DEFAULT),
});

interface Row {
    id: number; type_code: number; number: string; original_number: string | null; issued_at: string; parent_id: number | null;
    supplier_name: string | null; supplier_tax_id: string | null; currency: string; exchange_rate: number | null;
    net_total: number; gross_total: number; ksef_number: string | null;
    payable: number | null; remaining: number | null; liabilities: number | null; due_date: string | null;
}

export function mapPurchaseRow(r: Row): Record<string, unknown> {
    const hasLiability = Number(r.liabilities ?? 0) > 0;
    return {
        id: Number(r.id), type: docTypeName(r.type_code), number: r.number, original_number: r.original_number ?? null,
        issued_at: r.issued_at, parent_id: r.parent_id === null ? null : Number(r.parent_id),
        supplier_name: r.supplier_name ?? null, supplier_tax_id: r.supplier_tax_id ?? null,
        currency: r.currency, exchange_rate: r.exchange_rate === null ? null : Number(r.exchange_rate),
        net_total: money2(r.net_total), gross_total: money2(r.gross_total), ksef_number: r.ksef_number ?? null,
        payable: hasLiability ? money2(r.payable) : null,
        remaining: hasLiability ? money2(r.remaining) : null,
        // brak zobowiązania (np. KFZ, zapłata gotówką przy zakupie) → stan nieznany, a nie „zapłacona”
        is_paid: hasLiability ? Number(r.remaining ?? 0) <= PAID_EPSILON : null,
        due_date: hasLiability ? r.due_date ?? null : null,
    };
}

export const purchaseDocumentsTool: ToolDef<typeof purchaseDocumentsInput.shape> = {
    name: 'purchase_documents',
    title: 'Faktury zakupu FZ/KFZ (Subiekt GT)',
    description: [
        'Faktury zakupu (FZ) i ich korekty (KFZ) z datą wystawienia w zakresie (≤ 24 mies.), najnowsze pierwsze: numer GT, numer obcy dostawcy,',
        'dostawca z NIP/VAT UE (prefiks kraju zachowany, krajowy PL usunięty), waluta i kurs, netto/brutto w PLN, numer KSeF,',
        'zobowiązanie (nz__Finanse): kwota pierwotna, pozostało, termin, is_paid (null = dokument bez zobowiązania).',
        'Przykładowe pytania: „które faktury od dostawców z UE z października są nieopłacone?”, „ile mamy zobowiązań wobec Tapeten GmbH?”.',
    ].join(' '),
    scope: 'purchases:read',
    input: purchaseDocumentsInput,
    rest: { method: 'GET', path: '/api/purchases/documents' },
    examples: ['Które faktury zakupu z października 2026 są jeszcze nieopłacone?'],
    async run(input, ctx): Promise<ToolResult> {
        const pool = requirePool(ctx);
        assertDateRange(input.from, input.to);
        const { limit, param } = resolveLimit(input.limit, PURCHASES_MAX, PURCHASES_DEFAULT, ctx);
        const params = { from: dateParam(input.from), toExcl: dateParam(nextDay(input.to)), ...param };
        const [raw, totals] = await Promise.all([
            queryRows<Row>(pool, SQL_PURCHASE_DOCUMENTS, params),
            queryRows<{ documents: number }>(pool, SQL_PURCHASE_DOCUMENTS_TOTAL, params),
        ]);
        const { rows: kept, truncated } = truncateToLimit(raw, limit);
        const rows = kept.map(mapPurchaseRow);
        const documents = Number(totals[0]?.documents ?? 0);
        const text = `Faktury zakupu ${input.from} – ${input.to}: ${plural(documents, 'dokument', 'dokumenty', 'dokumentów')}`
            + (truncated ? ` (lista ucięta do ${rows.length}; zawęź zakres dat).` : '.');
        return { structuredContent: { from: input.from, to: input.to, limit, rows, truncated, total: { documents }, summary: text }, text, rows: rows.length };
    },
};
```

Przed implementacją sprawdź w `src/tools/sales_summary.ts`, że `assertDateRange(from, to)` i `nextDay` mają dokładnie te sygnatury (eksportowane przez `shared.ts`); jeżeli `assertDateRange` przyjmuje inne argumenty — dopasuj wywołanie, nie sygnaturę.

- [ ] **Step 5: Rejestracja** — `src/tools/index.ts`: import `purchaseDocumentsTool`, dopisz `'purchase_documents'` na końcu `TOOL_NAMES` i `purchaseDocumentsTool` na końcu tablicy w `buildTools()`.
- [ ] **Step 6: Run** `node --test tests/purchases.test.ts` → PASS; `npm run typecheck && npm test` → PASS (test e2e MCP może sprawdzać liczbę narzędzi — zaktualizuj oczekiwanie do 10).
- [ ] **Step 7: Commit** `feat(bridge): purchase_documents tool for FZ/KFZ with liabilities`

### Task A6: Dokumentacja i wdrożenie mostka

**Files:** `README.md`, `package.json` (`version` → `0.2.0`), `src/http/server.ts` / `/health` jeżeli wersja jest tam zaszyta.

- [ ] **Step 1:** README §1.5 — token aplikacji: `node dist/main.js --new-token walldecor-app --scopes sales:read,purchases:read`; tabela §4 — wiersz `purchase_documents` (zakres, REST, co zwraca). Dopisz zdanie: „Mostek nie zapisuje do bazy; rozliczenia w Subiekcie wykonuje człowiek.”
- [ ] **Step 2: Commit** `docs(bridge): purchase_documents and app token scopes` — PR `bridge/purchases` → `main`.
- [ ] **Step 3 (użytkownik, SERWER):** `git pull && npm ci && npm run build && node dist\main.js --probe` (kod 0), nowy token aplikacji z `purchases:read`, podmiana linii w `BRIDGE_TOKENS`, restart zadania „WallDecor Bridge”, test `curl -H "Authorization: Bearer …" https://<mostek>/api/purchases/documents?from=2026-10-01&to=2026-10-31`.
- [ ] **Step 4 (użytkownik, Coolify):** nowy token w `SUBIEKT_BRIDGE_TOKEN` aplikacji (stary token z samym `sales:read` przestaje wystarczać dopiero po wdrożeniu Części B).

---

# Część B — `walldecor-app`

Worktree: ten katalog, gałąź `eu-invoice-mcp-bridge-6f82721a`. Wszystkie odpowiedzi mostka w testach są syntetyczne (`FetchLike`), jak w `__tests__/unit/finance/subiekt-bridge-client.test.ts`.

### Task B1: Klient mostka — `fetchPurchaseDocuments`

**Files:**
- Modify: `src/lib/finance/subiekt-bridge-client.ts`
- Test: `__tests__/unit/finance/subiekt-bridge-client.test.ts`

- [ ] **Step 1: Testy (czerwone)** — dopisz:

```ts
import { fetchPurchaseDocuments } from '@/lib/finance/subiekt-bridge-client'

const purchaseRow = {
  id: 30, type: 'FZ', number: 'FZ 1/MAG/10/2026', original_number: 'RE-2026-0042', issued_at: '2026-10-03', parent_id: null,
  supplier_name: 'Tapeten Fabrik GmbH', supplier_tax_id: 'DE123456789', currency: 'EUR', exchange_rate: 4.25,
  net_total: 4250, gross_total: 4250, ksef_number: null, payable: 4250, remaining: 4250, is_paid: false, due_date: '2026-10-17',
}
const purchaseBody = { from: '2026-10-01', to: '2026-10-31', limit: 500, rows: [purchaseRow], truncated: false, total: { documents: 1 }, summary: 'ok' }

describe('fetchPurchaseDocuments', () => {
  it('should call /api/purchases/documents with the date range and parse rows', async () => {
    let calledUrl = ''
    const fetcher: FetchLike = async (url) => { calledUrl = url; return new Response(JSON.stringify(purchaseBody), { status: 200 }) }
    const result = await fetchPurchaseDocuments(config, { from: '2026-10-01', to: '2026-10-31' }, fetcher)
    expect(calledUrl).toBe('https://serwer.example.ts.net/api/purchases/documents?from=2026-10-01&to=2026-10-31&limit=500')
    expect(result.rows[0]).toMatchObject({ id: 30, type: 'FZ', currency: 'EUR', remaining: 4250, is_paid: false })
  })

  it('should reject a truncated month instead of returning partial data', async () => {
    await expect(kindOf(fetchPurchaseDocuments(config, query, respond(200, { ...purchaseBody, truncated: true })))).resolves.toBe('invalid_response')
  })

  it('should report a token without purchases:read as unauthorized', async () => {
    await expect(kindOf(fetchPurchaseDocuments(config, query, respond(403, { error: { code: 'FORBIDDEN_SCOPE' } })))).resolves.toBe('unauthorized')
  })

  it('should reject an unknown document type', async () => {
    const body = { ...purchaseBody, rows: [{ ...purchaseRow, type: 'FS' }] }
    await expect(kindOf(fetchPurchaseDocuments(config, query, respond(200, body)))).resolves.toBe('invalid_response')
  })
})
```

- [ ] **Step 2: Run** `npm run test __tests__/unit/finance/subiekt-bridge-client.test.ts` → FAIL (`fetchPurchaseDocuments` nie istnieje).

- [ ] **Step 3: Refaktor bez zmiany zachowania** — wydziel z `fetchSalesSummary` wspólny transport (fetch → mapowanie statusów → `response.json()`):

```ts
async function bridgeGetJson(
  config: SubiektBridgeConfig | null,
  path: string,
  params: URLSearchParams,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<unknown> {
  if (!config) throw new SubiektBridgeError('not_configured', SUBIEKT_BRIDGE_MESSAGES.not_configured)
  const url = `${config.url}${path}?${params.toString()}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET', headers: bridgeRequestHeaders(config), redirect: 'error', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error)) throw new SubiektBridgeError('timeout', SUBIEKT_BRIDGE_MESSAGES.timeout)
    throw new SubiektBridgeError('unavailable', SUBIEKT_BRIDGE_MESSAGES.unavailable)
  }
  // ← przenieś tu bez zmian trzy bloki obsługi 401/403, 5xx i !ok z fetchSalesSummary
  try {
    return await response.json()
  } catch {
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, json: unknown): z.infer<T> {
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.warn(JSON.stringify({ event: 'SUBIEKT_BRIDGE_INVALID_RESPONSE', issues: parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }))
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
  return parsed.data
}
```

`fetchSalesSummary` po refaktorze: walidacja dat → `bridgeGetJson(config, '/api/sales/summary', params, fetchImpl, timeoutMs)` → `parseOrThrow(salesSummarySchema, json)` → istniejąca kontrola sum. Komunikat `unauthorized` zmień na „…Sprawdź SUBIEKT_BRIDGE_TOKEN i zakresy sales:read oraz purchases:read.”. Uruchom `npm run test __tests__/unit/finance/subiekt-bridge-client.test.ts __tests__/unit/finance/subiekt-bridge-redirect.test.ts` — dotychczasowe testy mają przejść przed dodaniem nowego kodu (jeżeli test sprawdza dosłowny tekst komunikatu `unauthorized` — zaktualizuj go).

- [ ] **Step 4: Implementacja**

```ts
const dateString = z.string().regex(DATE_RE)

export const purchaseDocumentSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(['FZ', 'KFZ']),
  number: z.string().min(1),
  original_number: z.string().nullable(),
  issued_at: dateString,
  parent_id: z.number().int().nullable(),
  supplier_name: z.string().nullable(),
  supplier_tax_id: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exchange_rate: numericValue.nullable(),
  net_total: amount,
  gross_total: amount,
  ksef_number: z.string().nullable(),
  payable: amount.nullable(),
  remaining: amount.nullable(),
  is_paid: z.boolean().nullable(),
  due_date: dateString.nullable(),
})

export const purchaseDocumentsSchema = z.object({
  from: dateString,
  to: dateString,
  rows: z.array(purchaseDocumentSchema),
  truncated: z.boolean(),
  total: z.object({ documents: count }),
})

export type PurchaseDocument = z.infer<typeof purchaseDocumentSchema>
export const PURCHASE_PAGE_LIMIT = 500

/** FZ/KFZ issued in [from, to]. Never returns a truncated list: callers query month by month. */
export async function fetchPurchaseDocuments(
  config: SubiektBridgeConfig | null,
  query: SalesSummaryQuery,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SUBIEKT_BRIDGE_TIMEOUT_MS,
): Promise<z.infer<typeof purchaseDocumentsSchema>> {
  if (!DATE_RE.test(query.from) || !DATE_RE.test(query.to)) {
    throw new SubiektBridgeError('bridge_error', 'Nieprawidłowy zakres dat zapytania do mostka.', 'INVALID_INPUT')
  }
  const params = new URLSearchParams({ from: query.from, to: query.to, limit: String(PURCHASE_PAGE_LIMIT) })
  const data = parseOrThrow(purchaseDocumentsSchema, await bridgeGetJson(config, '/api/purchases/documents', params, fetchImpl, timeoutMs))
  if (data.truncated) {
    throw new SubiektBridgeError('invalid_response', `Subiekt zwrócił ponad ${PURCHASE_PAGE_LIMIT} faktur zakupu w okresie ${query.from} – ${query.to}. Import przerwany bez zmian.`, 'LIMIT_EXCEEDED')
  }
  return data
}
```

- [ ] **Step 5: Run** test pliku → PASS; `npx tsc --noEmit` → bez błędów.
- [ ] **Step 6: Commit** `feat(finance): bridge client for Subiekt purchase documents`

### Task B2: Czyste dopasowanie i klasyfikacja

**Files:**
- Create: `src/lib/finance/subiekt-purchase-matching.ts`
- Test: `__tests__/unit/finance/subiekt-purchase-matching.test.ts`

Reguły:
- `taxKey` = same cyfry identyfikatora (`normalizeSupplierNip` z `ksef-inbox.ts`) — `DE 123-456-789`, `DE123456789` i `123456789` dają ten sam klucz, więc ręcznie wpisane faktury UE (z prefiksem lub bez) się dopasują.
- `numberKey` = numer obcy wielkimi literami bez białych znaków.
- Kolejność dopasowania dokumentu GT do faktury w aplikacji: (1) `externalId === "subiekt:<id>"`, (2) `externalId === ksef_number`, (3) para `taxKey|numberKey`. Para z (3) pasująca do >1 faktury → `ambiguous`, nigdy zgadywanie.
- „Zagraniczna” = waluta ≠ PLN albo identyfikator zaczyna się od dwóch liter (prefiks PL usuwa już mostek).

- [ ] **Step 1: Testy (czerwone)**

```ts
import { describe, expect, it } from 'vitest'
import type { PurchaseDocument } from '@/lib/finance/subiekt-bridge-client'
import {
  isForeignPurchase, matchPurchases, numberKey, reconcilePayments, subiektExternalId, type AppInvoiceForMatch,
} from '@/lib/finance/subiekt-purchase-matching'

const doc = (over: Partial<PurchaseDocument> = {}): PurchaseDocument => ({
  id: 30, type: 'FZ', number: 'FZ 1/MAG/10/2026', original_number: 'RE-2026-0042', issued_at: '2026-10-03', parent_id: null,
  supplier_name: 'Tapeten Fabrik GmbH', supplier_tax_id: 'DE123456789', currency: 'EUR', exchange_rate: 4.25,
  net_total: 4250, gross_total: 4250, ksef_number: null, payable: 4250, remaining: 4250, is_paid: false, due_date: '2026-10-17', ...over,
})
const inv = (over: Partial<AppInvoiceForMatch> = {}): AppInvoiceForMatch => ({
  id: 'inv-1', externalId: null, supplierNip: 'DE 123 456 789', invoiceNumber: 're-2026-0042', paymentStatus: 'UNPAID', paidAt: null,
  plnGross: 4250, documentStatus: 'ACTIVE', issueDate: '2026-10-03', supplierName: 'Tapeten', ...over,
})

describe('isForeignPurchase', () => {
  it('should treat a EUR invoice as foreign', () => { expect(isForeignPurchase(doc())).toBe(true) })
  it('should treat a PLN invoice from a DE VAT id as foreign', () => { expect(isForeignPurchase(doc({ currency: 'PLN' }))).toBe(true) })
  it('should treat a PLN invoice with a digits-only NIP as domestic', () => { expect(isForeignPurchase(doc({ currency: 'PLN', supplier_tax_id: '5260000000' }))).toBe(false) })
})

describe('numberKey', () => {
  it('should ignore case and whitespace', () => { expect(numberKey(' re 2026-0042 ')).toBe('RE2026-0042') })
})

describe('matchPurchases', () => {
  it('should prefer the subiekt externalId over number matching', () => {
    const result = matchPurchases([doc()], [inv({ id: 'a' }), inv({ id: 'b', externalId: subiektExternalId(30), invoiceNumber: 'X' })])
    expect(result.pairs.map((p) => p.invoice.id)).toEqual(['b'])
  })

  it('should match a domestic invoice by its KSeF number', () => {
    const result = matchPurchases([doc({ ksef_number: 'K-1', original_number: 'FV 1' })], [inv({ id: 'k', externalId: 'K-1', invoiceNumber: 'other' })])
    expect(result.pairs[0]?.invoice.id).toBe('k')
  })

  it('should match a manually entered EU invoice by tax digits and original number', () => {
    expect(matchPurchases([doc()], [inv({ supplierNip: '123456789' })]).pairs).toHaveLength(1)
  })

  it('should report two candidate invoices as ambiguous instead of picking one', () => {
    const result = matchPurchases([doc()], [inv({ id: 'a' }), inv({ id: 'b' })])
    expect([result.pairs.length, result.ambiguous.map((a) => a.document.id)]).toEqual([0, [30]])
  })

  it('should not reuse one app invoice for two Subiekt documents', () => {
    const result = matchPurchases([doc({ id: 30 }), doc({ id: 31 })], [inv()])
    expect([result.pairs.length, result.unmatchedDocuments.map((d) => d.id)]).toEqual([1, [31]])
  })
})

describe('reconcilePayments', () => {
  it('should list an invoice paid in the app but open in Subiekt as to be settled in Subiekt', () => {
    const result = reconcilePayments(matchPurchases([doc()], [inv({ paymentStatus: 'PAID', paidAt: '2026-10-15' })]), [])
    expect(result.settleInSubiekt.map((r) => r.document.number)).toEqual(['FZ 1/MAG/10/2026'])
  })

  it('should list an invoice paid in Subiekt but unpaid in the app separately', () => {
    const result = reconcilePayments(matchPurchases([doc({ remaining: 0, is_paid: true })], [inv()]), [])
    expect(result.paidOnlyInSubiekt).toHaveLength(1)
  })

  it('should skip documents without a liability (is_paid null)', () => {
    const result = reconcilePayments(matchPurchases([doc({ is_paid: null, remaining: null })], [inv({ paymentStatus: 'PAID' })]), [])
    expect([result.settleInSubiekt.length, result.paidOnlyInSubiekt.length]).toEqual([0, 0])
  })

  it('should flag a PLN amount difference above one grosz', () => {
    const result = reconcilePayments(matchPurchases([doc()], [inv({ paymentStatus: 'PAID', plnGross: 4249.5 })]), [])
    expect(result.settleInSubiekt[0]?.amountDiffers).toBe(true)
  })

  it('should list paid app invoices in the window with no Subiekt document, excluding cancelled ones', () => {
    const paidElsewhere = inv({ id: 'z', invoiceNumber: 'NOPE', paymentStatus: 'PAID' })
    const cancelled = inv({ id: 'c', invoiceNumber: 'GONE', paymentStatus: 'PAID', documentStatus: 'CANCELLED' })
    const result = reconcilePayments(matchPurchases([], [paidElsewhere, cancelled]), [paidElsewhere, cancelled])
    expect(result.paidInAppMissingInSubiekt.map((i) => i.id)).toEqual(['z'])
  })
})
```

- [ ] **Step 2: Run** `npm run test __tests__/unit/finance/subiekt-purchase-matching.test.ts` → FAIL (moduł nie istnieje).

- [ ] **Step 3: Implementacja**

```ts
import type { PurchaseDocument } from '@/lib/finance/subiekt-bridge-client'
import { normalizeSupplierNip } from '@/lib/finance/ksef-inbox'

/** Pure matching between Subiekt GT purchase documents and app invoices. No I/O. */

export const SUBIEKT_SOURCE = 'SUBIEKT'
export const subiektExternalId = (documentId: number) => `subiekt:${documentId}`

export interface AppInvoiceForMatch {
  id: string
  externalId: string | null
  supplierName: string
  supplierNip: string | null
  invoiceNumber: string
  issueDate: string
  paymentStatus: string
  paidAt: string | null
  /** Amount in PLN used for reporting (reportingGrossAmount ?? grossAmount for PLN). */
  plnGross: number | null
  documentStatus: string
}

export const numberKey = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, '').toUpperCase()

function documentKey(taxId: string | null, number: string | null): string | null {
  const tax = normalizeSupplierNip(taxId)
  const num = numberKey(number)
  return tax && num ? `${tax}|${num}` : null
}

export function isForeignPurchase(document: Pick<PurchaseDocument, 'currency' | 'supplier_tax_id'>): boolean {
  if (document.currency !== 'PLN') return true
  return /^[A-Z]{2}/.test((document.supplier_tax_id ?? '').toUpperCase())
}

export interface MatchedPair { document: PurchaseDocument; invoice: AppInvoiceForMatch; via: 'SUBIEKT_ID' | 'KSEF' | 'NUMBER' }

export interface MatchResult {
  pairs: MatchedPair[]
  ambiguous: Array<{ document: PurchaseDocument; invoiceIds: string[] }>
  unmatchedDocuments: PurchaseDocument[]
  matchedInvoiceIds: Set<string>
}

export function matchPurchases(documents: PurchaseDocument[], invoices: AppInvoiceForMatch[]): MatchResult {
  const byExternalId = new Map<string, AppInvoiceForMatch>()
  const byKey = new Map<string, AppInvoiceForMatch[]>()
  for (const invoice of invoices) {
    if (invoice.externalId) byExternalId.set(invoice.externalId, invoice)
    const key = documentKey(invoice.supplierNip, invoice.invoiceNumber)
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), invoice])
  }
  const used = new Set<string>()
  const result: MatchResult = { pairs: [], ambiguous: [], unmatchedDocuments: [], matchedInvoiceIds: used }
  const take = (document: PurchaseDocument, invoice: AppInvoiceForMatch, via: MatchedPair['via']) => {
    used.add(invoice.id)
    result.pairs.push({ document, invoice, via })
  }
  for (const document of documents) {
    const bySubiekt = byExternalId.get(subiektExternalId(document.id))
    if (bySubiekt && !used.has(bySubiekt.id)) { take(document, bySubiekt, 'SUBIEKT_ID'); continue }
    const byKsef = document.ksef_number ? byExternalId.get(document.ksef_number) : undefined
    if (byKsef && !used.has(byKsef.id)) { take(document, byKsef, 'KSEF'); continue }
    const key = documentKey(document.supplier_tax_id, document.original_number)
    const candidates = (key ? byKey.get(key) ?? [] : []).filter((invoice) => !used.has(invoice.id))
    if (candidates.length === 1) take(document, candidates[0] as AppInvoiceForMatch, 'NUMBER')
    else if (candidates.length > 1) result.ambiguous.push({ document, invoiceIds: candidates.map((c) => c.id) })
    else result.unmatchedDocuments.push(document)
  }
  return result
}

export interface SettlementRow { document: PurchaseDocument; invoice: AppInvoiceForMatch; amountDiffers: boolean }

export interface PaymentReconciliation {
  /** Paid in the app, liability still open in Subiekt — tick these in Subiekt. */
  settleInSubiekt: SettlementRow[]
  /** Liability settled in Subiekt, app invoice not marked paid. */
  paidOnlyInSubiekt: SettlementRow[]
  /** Paid app invoices in the window without any Subiekt document (not entered in GT yet?). */
  paidInAppMissingInSubiekt: AppInvoiceForMatch[]
  ambiguous: MatchResult['ambiguous']
}

const differs = (document: PurchaseDocument, invoice: AppInvoiceForMatch) =>
  invoice.plnGross !== null && Math.abs(Math.round(invoice.plnGross * 100) - Math.round(document.gross_total * 100)) > 1

/** `windowInvoices` = app invoices issued inside the reconciled window (for the „missing in Subiekt” list). */
export function reconcilePayments(match: MatchResult, windowInvoices: AppInvoiceForMatch[]): PaymentReconciliation {
  const settleInSubiekt: SettlementRow[] = []
  const paidOnlyInSubiekt: SettlementRow[] = []
  for (const { document, invoice } of match.pairs) {
    if (document.is_paid === null || invoice.documentStatus === 'CANCELLED') continue
    const row = { document, invoice, amountDiffers: differs(document, invoice) }
    if (invoice.paymentStatus === 'PAID' && !document.is_paid) settleInSubiekt.push(row)
    else if (invoice.paymentStatus !== 'PAID' && document.is_paid) paidOnlyInSubiekt.push(row)
  }
  const paidInAppMissingInSubiekt = windowInvoices.filter((invoice) =>
    invoice.paymentStatus === 'PAID' && invoice.documentStatus !== 'CANCELLED' && !match.matchedInvoiceIds.has(invoice.id))
  return { settleInSubiekt, paidOnlyInSubiekt, paidInAppMissingInSubiekt, ambiguous: match.ambiguous }
}
```

- [ ] **Step 4: Run** test pliku → PASS (14 testów).
- [ ] **Step 5: Commit** `feat(finance): match Subiekt purchase documents with app invoices`

### Task B3: Import faktur UE

**Files:**
- Create: `src/lib/finance/subiekt-purchases.ts`
- Test: `__tests__/integration/finance/subiekt-purchases.test.ts`

Zachowanie `importSubiektForeignPurchases(db, { actorId, now, fetchImpl?, env? })` (w testach `env = { SUBIEKT_BRIDGE_URL: 'https://bridge.test', SUBIEKT_BRIDGE_TOKEN: 'tok', SUBIEKT_PURCHASES_IMPORT_FROM: '2026-01-01' }`):
1. Zakres (decyzja właściciela 2026-11-18): **pierwszy udany import** pobiera wszystko od `SUBIEKT_PURCHASES_IMPORT_FROM` (produkcja: `2026-01-01`; wcześniej faktur UE w aplikacji praktycznie nie było) do dziś; potem `AppSetting subiekt_purchases.backfill_done = true` i **każdy kolejny import czyta tylko 60 dni wstecz** (`SUBIEKT_PURCHASE_IMPORT_DAYS`), nigdy przed datą startu. Duplikaty są ignorowane (pkt 4). Brak zmiennej → import wyłączony z komunikatem. Pobierane miesiąc po miesiącu (`fetchPurchaseDocuments`); jakikolwiek błąd → nic nie zapisujemy, wynik `{ ok: false, error }`.
2. Filtr `isForeignPurchase`. Krajowe pomijane (KSeF).
3. Dopasowanie `matchPurchases` do wszystkich `KsefInvoice` z oknem dat (±0 — `issueDate` w oknie) **oraz** wszystkich z `source = "SUBIEKT"` (niezależnie od daty).
4. Dokument dopasowany → `alreadyInApp` (bez zapisu). Niejednoznaczny → `ambiguous` (bez zapisu). Niedopasowany → `create`.
5. `create` w `withAiQueueMutation` (ten sam zamek co KSeF/import PDF), z ponownym sprawdzeniem `externalId` w transakcji; reguły dostawcy jak w `ksef-sync-service.ts`.
6. KFZ: `documentStatus = 'CORRECTION'`, `correctsInvoiceId` = faktura z `externalId = subiekt:<parent_id>` (jeżeli istnieje).
7. Status płatności: `is_paid === true` → `PAID` (bez `paidAt` — GT nie podaje daty zapłaty w tym narzędziu); inaczej `UNPAID`.
8. Wynik zapisany w `AppSetting` (`subiekt_purchases.last_import_at`, `.last_import_message`).

- [ ] **Step 1: Test integracyjny (czerwony)** — szkielet bazy skopiuj z `__tests__/integration/finance/subiekt-revenue.test.ts` (tmp SQLite + `migrate deploy`, mock `@/lib/prisma`, `next-auth`, `@/lib/auth`). Dodatkowo w `beforeAll` utwórz użytkownika ADMIN `admin` (`role: 'ADMIN', isActive: true, mustChangePassword: false`) i `CostCenter` JAG/PUL/GLOBAL. Przypadki:

```ts
const NOW = new Date('2026-10-31T10:00:00Z')
const bridgeWith = (rowsByMonth: Record<string, PurchaseDocument[]>): FetchLike => async (url) => {
  const from = new URL(url).searchParams.get('from') ?? ''
  const rows = rowsByMonth[from.slice(0, 7)] ?? []
  return new Response(JSON.stringify({ from, to: new URL(url).searchParams.get('to'), limit: 500, rows, truncated: false, total: { documents: rows.length } }), { status: 200 })
}
// doc(...) — fabryka jak w Task B2

it('should create an unpaid foreign invoice with source SUBIEKT and PLN amounts', async () => {
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
  expect(result).toMatchObject({ ok: true, created: 1, alreadyInApp: 0, skippedDomestic: 0 })
  const invoice = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })
  expect(invoice).toMatchObject({
    source: 'SUBIEKT', supplierName: 'Tapeten Fabrik GmbH', supplierNip: 'DE123456789', invoiceNumber: 'RE-2026-0042',
    currency: 'PLN', grossAmount: 4250, netAmount: 4250, vatAmount: 0, paymentStatus: 'UNPAID', status: 'NEW', documentStatus: 'ACTIVE',
  })
  expect(invoice.currencyConversionNote).toBe('Przeliczone w Subiekcie GT: EUR po kursie 4,2500 (FZ 1/MAG/10/2026).')
  expect(invoice.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-17')
})

it('should be idempotent on a second run', async () => {
  const fetchImpl = bridgeWith({ '2026-10': [doc()] })
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl })
  const second = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl })
  expect([second.ok && second.created, second.ok && second.alreadyInApp, await db.ksefInvoice.count()]).toEqual([0, 1, 1])
})

it('should not duplicate an EU invoice already entered manually and must not modify it', async () => {
  const manual = await db.ksefInvoice.create({ data: { supplierName: 'Tapeten', supplierNip: '123456789', invoiceNumber: 're-2026-0042', issueDate: new Date('2026-10-03'), grossAmount: 4249.9, currency: 'PLN' } })
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
  expect(result).toMatchObject({ ok: true, created: 0, alreadyInApp: 1 })
  expect(await db.ksefInvoice.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ externalId: null, grossAmount: 4249.9, source: 'MANUAL' })
})

it('should skip domestic PLN invoices', async () => {
  const domestic = doc({ id: 32, currency: 'PLN', supplier_tax_id: '5260000000', original_number: 'FV 10/10/2026' })
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [domestic] }) })
  expect([result.ok && result.skippedDomestic, await db.ksefInvoice.count()]).toEqual([1, 0])
})

it('should import a paid invoice as PAID and a KFZ as a correction linked to its FZ', async () => {
  const kfz = doc({ id: 33, type: 'KFZ', number: 'KFZ 1/MAG/10/2026', original_number: 'RE-2026-0042-K', parent_id: 30, net_total: -425, gross_total: -425, payable: null, remaining: null, is_paid: null, due_date: null })
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc({ remaining: 0, is_paid: true }), kfz] }) })
  const fz = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })
  const correction = await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:33' } })
  expect([fz.paymentStatus, fz.paidAt, correction.documentStatus, correction.correctsInvoiceId]).toEqual(['PAID', null, 'CORRECTION', fz.id])
})

it('should apply a matching supplier rule', async () => {
  await db.ksefSupplierRule.create({ data: { supplierNip: '123456789', costCenterId: 'PUL', active: true } })
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
  expect(await db.ksefInvoice.findUniqueOrThrow({ where: { externalId: 'subiekt:30' } })).toMatchObject({ status: 'MAPPED', ruleMatchStatus: 'MATCHED', costCenterId: 'PUL' })
})

it('should skip invoices issued before SUBIEKT_PURCHASES_IMPORT_FROM', async () => {
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env: { ...env, SUBIEKT_PURCHASES_IMPORT_FROM: '2026-10-05' }, fetchImpl: bridgeWith({ '2026-10': [doc()] }) })
  // first run asks the bridge for 2026-10-05..2026-10-31 only; the fake ignores `from`, so the service must also filter rows
  expect([result.ok && result.created, await db.ksefInvoice.count()]).toEqual([0, 0])
})

it('should refuse to import without SUBIEKT_PURCHASES_IMPORT_FROM', async () => {
  const { SUBIEKT_PURCHASES_IMPORT_FROM: _omit, ...withoutFloor } = env
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env: withoutFloor, fetchImpl: bridgeWith({}) })
  expect(result.ok ? null : result.kind).toBe('not_configured')
})

it('should backfill from IMPORT_FROM on the first run and read only 60 days back afterwards', async () => {
  const requested: string[] = []
  const spy: FetchLike = async (url) => {
    const params = new URL(url).searchParams
    requested.push(`${params.get('from')}..${params.get('to')}`)
    return new Response(JSON.stringify({ from: params.get('from'), to: params.get('to'), limit: 500, rows: [], truncated: false, total: { documents: 0 } }), { status: 200 })
  }
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: spy })
  expect([requested[0], requested.at(-1), requested.length]).toEqual(['2026-01-01..2026-01-31', '2026-10-01..2026-10-31', 10])
  requested.length = 0
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: spy })
  // 2026-10-31 − 60 days = 2026-09-01
  expect(requested).toEqual(['2026-09-01..2026-09-30', '2026-10-01..2026-10-31'])
})

it('should not mark the backfill done when the first run fails', async () => {
  await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: async () => new Response('{}', { status: 503 }) })
  expect(await db.appSetting.findUnique({ where: { key: 'subiekt_purchases.backfill_done' } })).toBeNull()
})

it('should write nothing when any month fails', async () => {
  const failing: FetchLike = async (url) => new URL(url).searchParams.get('from')?.startsWith('2026-10')
    ? new Response('{}', { status: 503 })
    : new Response(JSON.stringify({ from: 'x', to: 'x', limit: 500, rows: [], truncated: false, total: { documents: 0 } }), { status: 200 })
  const result = await importSubiektForeignPurchases(db, { actorId: 'admin', now: NOW, env, fetchImpl: failing })
  expect([result.ok, await db.ksefInvoice.count()]).toEqual([false, 0])
})
```

(Przed pisaniem testu sprawdź w `prisma/schema.prisma` wymagane pola `KsefSupplierRule` i dopasuj `create` reguły; `beforeEach` czyści `ksefInvoicePartAllocation`, `ksefInvoicePartTag`, `ksefInvoicePart`, `ksefInvoice`, `ksefSupplierRule`, `appSetting` w tej kolejności.)

- [ ] **Step 2: Run** `npm run test __tests__/integration/finance/subiekt-purchases.test.ts` → FAIL (moduł nie istnieje).

- [ ] **Step 3: Implementacja** — `src/lib/finance/subiekt-purchases.ts`:

```ts
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { resolveSupplierRuleMatch } from '@/lib/finance/ksef-inbox'
import {
  SubiektBridgeError, describeSubiektBridgeError, fetchPurchaseDocuments, readSubiektBridgeConfig, type FetchLike, type PurchaseDocument,
} from '@/lib/finance/subiekt-bridge-client'
import {
  SUBIEKT_SOURCE, isForeignPurchase, matchPurchases, subiektExternalId, type AppInvoiceForMatch,
} from '@/lib/finance/subiekt-purchase-matching'

/** Rolling import window after the first (backfill) run. */
export const SUBIEKT_PURCHASE_IMPORT_DAYS = 60
/** Reconciliation: current + 5 previous months (payment terms rarely exceed 60 days; forgotten items stay visible for half a year). */
export const SUBIEKT_RECONCILIATION_MONTHS = 6
export const SUBIEKT_PURCHASE_KEYS = {
  lastImportAt: 'subiekt_purchases.last_import_at',
  lastImportMessage: 'subiekt_purchases.last_import_message',
  /** Set after the first successful import from SUBIEKT_PURCHASES_IMPORT_FROM; later runs read only 60 days back. */
  backfillDone: 'subiekt_purchases.backfill_done',
} as const

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
export const warsawToday = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now)
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/** [from, to] split into calendar-month chunks (the bridge returns ≤ 500 rows per call). */
export function monthChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = []
  let cursor = from
  while (cursor <= to) {
    const start = new Date(`${cursor}T00:00:00.000Z`)
    const monthEnd = iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)))
    const chunkEnd = monthEnd < to ? monthEnd : to
    chunks.push({ from: cursor, to: chunkEnd })
    cursor = addDays(chunkEnd, 1)
  }
  return chunks
}

/** First run: IMPORT_FROM..today (backfill). Later runs: max(IMPORT_FROM, today − 60 days)..today. */
export function importRange(now: Date, importFrom: string, backfillDone: boolean) {
  const to = warsawToday(now)
  const rolling = addDays(to, -SUBIEKT_PURCHASE_IMPORT_DAYS)
  return { from: backfillDone && rolling > importFrom ? rolling : importFrom, to }
}

export function reconciliationRange(now: Date) {
  const to = warsawToday(now)
  const [year, month] = to.split('-').map(Number) as [number, number]
  return { from: iso(new Date(Date.UTC(year, month - SUBIEKT_RECONCILIATION_MONTHS, 1))), to }
}

export interface PurchaseFetchOptions { now?: Date; fetchImpl?: FetchLike; env?: Record<string, string | undefined> }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** SUBIEKT_PURCHASES_IMPORT_FROM — first issue date eligible for import (production: 2026-01-01); null = import disabled. */
export function readImportFrom(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.SUBIEKT_PURCHASES_IMPORT_FROM ?? '').trim()
  return DATE_ONLY.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : null
}

/** All FZ/KFZ issued in [from, to] (month by month) or a Polish error; never partial. */
export async function fetchPurchaseRange(options: PurchaseFetchOptions & { from: string; to: string }) {
  const config = readSubiektBridgeConfig(options.env ?? process.env)
  try {
    const documents: PurchaseDocument[] = []
    for (const chunk of monthChunks(options.from, options.to)) {
      const page = await fetchPurchaseDocuments(config, chunk, options.fetchImpl)
      documents.push(...page.rows)
    }
    return { ok: true as const, documents, from: options.from, to: options.to }
  } catch (error) {
    return { ok: false as const, kind: error instanceof SubiektBridgeError ? error.kind : 'unavailable' as const, error: describeSubiektBridgeError(error) }
  }
}

type InvoiceRow = Prisma.KsefInvoiceGetPayload<{ select: typeof MATCH_SELECT }>
export const MATCH_SELECT = {
  id: true, externalId: true, supplierName: true, supplierNip: true, invoiceNumber: true, issueDate: true,
  paymentStatus: true, paidAt: true, currency: true, grossAmount: true, reportingGrossAmount: true, documentStatus: true,
} as const

export function toMatchInvoice(row: InvoiceRow): AppInvoiceForMatch {
  return {
    id: row.id, externalId: row.externalId, supplierName: row.supplierName, supplierNip: row.supplierNip,
    invoiceNumber: row.invoiceNumber, issueDate: row.issueDate.toISOString().slice(0, 10), paymentStatus: row.paymentStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    plnGross: row.currency === 'PLN' ? row.grossAmount : row.reportingGrossAmount,
    documentStatus: row.documentStatus,
  }
}

export async function loadInvoicesForMatch(db: Pick<PrismaClient, 'ksefInvoice'>, from: string, to: string) {
  const rows = await db.ksefInvoice.findMany({
    where: { OR: [{ issueDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) } }, { source: SUBIEKT_SOURCE }] },
    select: MATCH_SELECT,
  })
  return rows.map(toMatchInvoice)
}

const rate = (value: number | null) => value === null ? '' : value.toFixed(4).replace('.', ',')

/** Decision D3: invoice amount = Subiekt gross in PLN (equals the payable for WNT; verified by the probe). */
export function toInvoiceAmounts(document: PurchaseDocument) {
  return {
    grossAmount: document.gross_total,
    netAmount: document.net_total,
    vatAmount: Math.round((document.gross_total - document.net_total) * 100) / 100,
  }
}

export type PurchaseImportResult =
  | { ok: true; created: number; alreadyInApp: number; ambiguous: number; skippedDomestic: number; message: string }
  | { ok: false; error: string }

export async function importSubiektForeignPurchases(
  db: PrismaClient,
  options: PurchaseFetchOptions & { actorId: string },
): Promise<PurchaseImportResult> {
  const now = options.now ?? new Date()
  const importFrom = readImportFrom(options.env ?? process.env)
  if (!importFrom) return { ok: false, kind: 'not_configured', error: 'Import faktur UE jest wyłączony. Ustaw SUBIEKT_PURCHASES_IMPORT_FROM (RRRR-MM-DD) — od tej daty wystawienia faktury trafią do aplikacji.' }
  const backfillDone = (await db.appSetting.findUnique({ where: { key: SUBIEKT_PURCHASE_KEYS.backfillDone } }))?.value === 'true'
  const range = importRange(now, importFrom, backfillDone)
  const fetched = await fetchPurchaseRange({ ...options, ...range })
  if (!fetched.ok) {
    await writeImportStatus(db, now, `Błąd: ${fetched.error}`)
    return fetched
  }
  const foreign = fetched.documents.filter((document) => isForeignPurchase(document) && document.issued_at >= importFrom)
  const skippedDomestic = fetched.documents.length - foreign.length
  // Corrections after their originals so correctsInvoiceId can resolve within one run.
  foreign.sort((a, b) => (a.type === b.type ? a.id - b.id : a.type === 'FZ' ? -1 : 1))
  const match = matchPurchases(foreign, await loadInvoicesForMatch(db, fetched.from, fetched.to))
  const rules = await db.ksefSupplierRule.findMany({ where: { active: true }, include: { tags: true } })

  let created = 0
  for (const document of match.unmatchedDocuments) {
    const outcome = await withAiQueueMutation(db, () => now, async (tx) => {
      const externalId = subiektExternalId(document.id)
      if (await tx.ksefInvoice.findUnique({ where: { externalId }, select: { id: true } })) return 'EXISTS' as const
      const supplierName = document.supplier_name ?? document.number
      const decision = resolveSupplierRuleMatch({ supplierName, supplierNip: document.supplier_tax_id }, rules)
      const rule = decision.status === 'MATCHED' ? decision.rule : null
      const parent = document.type === 'KFZ' && document.parent_id !== null
        ? await tx.ksefInvoice.findUnique({ where: { externalId: subiektExternalId(document.parent_id) }, select: { id: true } })
        : null
      const amounts = toInvoiceAmounts(document)
      await tx.ksefInvoice.create({
        data: {
          source: SUBIEKT_SOURCE,
          externalId,
          supplierName,
          supplierNip: document.supplier_tax_id,
          invoiceNumber: document.original_number ?? document.number,
          issueDate: new Date(`${document.issued_at}T00:00:00.000Z`),
          ...amounts,
          currency: 'PLN',
          currencyConversionNote: document.currency === 'PLN'
            ? null
            : `Przeliczone w Subiekcie GT: ${document.currency} po kursie ${rate(document.exchange_rate)} (${document.number}).`,
          dueDate: document.due_date ? new Date(`${document.due_date}T00:00:00.000Z`) : null,
          paymentStatus: document.is_paid === true ? 'PAID' : 'UNPAID',
          documentStatus: document.type === 'KFZ' ? 'CORRECTION' : 'ACTIVE',
          correctsInvoiceId: parent?.id ?? null,
          status: rule ? 'MAPPED' : 'NEW',
          ruleMatchStatus: decision.status === 'CONFLICT' ? 'CONFLICT' : rule ? 'MATCHED' : 'NO_RULE',
          costCenterId: rule?.costCenterId ?? null,
          subCategoryId: rule?.subCategoryId ?? null,
          supplierRuleId: rule?.id ?? null,
          notes: `Subiekt GT: ${document.number}`,
        },
      })
      return 'CREATED' as const
    })
    if (outcome === 'CREATED') created += 1
  }

  const message = `Faktury UE z Subiekta: dodano ${created}, już w aplikacji ${match.pairs.length}, niejednoznaczne ${match.ambiguous.length}, krajowe pominięte ${skippedDomestic}.`
  await writeImportStatus(db, now, message, { [SUBIEKT_PURCHASE_KEYS.backfillDone]: 'true' })
  return { ok: true, created, alreadyInApp: match.pairs.length, ambiguous: match.ambiguous.length, skippedDomestic, message }
}

async function writeImportStatus(db: Pick<PrismaClient, 'appSetting' | '$transaction'>, now: Date, message: string, extra: Record<string, string> = {}) {
  const values = { [SUBIEKT_PURCHASE_KEYS.lastImportAt]: now.toISOString(), [SUBIEKT_PURCHASE_KEYS.lastImportMessage]: message, ...extra }
  await db.$transaction(Object.entries(values).map(([key, value]) =>
    db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })))
}
```

Uwaga do reguł z tagami: KSeF przy dopasowanej regule z tagami zakłada `parts` (patrz `ksef-sync-service.ts`, blok `match?.tags`). Skopiuj ten blok `parts: { create: … }` do `create` powyżej 1:1 (z `invoiceData.invoiceNumber` → numerem faktury i `grossAmount` → `amounts.grossAmount`), żeby faktury z Subiekta zachowywały się w raportach kosztów identycznie.

- [ ] **Step 4: Run** test pliku → PASS; `npx tsc --noEmit` → bez błędów.
- [ ] **Step 5: Commit** `feat(finance): import foreign purchase invoices from Subiekt`

### Task B4: Uzgodnienie płatności + endpointy

**Files:**
- Modify: `src/lib/finance/subiekt-purchases.ts`
- Create: `src/app/api/finance/subiekt-purchases/import/route.ts`
- Create: `src/app/api/finance/subiekt-purchases/reconciliation/route.ts`
- Test: `__tests__/integration/finance/subiekt-purchases.test.ts` (nowy `describe`)

- [ ] **Step 1: Testy (czerwone)**

```ts
describe('payment reconciliation route', () => {
  it('should list an invoice paid in the app and open in Subiekt', async () => {
    await db.ksefInvoice.create({ data: { supplierName: 'Hurt', supplierNip: '5260000000', invoiceNumber: 'FV 10/10/2026', externalId: 'K-3', issueDate: new Date('2026-10-10'), grossAmount: 123, paymentStatus: 'PAID', paidAt: new Date('2026-10-20') } })
    const domestic = doc({ id: 32, currency: 'PLN', supplier_tax_id: '5260000000', original_number: 'FV 10/10/2026', ksef_number: 'K-3', gross_total: 123, payable: 123, remaining: 123 })
    const result = await reconcileSubiektPayments(db, { now: NOW, env, fetchImpl: bridgeWith({ '2026-10': [domestic] }) })
    expect(result.ok && result.settleInSubiekt.map((r) => [r.subiektNumber, r.originalNumber, r.remaining, r.paidAt])).toEqual([['FZ 1/MAG/10/2026', 'FV 10/10/2026', 123, '2026-10-20']])
  })

  it('should return 403 for MANAGER and 200 for ADMIN', async () => {
    state.session = { user: { id: 'm', role: 'MANAGER', name: 'M', email: 'm@test.pl' }, expires: '' }
    expect((await reconciliationRoute()).status).toBe(403)
  })

  it('should return 503 with a Polish message when the bridge is down', async () => {
    // route używa fetch globalnego → vi.stubGlobal('fetch', async () => { throw new TypeError('down') }) i env przez vi.stubEnv
    vi.stubEnv('SUBIEKT_BRIDGE_URL', 'https://bridge.test'); vi.stubEnv('SUBIEKT_BRIDGE_TOKEN', 'tok')
    vi.stubGlobal('fetch', async () => { throw new TypeError('down') })
    const response = await reconciliationRoute()
    expect([response.status, (await response.json()).error]).toEqual([503, 'Mostek Subiekt jest niedostępny. Sprawdź, czy komputer z bazą Subiekta jest włączony i połączony z siecią.'])
    vi.unstubAllGlobals(); vi.unstubAllEnvs()
  })
})
```

(Import: `import { GET as reconciliationRoute } from '@/app/api/finance/subiekt-purchases/reconciliation/route'`. Sprawdź, jak `requireFinanceAdmin` odrzuca MANAGER-a w `src/lib/finance/finance-access.ts` — jeżeli zwraca 401/redirect zamiast 403, dopasuj oczekiwanie do istniejącego zachowania, nie odwrotnie.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementacja serwisu** — dopisz do `src/lib/finance/subiekt-purchases.ts`:

```ts
import { reconcilePayments, type SettlementRow } from '@/lib/finance/subiekt-purchase-matching'

export interface SettlementView {
  invoiceId: string
  subiektNumber: string
  originalNumber: string | null
  supplierName: string | null
  issuedAt: string
  remaining: number | null
  grossPln: number
  appGrossPln: number | null
  paidAt: string | null
  amountDiffers: boolean
}

const toView = ({ document, invoice, amountDiffers }: SettlementRow): SettlementView => ({
  invoiceId: invoice.id, subiektNumber: document.number, originalNumber: document.original_number, supplierName: document.supplier_name,
  issuedAt: document.issued_at, remaining: document.remaining, grossPln: document.gross_total, appGrossPln: invoice.plnGross,
  paidAt: invoice.paidAt?.slice(0, 10) ?? null, amountDiffers,
})

export type ReconciliationResult =
  | {
      ok: true; from: string; to: string; checkedAt: string
      settleInSubiekt: SettlementView[]
      paidOnlyInSubiekt: SettlementView[]
      paidInAppMissingInSubiekt: Array<{ invoiceId: string; supplierName: string; invoiceNumber: string; issueDate: string; paidAt: string | null }>
      ambiguous: Array<{ subiektNumber: string; candidates: number }>
    }
  | { ok: false; error: string }

/** Read-only: compares app payment status with Subiekt liabilities for all FZ/KFZ in the window. */
export async function reconcileSubiektPayments(db: PrismaClient, options: PurchaseFetchOptions = {}): Promise<ReconciliationResult> {
  const now = options.now ?? new Date()
  // No import floor here: reconciliation covers domestic KSeF invoices that were in the app long before this feature.
  const fetched = await fetchPurchaseRange({ ...options, ...reconciliationRange(now) })
  if (!fetched.ok) return fetched
  const invoices = await loadInvoicesForMatch(db, fetched.from, fetched.to)
  const windowInvoices = invoices.filter((i) => i.issueDate >= fetched.from && i.issueDate <= fetched.to)
  const result = reconcilePayments(matchPurchases(fetched.documents, invoices), windowInvoices)
  const byIssue = (a: { issuedAt: string }, b: { issuedAt: string }) => a.issuedAt.localeCompare(b.issuedAt)
  return {
    ok: true, from: fetched.from, to: fetched.to, checkedAt: now.toISOString(),
    settleInSubiekt: result.settleInSubiekt.map(toView).sort(byIssue),
    paidOnlyInSubiekt: result.paidOnlyInSubiekt.map(toView).sort(byIssue),
    paidInAppMissingInSubiekt: result.paidInAppMissingInSubiekt.map((i) => ({
      invoiceId: i.id, supplierName: i.supplierName, invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, paidAt: i.paidAt?.slice(0, 10) ?? null,
    })),
    ambiguous: result.ambiguous.map((a) => ({ subiektNumber: a.document.number, candidates: a.invoiceIds.length })),
  }
}
```

Uwaga: `fetchPurchaseRange` zwraca `{ ok: false, kind, error }`; dodaj `kind: SubiektBridgeErrorKind` do wariantu błędu obu typów wyniku (`PurchaseImportResult`, `ReconciliationResult`) — route'y mapują go na status HTTP.

- [ ] **Step 4: Route'y**

`src/app/api/finance/subiekt-purchases/reconciliation/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { reconcileSubiektPayments } from '@/lib/finance/subiekt-purchases'

export const dynamic = 'force-dynamic'

/** ADMIN: live comparison of app payment status with Subiekt liabilities. Writes nothing. */
export async function GET() {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const result = await reconcileSubiektPayments(prisma)
  if (!result.ok) {
    const status = result.kind === 'not_configured' ? 409 : result.kind === 'unauthorized' ? 502 : 503
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }
  return NextResponse.json(result)
}
```

`src/app/api/finance/subiekt-purchases/import/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { importSubiektForeignPurchases } from '@/lib/finance/subiekt-purchases'

/** ADMIN: import foreign FZ/KFZ from Subiekt as invoices (idempotent). */
export async function POST() {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const result = await importSubiektForeignPurchases(prisma, { actorId: access.session.user.id })
  if (!result.ok) {
    const status = result.kind === 'not_configured' ? 409 : result.kind === 'unauthorized' ? 502 : 503
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }
  return NextResponse.json(result)
}
```

(Sprawdź kształt zwracany przez `requireFinanceAdmin` — `bulk-payment/route.ts` używa `auth.error` / `auth.session.user.id`; użyj tego samego.)

- [ ] **Step 5: Run** cały plik integracyjny → PASS.
- [ ] **Step 6: Commit** `feat(finance): Subiekt payment reconciliation and import endpoints`

### Task B5: Panel na `/finance/ksef`

**Files:**
- Create: `src/components/shared/subiekt-purchases-panel.tsx`
- Modify: `src/app/(dashboard)/finance/ksef/page.tsx` (render panelu nad `<KsefInboxView …/>`, gdy `readSubiektBridgeConfig()` ≠ null; przekazuje `lastImportAt` / `lastImportMessage` z `AppSetting`)
- Test: `__tests__/unit/finance/subiekt-purchases-panel.test.tsx`

Wymagania UI (po polsku, shadcn `Card`, `Button`, `Table`, `Badge`; styl spójny z `subiekt-revenue-panel.tsx`):
- Nagłówek „Subiekt GT — faktury zakupu”, linia statusu ostatniego importu.
- Przycisk **„Pobierz faktury UE z Subiekta”** → `POST /api/finance/subiekt-purchases/import`; po sukcesie komunikat z `message` i `router.refresh()`; błąd — komunikat z API.
- Przycisk **„Sprawdź rozliczenia”** → `GET …/reconciliation`; stan ładowania; wynik w trzech sekcjach:
  1. **„Do odhaczenia w Subiekcie”** (licznik w `Badge`): numer GT (przycisk kopiowania do schowka), numer obcy, dostawca, pozostało w GT, zapłacono w aplikacji (data), znacznik „kwota różni się” gdy `amountDiffers`.
  2. **„Opłacone w Subiekcie, otwarte w aplikacji”**.
  3. **„Opłacone w aplikacji, brak w Subiekcie”** + jedna linia o niejednoznacznych.
- Puste sekcje: „Brak — wszystko zgodne.” Okres (`from`–`to`) i godzina sprawdzenia nad listami.

- [ ] **Step 1: Test (czerwony)** — wzór: `__tests__/unit/finance/subiekt-revenue-ui.test.tsx` (mock `fetch`, `next/navigation`):

```tsx
it('should render the settle-in-Subiekt list after checking', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    ok: true, from: '2025-11-01', to: '2026-11-30', checkedAt: '2026-11-18T09:00:00.000Z',
    settleInSubiekt: [{ invoiceId: 'i1', subiektNumber: 'FZ 3/MAG/10/2026', originalNumber: 'FV 10/10/2026', supplierName: 'Hurt PL', issuedAt: '2026-10-10', remaining: 123, grossPln: 123, appGrossPln: 123, paidAt: '2026-10-20', amountDiffers: false }],
    paidOnlyInSubiekt: [], paidInAppMissingInSubiekt: [], ambiguous: [],
  }), { status: 200 })) as unknown as typeof fetch
  render(<SubiektPurchasesPanel lastImportAt={null} lastImportMessage={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
  expect(await screen.findByText('FZ 3/MAG/10/2026')).toBeInTheDocument()
})

it('should show the API error message when the bridge is down', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Mostek Subiekt jest niedostępny.' }), { status: 503 })) as unknown as typeof fetch
  render(<SubiektPurchasesPanel lastImportAt={null} lastImportMessage={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
  expect(await screen.findByText('Mostek Subiekt jest niedostępny.')).toBeInTheDocument()
})

it('should post the import and show its summary', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, created: 2, alreadyInApp: 1, ambiguous: 0, skippedDomestic: 5, message: 'Faktury UE z Subiekta: dodano 2, już w aplikacji 1, niejednoznaczne 0, krajowe pominięte 5.' }), { status: 200 })) as unknown as typeof fetch
  render(<SubiektPurchasesPanel lastImportAt={null} lastImportMessage={null} />)
  await userEvent.click(screen.getByRole('button', { name: 'Pobierz faktury UE z Subiekta' }))
  expect(await screen.findByText(/dodano 2/)).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/finance/subiekt-purchases/import', expect.objectContaining({ method: 'POST' }))
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementacja** komponentu (`'use client'`, typy odpowiedzi importowane z `@/lib/finance/subiekt-purchases` jako `import type`) i osadzenie w `page.tsx`. Strona dalej jest Server Componentem; żadnych handlerów poza panelem.
- [ ] **Step 4: Run** test → PASS; `npm run test __tests__/unit/finance/ksef-inbox-view.test.tsx __tests__/unit/finance/ksef-invoice-page-money.test.tsx` → PASS (strona KSeF bez regresji).
- [ ] **Step 5: Commit** `feat(finance): Subiekt purchases panel with payment reconciliation`

### Task B6: Codzienny import w harmonogramie Subiekta

**Files:**
- Modify: `src/lib/finance/subiekt-auto-sync.ts`
- Test: `__tests__/unit/finance/subiekt-auto-sync.test.ts`, `__tests__/integration/finance/subiekt-auto-sync-scheduler.test.ts`

- [ ] **Step 1: Test (czerwony)** — gdy `SUBIEKT_PURCHASES_AUTO_IMPORT=on`, slot 07:30 po odczycie sprzedaży wywołuje import (aktor = pierwszy aktywny ADMIN); gdy zmienna wyłączona — nie wywołuje; błąd importu nie zmienia statusu `OK` odczytu sprzedaży, tylko zapisuje `subiekt_purchases.last_import_message` z „Błąd: …”.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementacja** — w `runScheduledSubiektSync` po `refreshSubiektRevenue` (w tym samym `try`):

```ts
    if (process.env.SUBIEKT_PURCHASES_AUTO_IMPORT === 'on') {
      const admin = await db.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' } })
      if (admin) await importSubiektForeignPurchases(db as PrismaClient, { actorId: admin.id, now })
    }
```

Typ `AutoSyncDb` rozszerz o `'user' | 'ksefInvoice' | 'ksefSupplierRule'`; jeżeli rzutowanie na `PrismaClient` jest potrzebne przez `withAiQueueMutation`, zmień parametr `startSubiektAutoSyncScheduler` na `PrismaClient` (instrumentation i tak przekazuje `prisma`).

- [ ] **Step 4: Run** oba pliki → PASS.
- [ ] **Step 5: Commit** `feat(finance): daily import of foreign purchases from Subiekt`

### Task B7: Dowód end-to-end i dokumentacja

- [ ] **Step 1: Pełne testy:** `npm run test` i `npx tsc --noEmit` → PASS; `npm run build` → PASS (wykrywa błędy Next 16, których `tsc` nie łapie).
- [ ] **Step 2: Dowód lokalny w przeglądarce (Playwright MCP):** dev server z `SUBIEKT_BRIDGE_URL` wskazującym lokalny mostek na bazie testowej (`walldecor-bridge`: `npm run db:test:up`, `.env` → baza testowa, token `sales:read,purchases:read`). Na `/finance/ksef`: „Pobierz faktury UE z Subiekta” → w liście faktur pojawia się `RE-2026-0042` (Tapeten Fabrik GmbH, 4 250,00 PLN) i korekta; oznacz `FV 10/10/2026` (dodaną ręcznie testowo z KSeF-numerem) jako opłaconą → „Sprawdź rozliczenia” → pozycja w „Do odhaczenia w Subiekcie”. Zrzuty do `docs/evidence/subiekt-purchases-<data>/`.
- [ ] **Step 3: Dokumentacja:** `project_status.md` (nowe endpointy, panel, zmienne `SUBIEKT_PURCHASES_AUTO_IMPORT`, wymagany zakres tokena), `spec.md` (decyzja: faktury UE wprowadzane wyłącznie w Subiekcie; rozliczenia w GT ręcznie wg listy), `docs/adr/` — ADR „Subiekt jako źródło faktur zagranicznych, uzgodnienie tylko do odczytu”. `architecture.md` bez zmian (brak zmiany schematu) — dopisz tylko wartość `source = "SUBIEKT"` przy `KsefInvoice`.
- [ ] **Step 4: Memory** — zaktualizuj notatkę projektu (status, decyzje).
- [ ] **Step 5:** Zapytaj użytkownika o commit/push i PR.

## Wdrożenie produkcyjne (kolejność)

1. Mostek `0.2.0` na SERWER + token aplikacji `sales:read,purchases:read` (A6).
2. Coolify: `SUBIEKT_BRIDGE_TOKEN` = nowy token, `SUBIEKT_PURCHASES_IMPORT_FROM` = data startu (pierwszy dzień miesiąca, od którego faktury UE wprowadzane są już tylko w Subiekcie); po weryfikacji ręcznego importu — `SUBIEKT_PURCHASES_AUTO_IMPORT=on`.
3. Pierwszy import ręcznie z panelu; sprawdzić „już w aplikacji” (dotychczas dodane ręcznie faktury UE) i „niejednoznaczne” — te rozstrzyga człowiek.
4. Od tej chwili faktury UE wprowadzane tylko w Subiekcie.

## Poza zakresem (świadomie)

- Zapis rozliczeń do Subiektu (Sfera) — osobny plan, jeżeli lista „Do odhaczenia” okaże się niewystarczająca.
- Aktualizacja faktury w aplikacji po edycji FZ w Subiekcie (import pomija dopasowane dokumenty).
- Daty zapłaty z Subiekta (narzędzie zwraca tylko stan zobowiązania).
