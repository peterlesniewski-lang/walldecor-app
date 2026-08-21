# WallDecor Installation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production change follows superpowers:test-driven-development: test first, observe the expected failure, add the minimum implementation, observe green, then refactor.

**Goal:** Dostarczyć w `app.walldecor.pl` kompletny system obsługi montaży od karty zlecenia i formularza klienta, przez wizyty i materiały, do protokołu, zadania fakturowego, korespondencji i kopii bezpieczeństwa — bez zależności od Twenty CRM.

**Architecture:** Funkcje domenowe powstają jako osobny moduł `Installation*` w istniejącej aplikacji Next.js/Prisma. Publiczne linki udostępniają wyłącznie bezpieczną projekcję zlecenia. Skutki zewnętrzne przechodzą przez trwały outbox i adaptery Google/testowe. Prywatne pliki używają osobnego wolumenu i API serwera mediów; obecne publiczne pliki marketingowe pozostają bez zmian.

**Tech Stack:** Next.js 16.1, React 19, TypeScript strict, Prisma 5.22 + SQLite, NextAuth Credentials/JWT, Zod 4, Tailwind 4, Vitest, Playwright, Gmail API, Google Calendar API, Google Sheets API, Node media API, Coolify.

---

## 0. Nienegocjowalne zasady odbioru

- Żaden widoczny element interaktywny nie jest atrapą: działa albo nie istnieje.
- Dane ekranów pochodzą z bazy; akcja zapisuje stan; upload zapisuje i zwraca te
  same bajty; PDF jest prawdziwym `application/pdf`.
- Statusy Prisma są polami `String` walidowanymi stałymi i Zod — SQLite nie
  otrzymuje natywnych enumów.
- Każdy dynamiczny route Next.js 16 używa `params: Promise<...>` i `await params`.
- Puste pola formularza są usuwane z payloadu albo przyjmowane przez `.nullish()`;
  pusty string nie trafia do `z.enum()` ani `z.coerce.date()`.
- Każda aktywna karta ma różne osoby: głównego opiekuna i obowiązkowe zastępstwo.
- `ADMIN` i `MANAGER` widzą wszystkie karty. `EMPLOYEE` widzi karty, których jest
  opiekunem, zastępcą lub czasowym delegatem. `INSTALLER` widzi wyłącznie
  przypisane zakresy i wizyty, bez finansów, HR i wewnętrznej korespondencji.
- Link klienta jest przechowywany wyłącznie jako hash; token wygasły, cofnięty
  i nieistniejący dają ten sam publiczny rezultat `404`.
- Odpowiedź `Nie wiem` pozwala wysłać formularz i tworzy kwestię
  `Wymaga ustalenia`; gotowość blokuje dopiero otwarta kwestia, nie sam brak liczby.
- Opłata za bezskuteczny podjazd nie nalicza się automatycznie. Wymaga migawki
  kwoty/klauzuli zaakceptowanej przez klienta, raportu z dowodem i zatwierdzenia
  opiekuna/zastępcy/admina/managera. Produkcyjna aktywacja klauzuli wymaga daty
  zatwierdzenia prawnego w ustawieniach.
- Gmail, Calendar i Sheets nie są wywoływane z requestu użytkownika. Mutacja
  domenowa i wpis outboxa powstają w jednej transakcji.
- Tryb testowy używa jawnie wstrzykniętych fake adapterów i nigdy nie kontaktuje
  klientów ani Google.
- Każdy loop kończy: testy jednostkowe + integracyjne + typecheck/build +
  walidator skutków + Playwright E2E. Limit pięciu iteracji naprawczych; potem
  status `BLOCKED` z dowodem zamiast fałszywego `done`.
- Raport loopa zawiera komendy, ich świeży output i dowody skutków. Bez sekcji
  `DOWÓD` loop pozostaje otwarty.

## 1. Granice plików

### Aplikacja

```text
prisma/schema.prisma                         modele i relacje
prisma/migrations/*_installation_*/          jawne migracje SQLite
src/lib/installations/constants.ts           literalne statusy/role modułu
src/lib/installations/schemas.ts             schematy wejścia Zod
src/lib/installations/access.ts              jedna polityka RBAC
src/lib/installations/state-machine.ts       przejścia i blokady
src/lib/installations/order-service.ts       transakcyjne CRUD karty
src/lib/installations/catalog-service.ts     katalog i publikacja szablonu
src/lib/installations/measurement-service.ts wymiary pomieszczeń i zakresów
src/lib/installations/form-service.ts        snapshot, autosave, submit, korekta
src/lib/installations/client-link.ts         tokeny i bezpieczna projekcja
src/lib/installations/delegation-service.ts  opiekun/zastępstwo/delegacja/audyt
src/lib/installations/readiness.ts            warunki gotowości
src/lib/installations/visit-service.ts       wizyty i przypisanie zakresów
src/lib/installations/material-service.ts    lifecycle materiałów
src/lib/installations/protocol-service.ts    raport/odbiór/zadanie fakturowe
src/lib/installations/protocol-pdf.ts        deterministyczny PDF
src/lib/installations/integration-outbox.ts  claim/lease/retry/dead/requeue
src/lib/integrations/google/*                Gmail, Calendar, Sheets
src/lib/installation-media/*                 klient prywatnego media API i handoff
src/app/(dashboard)/installations/**         panel wewnętrzny
src/app/m/[token]/**                         prosty formularz klienta
src/app/m/u/[code]/**                        mobilny upload QR
src/app/api/installations/**                 wewnętrzne API
src/app/api/public/installations/**          publiczna projekcja i zapis
src/app/api/internal/jobs/**                 chroniony worker
src/components/installations/**              klienty UI modułu
__tests__/unit/installations/**              logika bez I/O
__tests__/integration/installations/**       świeża tymczasowa SQLite
e2e/installations-*.spec.ts                  zachowania przez UI
scripts/validate-installation-*.mjs          walidatory skutków
```

Każdy plik serwisowy ma jedną odpowiedzialność. Komponent UI nie zawiera reguł
statusów, uprawnień, tokenów, retry ani kalkulacji opłaty.

### Serwer mediów

```text
src/private-files.js                         strumień, hash, atomowy zapis
src/private-signing.js                       wygasające podpisy pobrania
src/sniffing.js                              magic bytes i allowlista
src/server.js                                routing bez logiki storage
test/private-media-api.test.js               roundtrip i bezpieczeństwo
compose.yml                                  osobny private volume
ops/gdrive-backup.sh                         szyfrowany backup + manifest
ops/restore-verify.sh                        odtworzenie i kontrola SHA
```

## 2. Trzy dostarczalne etapy

1. **Intake:** karta, katalog, kreator, wersjonowany formularz, flagi, opłata,
   opiekun/zastępca/delegacja oraz prywatne pliki/QR.
2. **Realizacja:** konta instalatorów, wizyty, zakresy wielu osób, Calendar,
   materiały, przekazania i brief instalatora.
3. **Zamknięcie:** raporty, odbiór per wizyta, podpis i PDF, zadanie fakturowe,
   Gmail/przypomnienia, Sheets, wiki, backup oraz pełny scenariusz produkcyjny.

Twenty CRM jest poza tym planem. Modele mogą mieć nullable `externalSystem` i
`externalId`, ale żaden loop nie tworzy UI ani synchronizacji Twenty.

---

## Etap 1 — Intake

### Task 1: Izolowany harness danych i pionowa karta zlecenia

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822010000_installation_order/migration.sql`
- Create: `src/lib/installations/constants.ts`
- Create: `src/lib/installations/schemas.ts`
- Create: `src/lib/installations/access.ts`
- Create: `src/lib/installations/order-service.ts`
- Create: `src/app/api/installations/route.ts`
- Create: `src/app/api/installations/[id]/route.ts`
- Create: `src/app/(dashboard)/installations/page.tsx`
- Create: `src/app/(dashboard)/installations/new/page.tsx`
- Create: `src/app/(dashboard)/installations/[id]/page.tsx`
- Create: `src/components/installations/order-form.tsx`
- Create: `src/components/installations/order-list.tsx`
- Create: `src/components/installations/order-detail.tsx`
- Modify: `src/components/shared/sidebar.tsx`
- Create: `__tests__/unit/installations/order-rules.test.ts`
- Create: `__tests__/integration/installations/order-crud.test.ts`
- Create: `e2e/installations-order.spec.ts`
- Create: `scripts/validate-installation-order.mjs`

- [ ] **Step 1: Test RED — reguły karty**

  Napisz testy wywołujące `parseCreateInstallationOrder()` i
  `canAccessInstallationOrder()`: brak zastępcy, ta sama osoba w obu rolach,
  nieaktywny pracownik i puste dane klienta mają być odrzucone; admin/manager
  mają pełen dostęp, employee wyłącznie jako primary/backup/delegate, installer
  wyłącznie przez przypisanie. Uruchom:

  ```bash
  npm test -- __tests__/unit/installations/order-rules.test.ts
  ```

  Oczekiwany RED: importy `@/lib/installations/*` nie istnieją.

- [ ] **Step 2: GREEN — minimalne stałe, Zod i polityka**

  Zdefiniuj literalne role `ADMIN | MANAGER | EMPLOYEE | INSTALLER`, statusy
  `DRAFT | AWAITING_CLIENT | READY_TO_PLAN | SCHEDULED | IN_PROGRESS |
  AWAITING_ACCEPTANCE | AWAITING_INVOICE | CLOSED | ON_HOLD | CANCELLED |
  ARCHIVED` i czyste funkcje dostępu. Po implementacji uruchom ten sam test i
  wymagaj wszystkich przypadków zielonych.

- [ ] **Step 3: Test RED — trwały CRUD na świeżej SQLite**

  Integration test tworzy admina, trzech aktywnych pracowników i kartę z
  klientem/adresem/opiekunem/zastępcą, następnie listuje, odczytuje, edytuje
  telefon/adres, archiwizuje i uruchamia nową instancję Prisma na tej samej
  tymczasowej bazie. Oczekuje utrzymania zmian, `@@unique(number)` i FK.

  ```bash
  npm test -- __tests__/integration/installations/order-crud.test.ts
  ```

  Oczekiwany RED: brak tabel `InstallationClient` i `InstallationOrder`.

- [ ] **Step 4: GREEN — model i serwis transakcyjny**

  Dodaj `InstallationClient`, `InstallationOrder`, `InstallationDelegation` i
  `InstallationAuditEvent`. Tokeny i integracje jeszcze nie należą do tego
  taska. `archiveOrder()` ustawia `archivedAt/status=ARCHIVED`, nie kasuje
  historii. Rozszerz blokadę usunięcia pracownika o relacje montażowe.

- [ ] **Step 5: Test RED/GREEN — API i pełne UI**

  Route testy pokrywają `401`, `403`, `400`, create/list/get/update/archive.
  Strony używają Server Components do danych i Client Components do interakcji.
  Formularz ma działające pola klienta, adres, primary i backup; lista prowadzi
  do szczegółu; szczegół pozwala edytować i archiwizować.

- [ ] **Step 6: E2E i walidator skutków**

  Playwright loguje admina, tworzy kartę, widzi ją na liście, edytuje adres,
  odświeża stronę, archiwizuje i potwierdza zniknięcie z aktywnej listy.
  Walidator wykonuje ten sam roundtrip przez API i sprawdza rekord w osobnej DB.

  ```bash
  npm test -- __tests__/unit/installations __tests__/integration/installations
  npm run build
  node scripts/validate-installation-order.mjs
  npm run test:e2e -- e2e/installations-order.spec.ts
  ```

- [ ] **Step 7: Audyt atrap i commit**

  Kliknij każdy element zmienionych ekranów; potwierdź edit/archive/persistence
  i `403` dla obcego employee/installer. Zapisz DOWÓD i commit:

  ```bash
  git add prisma src __tests__ e2e scripts
  git commit -m "feat: add installation order workflow"
  ```

### Task 2: Dynamiczny katalog, pokoje, zakresy i wersjonowany kreator pytań

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822020000_installation_catalog/migration.sql`
- Create: `src/lib/installations/catalog-service.ts`
- Create: `src/lib/installations/question-schema.ts`
- Create: `src/app/api/installations/catalog/**`
- Create: `src/app/api/installations/templates/**`
- Create: `src/app/api/installations/[id]/rooms/**`
- Create: `src/components/installations/catalog-manager.tsx`
- Create: `src/components/installations/template-builder.tsx`
- Create: `src/components/installations/room-scope-editor.tsx`
- Create: `__tests__/unit/installations/question-schema.test.ts`
- Create: `__tests__/integration/installations/catalog-template.test.ts`
- Create: `e2e/installations-catalog.spec.ts`

- [ ] **Step 1: RED — katalog nie jest hardcoded**

  Test wymaga create/list/edit/reorder/archive dla kategorii, typu i produktu;
  zmiana nazwy w DB musi zmienić opcję widoczną w API bez przebudowy aplikacji.

- [ ] **Step 2: GREEN — modele katalogu**

  Dodaj `InstallationCatalogCategory`, `InstallationCatalogType` i
  `InstallationCatalogProduct` z `sortOrder`, `isActive`, unikalnością nazw w
  rodzicu i archiwizacją. Produkt przechowuje producenta/kolekcję/kod jako pola
  nullable, nie jako jeden nieparsowalny string.

- [ ] **Step 3: RED — publikacja nie mutuje historii**

  Test tworzy draft szablonu, pytanie `Tak/Nie/Nie wiem`, warunek ujawniający
  liczbę centymetrów dla glifów, publikuje v1, tworzy snapshot zlecenia, publikuje
  v2 i sprawdza, że snapshot nadal ma v1.

- [ ] **Step 4: GREEN — builder i snapshot**

  Dodaj `InstallationFormTemplate`, `InstallationQuestionDefinition` i
  `InstallationOrderFormSnapshot(schemaJson, templateId, templateVersion)`.
  Walidator schematu dopuszcza typy `YES_NO_UNKNOWN | NUMBER | DIMENSION | TEXT |
  SINGLE | MULTI | FILE`, prosty warunek równości, poziom ryzyka i pomoc. Odrzuca
  cykle, brakujące klucze i warunek wskazujący pytanie z innego template.

- [ ] **Step 5: RED/GREEN — pokoje i produkty w zleceniu**

  Pełny CRUD `InstallationRoom`, `InstallationScope` i
  `InstallationScopeProduct`; produkt zapisuje snapshot nazwy/kodu, aby późniejsza
  edycja katalogu nie zmieniła historycznego zakresu. `InstallationMeasurement`
  przechowuje nazwę mierzonego elementu, wartość dziesiętną, jednostkę, źródło
  `CLIENT|EMPLOYEE|INSTALLER`, autora i czas; UI pozwala dodać, poprawić oraz
  usunąć błędny pomiar bez utraty wpisu audytowego.

- [ ] **Step 6: UI/E2E/commit**

  Admin tworzy własną pozycję katalogu i szablon bez kodu; opiekun dodaje dwa
  pokoje i różne produkty; po archiwizacji produktu historyczne zlecenie nadal
  pokazuje snapshot, lecz nowa karta nie oferuje pozycji.

  ```bash
  npm test -- __tests__/unit/installations __tests__/integration/installations
  npm run build
  npm run test:e2e -- e2e/installations-catalog.spec.ts
  git add prisma src __tests__ e2e
  git commit -m "feat: add installation catalog and form templates"
  ```

### Task 3: Publiczny link, autosave, wysłanie, korekty i flagi

**Files:**
- Modify: `prisma/schema.prisma`, `src/proxy.ts`
- Create: `prisma/migrations/20260822030000_installation_client_form/migration.sql`
- Create: `src/lib/installations/client-link.ts`
- Create: `src/lib/installations/form-service.ts`
- Create: `src/lib/installations/readiness.ts`
- Create: `src/app/m/[token]/page.tsx`
- Create: `src/app/api/public/installations/[token]/route.ts`
- Create: `src/app/api/public/installations/[token]/autosave/route.ts`
- Create: `src/app/api/public/installations/[token]/submit/route.ts`
- Create: `src/app/api/installations/[id]/clarifications/**`
- Create: `src/components/installations/client-form/**`
- Create: `__tests__/unit/installations/client-link.test.ts`
- Create: `__tests__/unit/installations/form-rules.test.ts`
- Create: `__tests__/integration/installations/client-form.test.ts`
- Create: `e2e/installations-client-form.spec.ts`

- [ ] **Step 1: RED/GREEN — token i bezpieczna projekcja**

  Generator zwraca losowy token >= 256 bitów, baza zapisuje tylko SHA-256.
  Publiczna projekcja zawiera markę, numer, kontakt opiekuna, pokoje, snapshot
  pytań i dotychczasowe odpowiedzi; nigdy ceny, notatki, audyt, pracowników ani
  zadania. Brak/wygasły/revoked token daje identyczne `404`.

- [ ] **Step 2: RED/GREEN — autosave i wysłanie**

  Dodaj `InstallationFormSubmission` i `InstallationAnswer`. Autosave jest
  idempotentny po `submissionId + revision`; odrzuca odpowiedź na ukryte pytanie
  i zachowuje jawne `UNKNOWN`. Submit tworzy niemutowalną wersję; kolejne zmiany
  tworzą korektę `revisionOfId`, nie nadpisują historii.

- [ ] **Step 3: RED/GREEN — flagi**

  `UNKNOWN`, brak doprecyzowania pola wysokiego ryzyka albo reguła odpowiedzi
  tworzą `InstallationClarification`. Opiekun rozwiązuje ją ustaleniem, dowodem
  albo `WAIVED` z obowiązkowym uzasadnieniem. Otwarta blokada uniemożliwia
  `READY_TO_PLAN`; zwykła brakująca wartość nie tworzy cichego błędu.

- [ ] **Step 4: UI zgodne z zapisanym systemem**

  Przed każdym komponentem zapisz checkpoint z
  `.interface-design/system.md`. Formularz nie używa sidebaru, pokazuje Mapę
  zlecenia, grupy 2–4 pytań, duże kontrolki, `Zapisywanie…/Wszystko zapisane`,
  podsumowanie i `Ustalimy przed montażem`. Ma loading/empty/error/focus/disabled.

- [ ] **Step 5: E2E/commit**

  Klient odpowiada `Tak` na glify, widzi pole centymetrów, wybiera `Nie wiem`,
  odświeża i zachowuje postęp, wysyła formularz; opiekun widzi flagę, rozwiązuje
  ją i uzyskuje gotowość. Następnie klient zgłasza korektę i obie wersje pozostają.

  ```bash
  npm test -- __tests__/unit/installations __tests__/integration/installations
  npm run build
  npm run test:e2e -- e2e/installations-client-form.spec.ts
  git add prisma src __tests__ e2e .interface-design
  git commit -m "feat: add adaptive client installation intake"
  ```

### Task 4: Opiekun, zastępstwo, delegacja i klauzula podjazdu

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822040000_installation_governance/migration.sql`
- Create: `src/lib/installations/delegation-service.ts`
- Modify: `src/lib/installations/readiness.ts`
- Create: `src/app/api/installations/[id]/ownership/route.ts`
- Create: `src/app/api/installations/[id]/visit-fee/route.ts`
- Create: `src/components/installations/ownership-panel.tsx`
- Create: `src/components/installations/visit-fee-panel.tsx`
- Create: `__tests__/unit/installations/delegation.test.ts`
- Create: `__tests__/integration/installations/governance.test.ts`
- Create: `e2e/installations-governance.spec.ts`

- [ ] **Step 1: RED/GREEN — audytowana odpowiedzialność**

  Admin/manager zmienia primary/backup, tworzy delegację z `startsAt/endsAt/reason`,
  kończy ją wcześniej i przywraca dostęp. Historia zachowuje poprzednie/nowe ID,
  autora i czas. Urlop nie jest wymagany. System nie pozwala pozostawić karty bez
  dwóch różnych aktywnych osób.

- [ ] **Step 2: RED/GREEN — kwota i klauzula**

  Dodaj ustawienie firmy z domyślną kwotą brutto i wersjonowaną treścią oraz pola
  migawki na zleceniu. Opiekun wybiera default; inna kwota ma status
  `PENDING_APPROVAL` do akceptacji admin/managera. Publiczny formularz wymaga
  checkboxa z dokładną kwotą i zapisuje `acceptedAt`, wersję, IP hash i user agent.
  Gdy brak `legalApprovedAt`, klauzula jest technicznie nieaktywna.

- [ ] **Step 3: RED/GREEN — udokumentowana niezgodność**

  Instalator będzie mógł później zgłosić zdarzenie, ale już teraz model
  `InstallationMismatch` wymaga opisu, przyczyny braku/ryzyka wykonania i dowodu
  plikowego; bez zatwierdzenia koordynatora nie tworzy `InstallationBillingTask`.

- [ ] **Step 4: E2E/commit**

  Zastępca przejmuje kartę, admin deleguje ją trzeciej osobie i przywraca stan.
  Klient widzi zatwierdzoną kwotę i nie wyśle formularza bez potwierdzenia; przy
  niezatwierdzonej prawnie konfiguracji checkbox nie jest pokazywany.

### Task 5: Prywatne pliki i mobilny handoff QR

**Repository boundary:** najpierw osobny worktree `walldecor-media-server`, potem
adapter aplikacji. Nie modyfikować zachowania istniejącego `/files/*`.

- [ ] **Step 1: RED — prywatny roundtrip serwera mediów**

  Test wysyła prawdziwe minimalne JPEG/PNG/WebP/PDF, fałszywy MIME, HTML udający
  PDF, oversize, zły bearer, wygasły/zmieniony podpis i delete. Oczekuje zapisu
  bajt-w-bajt, pełnego SHA-256, `private,no-store`, `nosniff` i braku publicznego
  URL. Uruchom test i obserwuj brak endpointu.

- [ ] **Step 2: GREEN — osobny wolumen i API**

  Strumieniowy temp file → hash/sniff/scan hook → `fsync` → atomowy rename do
  `installation-private-data/jobs/<jobId>/<fileId>/original.<ext>`. Caddy,
  FileBrowser i publiczny imgproxy nie montują tego wolumenu. Podpis pobrania
  obejmuje `fileId + exp`, maksymalnie 60 sekund.

- [ ] **Step 3: RED/GREEN — rekordy i proxy aplikacji**

  Dodaj `InstallationFile`, `MobileUploadHandoff` i audyt. Przeglądarka wysyła
  multipart tylko do aplikacji; aplikacja sprawdza RBAC i dodaje serwerowy token.
  Pobranie bez uprawnienia to `403`, klient publiczny widzi tylko pliki jawnie
  związane z jego pytaniem, soft-delete od razu odbiera dostęp.

- [ ] **Step 4: RED/GREEN — QR na dokładne pytanie**

  Handoff zapisuje hash losowego kodu, `questionKey`, limity, expiry i allowed
  MIME. Pierwsze otwarcie spala kod i ustawia `HttpOnly Secure SameSite=Lax`
  cookie. Telefon może tylko dodawać; nie listuje/pobiera/usuwa. Upload używa
  osobnych kontrolek aparatu `capture="environment"` i biblioteki plików.

- [ ] **Step 5: Restart/E2E/commit**

  Desktop pokazuje QR, telefon dodaje zdjęcie, desktop widzi je po synchronizacji,
  klient wysyła formularz, opiekun pobiera te same bajty. Po restarcie obu usług
  plik nadal działa; po revoke nie. DOWÓD zawiera SHA wejścia i pobrania.

---

## Etap 2 — Realizacja

### Task 6: Konto instalatora i szczelna nawigacja

- Dodaj globalny literal `INSTALLER` w schemacie walidacji użytkowników, NextAuth,
  typach sesji i proxy.
- Installer po logowaniu trafia do `/installations/my-visits`; nie może otworzyć
  `/finance`, `/hr`, `/settings` ani nieprzypisanej karty przez stronę lub API.
- Napraw istniejący wyciek pełnych procedur Operations: nie serializuj procedury,
  której employee/installer nie ma przyznanej.
- E2E tworzy konto instalatora z hasłem tymczasowym, wymusza zmianę hasła,
  pokazuje przypisaną wizytę i potwierdza `403`/redirect dla danych zabronionych.

### Task 7: Wizyty, wielu instalatorów i Google Calendar

- Modele: `InstallationVisit`, `InstallationVisitScope`,
  `InstallationScopeAssignment`, `IntegrationOutbox`, `IntegrationSyncState`,
  `IntegrationAttempt`.
- Wizyta przechowuje UTC, prezentuje `Europe/Warsaw`, ma ręczny termin lub brak
  terminu. Potwierdzona wizyta tworzy outbox `CALENDAR_UPSERT`.
- Fake adapter dowodzi: jedno stabilne `eventId`, pełna lista unikalnych gości,
  update w miejscu po zmianie terminu, ETag `412` jako konflikt i cancel.
- Google adapter używa firmowego `calendarId`, `sendUpdates=all`, prywatnego
  extended property z ID wizyty i nigdy nie loguje tokenu.
- E2E tworzy dwie wizyty, przypisuje trzech instalatorów do różnych zakresów,
  zmienia pierwszy termin i sprawdza w fake Calendar jedno zaktualizowane wydarzenie.

### Task 8: Materiały i potwierdzone przekazania

- Modele `InstallationMaterial` i niemutowalny `InstallationMaterialEvent`.
- Statusy: `TO_ORDER | ORDERED | AT_WALLDECOR | AT_CLIENT |
  HANDED_TO_INSTALLER | READY | PROBLEM`.
- Przekazanie wymaga ilości, wydającego, odbierającego i czasu; instalator
  potwierdza odbiór. Zwrot/przekazanie innej osobie są nowymi eventami.
- E2E pokazuje materiał w karcie, przekazuje go instalatorowi, instalator
  potwierdza, a historia i stan wynikowy pozostają po restarcie.

---

## Etap 3 — Zamknięcie i automatyzacje

### Task 9: Raport wizyty, odbiór zakresu, podpis i PDF

- Raport: `COMPLETED | PARTIAL | NOT_COMPLETED | NEEDS_ANOTHER_VISIT`, notatka,
  pliki końcowe, pozostały materiał i kwestie.
- Protokół jest per wizyta i zakres, klient otwiera go bez konta przez osobny
  token; odbiera bez uwag, z uwagami lub odmawia, podaje imię i podpisuje canvas.
- Uwagi/odmowa tworzą clarification, blokują zamknięcie, nie tworzą reklamacji.
- Endpoint PDF zwraca realny `application/pdf`, zawiera strony/zakres/wynik/
  podpis/hash wersji; bez uprawnień `403`, po korekcie stary PDF ma historię.
- E2E pokrywa odbiór po każdej z dwóch wizyt i zbiorczy PDF po zakończeniu.

### Task 10: Zadania fakturowe i opłata za podjazd

- Wygenerowanie protokołu idempotentnie tworzy `InstallationBillingTask` z
  klientem, zakresem, bazową kwotą, zaakceptowanymi dopłatami i sumą.
- Ta sama transakcja tworzy outbox e-maila do skonfigurowanej grupy WallDecor
  z komunikatem o konieczności wystawienia faktury i linkiem do zadania; trwały
  brak odbiorców blokuje aktywację reguły, a nie po cichu gubi powiadomienie.
- Task zamyka się numerem i datą faktury oraz opcjonalnym prywatnym PDF/linkiem.
- Zdarzenie niezgodności może utworzyć osobny task opłaty tylko po spełnieniu
  warunków Task 4 i ręcznym zatwierdzeniu. Każda odmowa pozostawia audyt.
- E2E generuje protokół, widzi jeden task mimo retry, zamyka numerem faktury i
  potwierdza zniknięcie aktywnego alertu.

### Task 11: Gmail, przypomnienia, Sheets i niezawodny worker

- Gmail API wysyła z `info@walldecor.pl`, zapisuje Gmail message/thread ID i
  deterministyczny RFC `Message-ID`; kolejne przypomnienia używają threadId,
  `In-Reply-To`, `References` i zgodnego subject. Wiadomość trafia do Sent.
- Harmonogram: ręczne `Przypomnij teraz`, 3 dni po pierwszej wiadomości, 7 i 2
  dni przed terminem; domyślny due formularza to 14 dni przed montażem, a due
  zamknięcia flag 7 dni przed montażem. Obie daty można zmienić ręcznie z audytem.
  Submit formularza kończy przypomnienia, odpowiedź e-mail nie.
- Sheets zapisuje wyłącznie summary pól z planu, przez outbox i idempotentny
  `rowKey=installationNumber`; nie wysyła odpowiedzi, podpisów ani plików.
- Worker używa claim/lease dla SQLite, retry z backoff+jitter, `dead` i adminowe
  requeue. Endpoint internal jest POST-only i chroniony osobnym bearerem
  porównywanym `timingSafeEqual`.
- Test timeout-po-zaakceptowaniu nie duplikuje maila; worker nie wykonuje future/
  leased jobów; E2E sprawdza fake Gmail Sent/thread i aktualizację jednego wiersza.

### Task 12: Wiki, backup, restore i gotowość produkcyjna

- Rozszerz Business Wiki o role/granty tak, by instalator widział wyłącznie
  instrukcje montażowe; usuń istniejący wyciek procedur.
- Dodaj konkretne polskie instrukcje dla opiekuna, zastępcy, instalatora i admina.
- Backup codzienny obejmuje SQLite + prywatny wolumen, szyfruje przed GDrive,
  utrzymuje 30 dziennych/12 miesięcznych, zapisuje manifest SHA-256. Klucz nie
  znajduje się na VPS ani w backupie.
- Restore-verify odtwarza czystą kopię, uruchamia `PRAGMA integrity_check`, FK
  check, porównuje manifest i pobiera przykładowy plik bajt-w-bajt.
- Admin widzi ostatni udany backup, restore drill, dead letters oraz stan Google.

---

## 3. Finalny scenariusz „dzień z życia”

Na czystej bazie i fake integracjach, bez SQL i bez zaglądania do kodu:

1. Admin tworzy użytkowników: opiekun, zastępca i trzech instalatorów.
2. Admin dodaje nowe typy produktów i publikuje wersję formularza.
3. Opiekun tworzy klienta, kartę, dwa pokoje, zakresy i produkty, ustawia
   zastępstwo, oba terminy kontrolne i zaakceptowaną prawnie kwotę podjazdu.
4. Gmail fake zapisuje pierwszą wiadomość w Sent i identyfikatorze wątku.
5. Klient otwiera link na desktopie, odpowiada o glifach, wybiera `Nie wiem`,
   robi zdjęcie przez handoff QR na telefonie, akceptuje klauzulę i wysyła.
6. Opiekun rozwiązuje flagę; zastępca ma dostęp; admin deleguje kartę trzeciej
   osobie i przywraca układ.
7. Opiekun tworzy dwie wizyty i przydziela różnych instalatorów do tapet,
   sztukaterii ściennej i gipsowej. Calendar fake ma dwa wydarzenia; zmiana
   terminu aktualizuje jedno, nie tworzy trzeciego.
8. Materiał zostaje przekazany i potwierdzony przez instalatora.
9. Installer widzi tylko własne zadania, raportuje częściowe wykonanie i dowody.
10. Klient odbiera zakres z uwagami i podpisem; opiekun zamyka clarification.
11. Po drugiej wizycie klient odbiera resztę; system generuje PDF i jeden task
    fakturowy, a skrzynka firmowa dostaje e-mail o wystawieniu faktury.
12. Pracownik zamyka task numerem faktury; Sheets fake ma jeden aktualny wiersz.
13. Restart aplikacji i media API nie traci danych/pliku. Backup zostaje
    odtworzony do czystej lokalizacji z zgodnym SHA i poprawną bazą.
14. Każdy widoczny element zmienionych ekranów zostaje kliknięty; druga rola
    nie widzi cudzych danych; linki revoked/expired przestają działać.

Pełna bramka finałowa:

```bash
npm test
npm run lint
npm run build
npm run test:e2e
node scripts/validate-installation-system.mjs
```

Do dowodu produkcyjnego dochodzą kontrolowane smoke testy na testowym kliencie
WallDecor: Gmail Sent/thread, Calendar update tego samego eventu, Sheets readback,
HTTP prywatnego pliku, restart kontenerów i restore drill. Bez tych odczytów
status brzmi `kod gotowy, integracja produkcyjna niepotwierdzona`, nie `gotowe`.

## 4. Audyt atrap przed odbiorem każdego taska

1. Kliknij każdy widoczny element interaktywny zmienionych ekranów.
2. Utwórz, otwórz, edytuj i zarchiwizuj/usuwaj tylko tam, gdzie plan na to pozwala.
3. Zrestartuj proces i potwierdź trwałość danych oraz plików.
4. Pobierz to, co wgrano; porównaj content-type, rozmiar i SHA.
5. Przejdź workflow na czystej bazie bez ręcznej ingerencji.
6. Sprawdź każdą rolę i obcy zasób; brak dostępu ma być jawny i bez wycieku.
7. Zmień dane w bazie przez API/UI i sprawdź zmianę ekranu — brak hardcode.
