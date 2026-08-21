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
| `npm test -- __tests__/unit/installations/order-rules.test.ts` | 33/33, exit 0 |
| `npm test -- __tests__/integration/installations/order-crud.test.ts` | 2/2, exit 0 |
| `npm test` | 53 pliki, 313/313, exit 0 |
| `npm run build` | exit 0; Turbopack 4.6 s, TypeScript i 130 route'ów |
| `node scripts/validate-installation-order.mjs` | exit 0; `persistedStatus: ARCHIVED` |
| `npm run test:e2e -- e2e/installations-order.spec.ts` | 1/1, exit 0 (6.9 s) |

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
