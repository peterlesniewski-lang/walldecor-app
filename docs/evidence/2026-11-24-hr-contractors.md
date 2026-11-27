# Etap 4 — Wykonawcy poza HR (#45) — raport

**Data:** 2026-11-27 · **Gałąź:** `hr-contractors-45` (od `origin/main` 32065a8) · **Schemat bazy:** bez zmian, bez migracji (D12). Wszystkie osoby w testach i zrzutach są syntetyczne.

## DOWÓD

### Bramka

| # | Polecenie | Wynik |
|---|---|---|
| 1 | `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` | 4315 przeszło, 4 nie przeszły — dokładnie 4 znane testy `__tests__/unit/invoice-import/document-processor.test.ts` (brak Popplera na tym Macu); reszta zielona |
| 2 | `npm run typecheck:app` | exit 0 |
| 3 | `npx eslint <50 zmienionych i dodanych plików .ts/.tsx>` | exit 0, 0 błędów (3 ostrzeżenia sprzed zmiany: `_req`, `localIso`, `_divisions`) |
| 4 | `npm run build` | exit 0 |
| 5 | `npx playwright test e2e/hr-contractors.spec.ts e2e/hr-time-tracking.spec.ts` + wszystkie `e2e/installations-*.spec.ts` (acceptance-protocol, calendar-ui, calendar, card, catalog, client-form, governance, media, order) | 21 testów przeszło, 2 nie przeszły w jednym przebiegu (exit 1): `hr-contractors` 9/9 i `hr-time-tracking` zielone; `installations-catalog` czerwony także na czystym HEAD, `installations-order` czerwony tylko w przebiegu zbiorczym (osobno zielony) — patrz „Playwright" na końcu |

### Punkty Definition of Done

| Punkt DoD | Dowód |
|---|---|
| Zakładka „Pracownicy" bez B2B, „Wykonawcy" tylko B2B, liczniki = liczba wierszy | E2E `splits staff and contractors into two tabs whose counters match the rows`; zrzuty `employees-staff-wide.png`, `employees-contractors-wide.png`, `employees-staff-390.png`, `employees-contractors-390.png` |
| Dodanie wykonawcy przyciskiem, zero `LeaveBalanceNew`, profil bez zakładek czasu i urlopów | E2E `adds a contractor from the tab: no leave balances and a profile without time or leave tabs`; integracyjny `should not create any leave balance when a contractor is created`; zrzuty `contractor-profile.png`, `contractor-profile-390.png` |
| Edycja danych i dezaktywacja z poziomu zakładki | E2E `edits a contractor and hides the card from the contractors tab like any other card`; integracyjny `should deactivate a contractor like any other card` |
| B2B → UoP przenosi kartę na zakładkę pracowników, do grafiku, sald i arkusza płac; zmiana odwrotna usuwa | E2E `moves a card between the tabs when the employment type changes`; integracyjne `should move a card to staff lists when B2B changes to UoP…`, `should remove a card from staff lists when UoP changes to B2B…` |
| Wykonawcy nie ma w ewidencji, grafiku (kopiowanie, szablony), nadgodzinach, saldach, kalendarzu, wnioskach, eksportach, raportach, PDF, strukturze, listach przełożonego; pracownik jest | integracyjna macierz `visibility matrix: place x kind of card` (12 tras JSON × ADMIN/MANAGER × 3 testy, 6 tras CSV/PDF × 2 role × 2 testy), `schedule writes refuse contractors`, `organisation structure counts`, `leave summary counts`; E2E `keeps a contractor out of every HR place…` |
| Pusty rodzaj umowy widoczny wszędzie | w macierzy test `should show a card with an empty employment type` dla każdej trasy; `should list a staff card and a card with an empty employment type` dla CSV/PDF; E2E (karta „Bezumowna" w grafiku, nadgodzinach, urlopach, zatwierdzeniach, saldach, przełożonych, strukturze) |
| Wykonawca wybieralny w montażach i Ustawienia → Użytkownicy; E2E montaży bez zmian | E2E `still offers the contractor in installations and in account management`; integracyjne `should offer contractors to the pickers…`, `should let ADMIN create an installer account linked to a contractor card`; specyfikacje `installations-*` uruchomione bez edycji |
| MANAGER widzi na obu zakładkach tylko swój zakres; EMPLOYEE i INSTALLER bez listy | E2E `limits a MANAGER to the cards of their division on both tabs`, `gives EMPLOYEE and INSTALLER no list, as before`; integracyjne `should show a MANAGER only the contractors/staff of their own division` |
| `CONTEXT.md` zawiera „Wykonawca zewnętrzny" | sekcja „Ludzie w HR" w `CONTEXT.md` |

Mutacja kontrolna: po zamianie `STAFF_WHERE` na filtr z innym literałem macierz integracyjna wpadała na czerwono (testy „should not show an external contractor"), po przywróceniu zielona.

## Salda urlopowe (D21) — co się dzieje w którą stronę

- **Tworzenie karty** (`POST /api/hr/employees`) nigdy nie tworzyło sald (istniejący test `employee-leave-initialization-route.test.ts`) — wykonawca nie dostaje ich więc z definicji; nic nie trzeba było dopisywać w ścieżce tworzenia. Test integracyjny to potwierdza także dla wykonawcy.
- **B2B → UoP:** karta nie dostaje salda automatycznie (tak samo jak nowy pracownik); ADMIN ustawia limit w panelu „Roczny limit", który po zmianie jest renderowany na profilu.
- **UoP → B2B:** istniejące salda i wnioski zostają w bazie, przestają być listowane; karta nie jest już brana do przeniesienia sald na nowy rok.
- **Dwa miejsca, w których sala powstawały i które zabezpieczyłem:** `POST /api/hr/employees/[id]/leave-entitlement` zwraca 409 dla wykonawcy; `executeLeaveCarryoverBatch` (`src/lib/hr/leave-carryover.ts`) pomija wykonawców (inaczej stare saldo 2025 wykonawcy utworzyłoby saldo 2027).

## Jak szukałem

`grep -rnE "employee\.(findMany|count|groupBy|findFirst|aggregate)"` po `src/` (52 trafienia), osobno relacje `employees:` / `_count` na stanowiskach, oddziałach, działach, osobno `\b(timeEntry|workSchedule|overtimeRequest|leaveRequestNew|leaveBalanceNew|leaveRequest|leaveBalance|workTimeRecord|contract|…)\.(findMany|count|groupBy|aggregate)` (listy innych modeli łączone z pracownikiem), `prisma.employee|db.employee|tx.employee` poza `src/app/api/hr` i `(dashboard)/hr`, oraz ręczny przegląd stron `hr/*` (czy lista pochodzi z zapytania, czy z trasy API). Listy innych modeli filtruję przez relację (`employee: STAFF_WHERE`), nie tylko przez listę pracowników.

## Tabela trafień i decyzji

Numery linii z wersji po zmianach.

| Plik:linia | Decyzja | Powód |
|---|---|---|
| `api/hr/employees/route.ts` GET (findMany + count) | **zakładki** | `kind=staff|contractors|all`, domyślnie `all`; przy `all` zapytanie nie jest zmieniane; nieznany `kind` → 400 |
| `(dashboard)/hr/employees/page.tsx` findMany + 3× count | **zakładki** | lista aktywnej zakładki + liczniki obu; wspólne filtry, filtr rodzaju umowy tylko na zakładce pracowników |
| `api/hr/employees/[id]/route.ts` count (managerId, timeEntry, leaveRequestNew, contract…) | bez zmian — to nie lista | liczniki blokujące twarde usunięcie jednej karty; wykonawca ma nadal blokować |
| `api/hr/employees/[id]/route.ts` GET/PATCH | bez zmian — jedna karta | |
| `api/hr/employees/[id]/leave-entitlement/route.ts` (upsert salda) | **wyklucz** (409) | tworzy salda; D21 |
| `lib/hr/leave-carryover.ts` leaveBalanceNew.findMany/create | **wyklucz** | przeniesienie sald na nowy rok tworzyło nowe wiersze dla wykonawców ze starymi saldami |
| `api/hr/leave-balances/route.ts` findMany (employee) + leaveBalanceNew.findMany | **wyklucz** | `employee: STAFF_WHERE` na saldach, `AND` ze scope'em managera |
| `api/hr/leave-balances/[id]/route.ts` | bez zmian — jedno saldo | korekta jednego wiersza |
| `api/hr/leave-balances/carryover/route.ts` | bez zmian (przez `leave-carryover.ts`) | |
| `api/hr/schedules/route.ts` GET findMany | **wyklucz** | `AND: [STAFF_WHERE]` |
| `api/hr/schedules/route.ts` POST/DELETE | bez zmian — zapis jednej komórki | UI nie oferuje wykonawców; nie lista |
| `api/hr/schedules/template/route.ts` findMany + count | **wyklucz** | lista `employeeIds`; ADMIN → 400, MANAGER → 403 |
| `api/hr/schedules/copy/route.ts` findMany + count, workSchedule.findMany | **wyklucz** | źródło i cele muszą być pracownikami (400 / 403) |
| `(dashboard)/hr/time-tracking/schedule/page.tsx` findMany | **wyklucz** | `AND: [STAFF_WHERE]` |
| `lib/hr/time-tracking/range-loader.ts` findMany | **wyklucz** | obsługuje `weekly` i `monthly`; wpisy i urlopy dociągane po id pracowników |
| `api/hr/time-tracking/bulk/handler.ts` findMany | **wyklucz** | walidacja listy `employeeIds`; wykonawca → 404 |
| `api/hr/time-tracking/bulk-approve/route.ts` findMany | bez zmian — kontrola uprawnień | działa na wpisach po id, sprawdza scope managera |
| `api/hr/time-tracking/{batch,monthly/fill}/handler.ts`, `create-entry.ts` | bez zmian — zapis dla jednej osoby | nie lista |
| `api/hr/time-tracking/{clock-in,clock-out,current,break/*}`, `(dashboard)/hr/time-tracking/{page,clock/page}.tsx` findFirst | bez zmian — własna karta | `findFirst` po `session.user.employeeId` |
| `api/hr/time-tracking/[id]/**`, `.../approve`, `.../reject` | bez zmian — jeden wpis | |
| `api/hr/overtime-requests/route.ts` findMany + lista id managera | **wyklucz** | `employee: STAFF_WHERE` na wnioskach |
| `api/hr/overtime-requests/[id]/**` | bez zmian — jeden wniosek | |
| `api/hr/leave/summary/route.ts` count + 2× leaveRequestNew | **wyklucz** | liczniki „obecni/nieobecni/planowane" |
| `api/hr/leave/calendar/route.ts` findMany | **wyklucz** | |
| `api/hr/leave-requests/route.ts` GET (+ lista managera) | **wyklucz** | `employee: STAFF_WHERE` na wnioskach |
| `api/hr/leave-requests/route.ts` POST, `[id]/**` (approve, reject) | bez zmian — jeden wniosek | |
| `api/hr/leave-requests/export/route.ts` | **wyklucz** | `employee` łączony z filtrem oddziału przez `AND` |
| `api/hr/leave-requests/pending/route.ts` | **wyklucz** (brak w tabeli planu) | lista oczekujących wniosków |
| `(dashboard)/hr/leave/page.tsx` | **wyklucz** | kalendarz i podsumowanie dnia liczone z tej listy |
| `(dashboard)/hr/leave/approval/page.tsx` (wnioski + lista pracowników) | **wyklucz** | filtr wniosków przez relację |
| `(dashboard)/hr/leave/balances/page.tsx` (fetch `/api/hr/employees`) | **wyklucz** | `kind=staff` |
| `api/hr/reports/{attendance,overtime,plan-vs-actual}/route.ts` | **wyklucz** | |
| `api/hr/reports/projects/route.ts` | **wyklucz** | lista id managera + `employee: STAFF_WHERE` na wpisach (ADMIN czyta wpisy wprost) |
| `api/hr/reports/export/route.ts` (attendance, overtime, projects, plan-vs-actual) | **wyklucz** | |
| `api/hr/reports/monthly-pdf/route.ts` | **wyklucz** | tabela zbiorcza i PDF jednej osoby; wykonawca po id → 404 |
| `api/hr/reports/timecard/route.ts` i `reports/export?type=timecard` | bez zmian — jedna karta po id | nie lista; picker dostaje `kind=staff` |
| `components/hr/time-tracking/reports-dashboard.tsx` (2 miejsca) | **wyklucz** | `EmployeeSelect kind="staff"`, `fetch ?kind=staff` |
| `components/hr/leave/leave-request-form.tsx` (2 pickery) | **wyklucz** | `kind="staff"` |
| `components/settings/users-management.tsx` | **musi widzieć wykonawcę** | `kind="all"` |
| `api/hr/divisions|positions|departments/route.ts` (`_count`, `employees`) | **wyklucz** | liczniki i lista osób w strukturze przez `employees: { where: STAFF_WHERE }` |
| `api/hr/divisions|positions|departments/[id]/route.ts` count przed usunięciem | bez zmian — wykonawca ma blokować | test `should still block deleting a division that only a contractor belongs to` |
| `(dashboard)/hr/employees/{new,[id]/edit}/page.tsx` (przełożeni) | **wyklucz** | |
| `(dashboard)/hr/employees/[id]/page.tsx` | **profil wykonawcy** | tylko dane podstawowe i etykieta |
| `(dashboard)/installations/{new,[id]}/page.tsx`, `lib/installations/{order,delegation,scope-assignment}-service.ts`, `acceptance-protocol.ts` | bez zmian — wykonawca musi być widoczny | |
| `api/users/route.ts`, `api/users/[id]/route.ts`, `(dashboard)/settings/users/page.tsx`, `lib/auth.ts` | bez zmian — konta | |
| `api/admin/content-visibility/route.ts` | bez zmian | tylko słowo „employee" w komunikacie |
| `lib/payroll/service.ts` (arkusz, tworzenie rozliczenia), `contracts.ts`, `finance/employer-costs.ts`, `payroll/cost-settings.ts` | już załatwione (etap 1) | |
| **`lib/payroll/service.ts` `listSettlementsForMonth` ← `GET /api/hr/payroll/settlements`** | **bez zmian — do decyzji** | zwraca także B2B; żaden ekran go nie używa (arkusz używa `getPayrollSheet`), obszar etapu 1 z regułą „istniejące rozliczenie wykonawcy można dokończyć" — nie zmieniałem bez decyzji |

## Odstępstwa i decyzje spoza planu

1. `leave-entitlement` (409) i `leave-carryover` — poza tabelą planu, ale tworzą salda (D21).
2. `leave-requests/pending` — brak w tabeli planu.
3. Szablon i kopiowanie grafiku walidują także ADMIN-a (400), bo to listy id przychodzące z klienta.
4. `GET /api/hr/employees?kind=` nieznana wartość → 400; pusty `kind=` = `all`.
5. Licznik zakładki liczy wiersze przy bieżących wspólnych filtrach (oddział, dział, status, szukaj, ukryci), więc licznik otwartej zakładki = liczba wyników.
6. `EmployeeSelect` ma wymagany prop `kind`; `EmployeeTabs` dostał role `tablist`/`tab` (potrzebne do testu i dostępności).
7. Po dodaniu wykonawcy formularz wraca na zakładkę „Wykonawcy", nie na profil.
8. Zmienione istniejące testy (tylko oczekiwania na `where` i schemat tabel testowych): `leave-balances-page`, `leave-carryover-route`, `operational-access`, `reports-access`, `time-tracking-range-loader`, `leave-balance-correction-route`; ręcznie budowane tabele `Employee` w `leave-carryover-atomicity` i `time-tracking-batch-transaction` dostały kolumnę `employmentType`.
9. Poprawiony `&quot;` w `reports-dashboard.tsx` (błąd eslint sprzed zmiany w pliku, który dotykałem).
10. Nie zmieniałem: tekstów „Ukryj pracownika"/„Dane pracownika" w oknach akcji (dla wykonawcy mówią „pracownika"); `time-tracking/reports` (timecard po id) i pojedynczy `POST /api/hr/schedules`; lista przełożonych na edycji nie zawiera obecnego przełożonego-wykonawcy (jeśli taki istnieje, select pokaże pusty wybór).

## Playwright

Jeden przebieg: `npx playwright test e2e/hr-contractors.spec.ts e2e/hr-time-tracking.spec.ts` + `installations-{acceptance-protocol,calendar-ui,calendar,card,catalog,client-form,governance,media,order}.spec.ts` — 21 przeszło, 2 nie przeszły (exit 1).

- `installations-order.spec.ts` — w przebiegu zbiorczym `beforeAll` padł na `Unique constraint failed (id)` przy `costCenter.create({id:'JAG'})` (kolizja danych w wspólnej bazie E2E). Uruchomiony osobno: przechodzi (1/1). Specyfikacji nie edytowałem.
- `installations-catalog.spec.ts` — pada na `getByLabel('Nowa kategoria')` (timeout 90 s), także uruchomiony osobno. Na czystym checkoucie HEAD (worktree bez moich zmian, sklonowane `node_modules`) pada identycznie, więc to błąd sprzed etapu 4. Nie zmieniałem tego pliku ani kodu montaży. Do zgłoszenia osobno.

`hr-contractors.spec.ts` wymagał po drodze trzech poprawek samego testu (nie kodu produktu): przeładowanie strony edycji przed zmianą rodzaju umowy, `toBeAttached` dla `<option>` w filtrze zatwierdzeń, wybór „UoP" w kroku 2 kreatora. `git status docs/evidence` po przebiegach: tylko nowe pliki raportu i zrzutów, żaden plik śledzony nie zmieniony.

## Audyt 6 punktów (atrapy)

1. Przyciski robią coś realnego: „Dodaj wykonawcę" tworzy kartę przez prawdziwe `POST /api/hr/employees` (E2E 3, stan bazy sprawdzony); „Zapisz zmiany", „Ukryj" — E2E 4, 5.
2. Dane z bazy: liczniki i listy z zapytań Prisma; E2E zasiewa SQLite i sprawdza przeniesienie B2B/UoP.
3. Stany brzegowe: pusty rodzaj umowy, nieznany `kind` (400), wykonawca w grafiku (400/403/404), EMPLOYEE/INSTALLER bez listy.
4. Role: macierz ADMIN/MANAGER w teście integracyjnym oraz E2E 8 i 9.
5. Trwałość: zmiany odczytywane po przeładowaniu przez prawdziwe trasy; pełnego restartu serwera nie robiłem (częściowo).
6. Nic nie jest tylko wyglądem: zakładki filtrują po stronie serwera (`kind`), liczniki z `count`.

## Uruchomione a tylko przeczytane

- Uruchomione: cała bramka, mutacja kontrolna macierzy, zrzuty ekranu obejrzane.
- Tylko przeczytane: `reports/timecard` i `type=timecard` (po id, niefiltrowane), `GET /api/hr/payroll/settlements`, teksty okien akcji.
- Niedokończone: dwa testy montaży powyżej; 4 znane testy Poppler.

## Przegląd przed scaleniem i poprawki z przeglądu

Niezależny przegląd orkiestratora (27.11.2026) na tej samej gałęzi, po raporcie agenta.

### Co sprawdziłem sam

- Powtórzyłem wyszukiwanie: wszystkie `employee.(findMany|count|groupBy)` w `src/` poza plikami zmienionymi w tym etapie to dokładnie pozycje „bez zmian” z tabeli (Montaże, płace z etapu 1, liczniki przed usunięciem jednostki, kontrola uprawnień). Osobno przeszukałem listy innych modeli (`timeEntry`, `leaveRequest`, `workSchedule`, `overtimeRequest`, `leaveBalanceNew`) w plikach bez `STAFF_WHERE` — zostały tylko odczyty jednej karty po id, zapisy pojedynczych wierszy i własne wpisy zalogowanej osoby. Trasy `GET` w `src/app/api/hr/**` bez filtra to słowniki (`holidays`, `leave-types`, `billing-periods`), pojedyncze rekordy po id oraz `weekly`/`monthly`, które korzystają z `range-loader`.
- Żaden późniejszy filtr nie nadpisuje `employee: STAFF_WHERE` w trasach wniosków urlopowych, nadgodzin, sald i eksportu.
- Obejrzałem zrzuty obu zakładek (szeroko i 390 px) oraz profilu wykonawcy.

### Poprawki naniesione po przeglądzie

1. **Przełożony już przypisany do karty zostaje w formularzu edycji.** Lista przełożonych pokazuje tylko aktywnych pracowników, więc przełożony-wykonawca (a wcześniej także przełożony nieaktywny) znikał z listy, a zapis dowolnej zmiany po cichu czyścił pole. Strona edycji dokłada bieżącego przełożonego do opcji. Test E2E: `keeps a supervisor who is a contractor on the card when the edit form is saved`.
2. **Odmiana liczebników** w nagłówku listy: „0 wykonawców”, „22 wykonawcy” (wcześniej „0 wykonawcy”, „22 wykonawców”; to samo dla pracowników). `pluralPl` przeniesione do `src/lib/plural-pl.ts`, moduł płac eksportuje je dalej bez zmian.
3. Zamykający cudzysłów w podpowiedzi raportu PDF: `”` zamiast encji `&quot;`.

### Bramka po poprawkach (przebieg orkiestratora)

| # | Polecenie | Wynik |
|---|---|---|
| 1 | `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` | 4315 przeszło, 4 nie przeszły — te same 4 testy Popplera w `document-processor.test.ts` |
| 2 | `npm run typecheck:app` | exit 0 |
| 3 | `npx eslint <52 pliki .ts/.tsx>` | exit 0, 0 błędów, 3 ostrzeżenia sprzed zmiany |
| 4 | `npm run build` | exit 0 |
| 5a | `npx playwright test e2e/hr-contractors.spec.ts e2e/hr-time-tracking.spec.ts` | 13 przeszło (10 + 3) |
| 5b | każdy `e2e/installations-*.spec.ts` w osobnym przebiegu | 8 z 9 plików zielonych (10 testów); `installations-catalog` czerwony — patrz niżej |
| 5c | wszystkie `e2e/hr-payroll*.spec.ts` | 24 przeszły |

### Dwa testy montaży — żaden nie jest regresją etapu 4

- `installations-catalog.spec.ts` szuka pola o etykiecie „Nowa kategoria”. Tej etykiety nie ma w `src/` (jedyne trafienie w repozytorium to sam test), więc test jest nieaktualny względem interfejsu katalogu i pada tak samo na czystym `main`. CI nie uruchamia testów Playwright, dlatego nikt tego wcześniej nie zauważył. Zgłoszone osobno (#52), poza zakresem etapu 4.
- `installations-order.spec.ts` tworzy centrum kosztów `JAG` przez `create`, czyli zakłada pustą bazę; w jednym przebiegu z innymi plikami koliduje z danymi poprzedniego testu. Uruchomiony osobno przechodzi — dlatego w bramce każdy plik montaży biegnie osobno.

### Świadomie zostawione

- Okna akcji („Ukryj pracownika”, „Usuń pracownika”) i etykieta „Data zatrudnienia” mówią o pracowniku także na karcie wykonawcy — sama kosmetyka słów.
- `GET /api/hr/payroll/settlements` (bez wywołań z interfejsu) i reguła kosztu B2B w `src/lib/payroll/summary.ts` należą do etapu 1 i nie są listami osób.
- Pełny restart serwera nie był wykonywany w tym etapie; trwałość po restarcie sprawdza scenariusz finałowy po etapie 5.

