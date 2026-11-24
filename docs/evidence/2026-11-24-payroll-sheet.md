# Wynagrodzenia — etap 1 „Arkusz miesiąca” (#42): wyniki i dowód

**Data:** 2026-11-24 · **Gałąź:** `payroll-sheet-42` (od `main` b85bdd0, niezacommitowane) · **Plan:** `docs/plans/2026-11-24-payroll-ux-simplification.md`, sekcja 8
**Dane:** wyłącznie syntetyczne (osoby „Testowa Arkuszowa”, „Testowy Bilansowy”, „Testowa Cyfrowa”, „Testowa Dopisana”, „Testowy Wykonawca”; kwoty wymyślone).

## Co powstało

| Obszar | Pliki |
|---|---|
| Reguła wykonawcy (D12) | `src/lib/hr/contractors.ts` — `EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE`, `isExternalContractor`, `STAFF_WHERE` (z `employmentType: null`), `CONTRACTOR_WHERE` |
| Podpowiedź i znaczniki | `src/lib/payroll/carryover.ts` (czysty moduł; `PAY_AFFECTING_LEAVE_CODES = SL, ML, PL, FIL`), `src/lib/payroll/month-names.ts`, `previousPayrollPeriod` w `period.ts` |
| Logika | `src/lib/payroll/service.ts`: kroki `syncCalendarStep`, `resolveOvertimeStep`, `add/update/deleteAdjustmentStep`, `confirmPayrollOfficeStep`, `approveStep`, `reopenStep`, `createSettlementInTx` wydzielone z `applySettlementAction` i `createSettlement` (te same nazwy akcji audytu); nowe `settleEmployeeMonth`, `getPayrollSheet`, `submitPayrollSheet`, `setPayrollMonthReference`, `loadPayAffectingAbsences` |
| Walidacja | `PayrollSheetRowSchema`, `PayrollSheetSubmitSchema`, `PayrollMonthUpdateSchema` (`.strict()`) w `src/lib/validations/payroll.ts` |
| API (ADMIN, `PAYROLL_NO_STORE`) | `GET|POST /api/hr/payroll/sheet`, `PUT /api/hr/payroll/months/[month]` |
| Schemat | model `PayrollMonth`, migracja `prisma/migrations/20261124120000_payroll_month/migration.sql` |
| UI | `payroll-month-view.tsx` (arkusz), `payroll.module.css` (sekcja „Month sheet”), `base-salary-dialog.tsx` (`defaultEffectiveFrom`) |
| Testy | `__tests__/unit/hr/payroll-carryover.test.ts` (52), `__tests__/integration/hr/payroll-sheet-flow.test.ts` (42), `e2e/hr-payroll-sheet.spec.ts` (9), dostosowany `e2e/hr-payroll.spec.ts` |

## DOWÓD

### Bramka (§7), uruchomiona 24.11.2026

| Komenda | Wynik |
|---|---|
| `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` (komenda CI) | **exit 1**: 308 plików PASS, 1 FAIL, 2 pominięte; 4010 testów PASS, **4 FAIL**, 2 pominięte. Wszystkie 4 w `__tests__/unit/invoice-import/document-processor.test.ts` („uses real pdfinfo and pdftoppm …”, „accepts real ten-page Poppler output …”, „uses real pdfinfo to reject encrypted …”, „rejects missing, duplicate … rendered page outputs”) — `InvoiceDocumentProcessorError: INVALID_CONFIG`, bo na tej maszynie **nie ma Popplera** (`which pdfinfo pdftoppm` → not found). Plik i moduł nie są ruszane przez ten etap; błąd powtarza się przy uruchomieniu samego pliku. Nowe testy etapu: 52/52 i 42/42 PASS. |
| `npm run typecheck:app` | exit 0 |
| `npx eslint <14 zmienionych plików .ts/.tsx>` | exit 0, brak uwag |
| `npm run build` | exit 0; trasy `ƒ /api/hr/payroll/sheet`, `ƒ /api/hr/payroll/months/[month]` w wyniku |
| `npx playwright test e2e/hr-payroll-sheet.spec.ts e2e/hr-payroll.spec.ts` | exit 0, **12 passed** (9 + 3) |
| `prisma migrate diff --from-migrations … --to-schema-datamodel …` (baza tymczasowa) | brak różnic dotyczących `Payroll*` (różnice w innych tabelach istniały wcześniej) |

Iteracje naprawcze: 1 nieudany przebieg E2E. Przyczyny: (a) pieczątka statusu przykrywała przycisk „Zapisz korektę” — poprawiony układ; (b) `e2e/hr-payroll.spec.ts` padał na `main` niezależnie od etapu — od #21 pole kosztu na stronie szczegółów pojawia się dopiero po „wpisz ręcznie”; spec dostał zaznaczenie tego pola przed wpisaniem tej samej kwoty (asercje bez zmian). Kolejne przebiegi (z dodanymi testami audytu i anonimowego dostępu): zielone.

### Punkty Definition of Done

Rekordy „DB/API” poniżej pochodzą ze skryptu na bazie tymczasowej zbudowanej `prisma migrate deploy` i wywołującego te same funkcje co trasy (osoby `ev-*`, dane syntetyczne). Te same warunki sprawdzają testy podane w kolumnie „Test”.

| # | Punkt DoD | Dowód | Test |
|---|---|---|---|
| 1 | Podpowiedź z poprzedniego miesiąca z podpisem źródła; w bazie brak rozliczeń za oglądany miesiąc | Zrzut `01-october-suggested.png` (pola z kwotami września, kursywa, „z września”). DB: `ev-a.suggestion = {finalGrossGrosze: 500000, finalNetGrosze: 360000, employerCostGrosze: 602400, employerCostSource: "CALCULATED", sourceMonth: "2026-09"}`; `count(PayrollSettlement 2026-10) = 0` | integ. „should suggest last month amounts without writing any October settlement”; E2E „suggests September amounts in October…” |
| 2 | „Zatwierdź zaznaczone (3)” → APPROVED v1, trzy zdarzenia, 3 / 3, po odświeżeniu i restarcie bez zmian | Zrzut `03-october-approved.png`, `06-after-restart.png`. API: `[{ev-a, APPROVED, 1}, {ev-b, APPROVED, 1}, {ev-c, APPROVED, 1}]`; audyt ev-a: `settlement.create → payrollOffice.confirm → settlement.approve` | integ. „should approve three ready rows…”, „should keep the same state after an application restart”; E2E (DB: 3 × `APPROVED`, 3 × trzy zdarzenia), „keeps the approved month after a real server restart” (prawdziwy restart procesu) |
| 3 | Zmiana brutto → koszt w wierszu od razu; wersja z kwotą i kosztem serwera | Zrzut `02-october-edited.png` (Bilansowy 5450,50 → 6566,76 zł). DB: `ev-b v1: finalGrossGrosze 545050, employerCostGrosze 656676, employerCostSource CALCULATED` (= `calculateEmployerCostGrosze(545050, UOP)`) | E2E (koszt przed/po zmianie, rekord wersji); integ. „…three ready rows…” |
| 4 | „Zapisz korektę” → v2, v1 zastąpiona, jeden rekord w `getEffectivePayrollCosts`, powód w historii | Zrzut `05-correction-pending.png`. DB: `ev-b: v1 supersededAt=2026-11-24T17:47…, v2 supersededAt=null`; `getEffectivePayrollCosts → [{payroll:ev-b:2026-10, v2}]`; `settlement.reopen.reason = "Korekta kwot na liście miesiąca"` | integ. „should save a correction … exactly one effective cost”; E2E „corrects an approved amount…” |
| 5 | Te same kwoty → `UNCHANGED`, bez nowej wersji | API: `{ev-b, UNCHANGED, versionNumber: 2}`; liczba wersji przed/po `[7, 7]`. W UI przycisk „Zapisz korektę” pojawia się tylko przy różnicy (E2E: brak przycisku przed edycją i po zapisie) | integ. „should answer UNCHANGED … no version or event”; E2E (POST przez API → `UNCHANGED`, 2 wersje) |
| 6 | Brak angażu / nierozstrzygnięte nadgodziny: nie da się zaznaczyć, powód w wierszu; API `BLOCKED`, brak rekordu | Zrzut `08-blocked-row.png`. API: `{ev-d, BLOCKED, blockers:[BASE_MISSING]}`; `count(PayrollSettlement ev-d) = 0` | integ. „should return BLOCKED for %s and leave no settlement row behind” (BASE_MISSING, OVERTIME_UNRESOLVED, COST_SPLIT_MISSING; także 0 zdarzeń audytu); E2E „shows a person without a salary as blocked…” |
| 7 | Wiersz ze znacznikiem odznaczony, z opisem; po zaznaczeniu daje się zatwierdzić | Zrzut `00-september-typed.png` (znacznik „brak zatwierdzonego sierpnia”). Integracja: każdy z 6 znaczników osobno ma `autoEligible=false` i polski opis, potem `APPROVED v1` | integ. „should flag %s with %s and not preselect it” (6 przypadków), „should approve the flagged row %s once it is selected by hand” (5); unit „carryover flags (each on its own)” |
| 8 | B2B bez rozliczenia niewidoczny i nieliczony; B2B z rozliczeniem widoczny; brak umowy widoczny z ostrzeżeniem | DB/API: wiersze 2026-10 = `ev-a, ev-b, ev-d, ev-n, ev-c` (brak `ev-x` B2B); `ev-n.flags = ["…", "brak rodzaju umowy — uzupełnij w karcie"]` | integ. „should leave out an external contractor…”, „should show a contractor who already has a settlement…”, „should keep a person without an employment type…”; E2E (brak wiersza wykonawcy przed i po restarcie, licznik `3 / liczba wierszy`) |
| 9 | Numer listy płac: po odświeżeniu widoczny; wersje późniejsze go mają; zmiana nie tworzy wersji | Zrzut `06-after-restart.png` (pole „LP 10/2026 (test)” po restarcie). API `PUT` → `{month: "2026-10", listReference: "LP 10/2026 (test)"}`; wersje v1 `payrollOfficeReference = "LP 10/2026 (test)"`; po zmianie na „… poprawiona (test)” wersja ev-a bez zmian | integ. „should save the month payroll list number…”, „should not create a version when the list number changes…”, „should clear the list number…” |
| 10 | Dwie karty → `CONFLICT`/`UNCHANGED`, jedna obowiązująca wersja | Zrzut `04-second-tab-conflict.png`. API: `{ev-c, CONFLICT, "Rozliczenie tej osoby zostało w międzyczasie utworzone lub zmienione. Odśwież arkusz."}`; obowiązujące wersje ev-c = 1 | E2E (dwa konteksty przeglądarki); integ. „…second tab…”, „…stale revision”, „…two tabs approve the same new row at the same time” (równoległe POST: `APPROVED` + `CONFLICT`, 1 rozliczenie, 1 wersja) |
| 11 | MANAGER i EMPLOYEE 403; bez sesji 401; `/hr/payroll` przekierowuje | Handlery: MANAGER/EMPLOYEE → `[403, 403, 403]`, bez sesji → `[401, 401, 401]`. Przez HTTP (E2E): EMPLOYEE → `[403, 403, 403]` i przekierowanie ze strony; **bez sesji → `307 → /login` dla trzech tras i strony** (patrz odstępstwo 1) | integ. „should deny %s every sheet route”, „should return 401 without a session”; E2E „denies the sheet to an employee and to a visitor without a session” |
| 12 | Styczeń z grudnia poprzedniego roku | DB/API: grudzień 2025 `APPROVED v1`; styczeń 2026 `suggestion.sourceMonth = "2025-12"`, `finalGrossGrosze 470000` | integ. „should suggest January amounts from December…”; unit „should take January from December…”, „should chain suggestions through twelve consecutive months…” |

Dodatkowe zrzuty: `07-unsaved-changes.png` (wstrzymana zmiana miesiąca, komunikat w treści strony), `09-mobile-390.png` (karta, brak poziomego przewijania).

### Audyt atrap (§7)

| # | Punkt | Wynik |
|---|---|---|
| 1 | Kliknięty każdy widoczny element | Klawiatura (Tab brutto → netto → następny wiersz, Enter), pola brutto/netto/koszt, przycisk „wpisz ręcznie” (pole z kwotą) i „licz ze stawek” (powrót do wyliczenia), zaznaczanie/odznaczanie (licznik 3 → 2 → 3), „Zatwierdź zaznaczone (N)” na pasku i w komunikacie, „Zapisz korektę”, „Zostań”, „Porzuć zmiany”, „Poprzedni/Następny miesiąc”, numer listy płac (Enter), menu wiersza: „Angaż…”, „Szczegóły rozliczenia”, „Otwórz rozliczenie szczegółowe (utworzy szkic)”; przyciski blokad „Angaż…” i „Otwórz (utworzy szkic)”. Każdy sprawdzony w E2E z efektem w UI lub w bazie (test „every remaining control…”, oraz `hr-payroll.spec.ts` dla pozycji menu tworzącej szkic). Nieklikane: pole `type=month` (bez zmian względem `main`). |
| 2 | Zapis da się zmienić przez UI | Korekta kwoty (v1 → v2), zmiana numeru listy płac (integracja + pole w nagłówku), powrót z kwoty wpisanej ręcznie do wyliczenia („licz ze stawek”), dodanie angażu z wiersza — PASS |
| 3 | Restart aplikacji | E2E restartuje proces serwera (`restart-request`): pieczątki v2/v1, kwoty, numer listy płac bez zmian — PASS |
| 4 | Czysta baza, przepływ bez SQL | E2E na bazie z `global-setup` (migracje): wrzesień wpisany ręcznie w UI → październik z podpowiedzią → zatwierdzenie → korekta; bez SQL (Prisma w teście tylko do zasiania kart i angażu oraz do odczytu dowodów) — PASS |
| 5 | Druga rola | EMPLOYEE: 403 z trzech tras i przekierowanie ze strony (E2E); MANAGER: 403 (integracja); bez sesji: przekierowanie do `/login` (E2E) — PASS. INSTALLER nie był testowany osobno w tym etapie (reguła `proxy.ts` dopuszcza do `/api/hr/payroll` wyłącznie ADMIN). |
| 6 | Zmiana w bazie zmienia ekran | Wpis czasu pracy z nadgodzinami dodany w bazie → po odświeżeniu wiersz zablokowany z opisem; dodany angaż → blokada znika; koszt pracodawcy liczony z `rates` z bazy — PASS |

## Odstępstwa i decyzje poza planem

1. **Bez sesji: 307 do `/login`, nie 401 (DoD 11).** Handlery tras zwracają 401 (test integracyjny), ale `src/proxy.ts` (`withAuth`) przechwytuje każde żądanie `/api/hr/payroll/*` bez JWT i przekierowuje do logowania, zanim dotrze do trasy. Tak samo działają istniejące trasy płac. Nie zmieniałem globalnej autoryzacji — dane nie wychodzą, ale kod HTTP różni się od zapisu w DoD.
2. **`PREVIOUS_HAD_ADJUSTMENTS` obejmuje też płatne nadgodziny** z miesiąca źródłowego (`payoutOvertimeMinutes > 0`), nie tylko premię i korektę — brutto takiego miesiąca zawiera jednorazową kwotę. Opis znacznika wymienia, co było („premię i korektę”, „płatne nadgodziny”).
3. **Zaznaczenie domyślne** = `autoEligible` **i brak rozliczenia** w miesiącu. Szkic utworzony na stronie szczegółów (może mieć premię) nie jest zaznaczany sam. Wiersz zatwierdzony daje się zaznaczyć dopiero po zmianie kwoty (wtedy trafia też do zbiorczego zatwierdzenia jako korekta).
4. **Blokady na arkuszu** to blokady zatwierdzenia liczone z bieżącego kalendarza, bez `CALENDAR_OUT_OF_SYNC`, `PAYROLL_OFFICE_NOT_CONFIRMED` i `EMPLOYER_COST_STALE` — ścieżka arkusza sama pobiera kalendarz i potwierdza kwoty w tej samej transakcji.
5. **Tab:** z ostatniego pola wiersza (netto, albo koszt, gdy jest wpisywany ręcznie) przechodzi do brutto następnego wiersza. Shift+Tab działa naturalnie (dociera do menu i pola wyboru).
6. **Kolumna „Δ brutto”** porównuje brutto z pola z brutto obowiązującej wersji poprzedniego miesiąca (wskaźnik w nagłówku porównuje zatwierdzony koszt pracodawcy).
7. **Pieczątki dla wierszy bez rozliczenia:** „gotowe”, „do sprawdzenia”, „do wpisania”, „zablokowane”. Przycisk blokady bez rozliczenia ma etykietę „Otwórz (utworzy szkic)” zamiast „Otwórz”, bo tworzy rekord.
8. **`PayrollMonth` bez historii zmian:** `PayrollAuditEvent` wymaga `employeeId`, więc zmiana numeru listy płac zapisuje tylko `updatedById`/`updatedAt`.
9. **Wiersz bez rozliczenia z błędnymi polami** dostaje komunikat lokalnie (bez wysyłki); ostateczną walidację robi serwer (`INVALID` per wiersz, także przy błędzie Zod jednego wiersza w żądaniu).
10. **`e2e/hr-payroll.spec.ts`:** poza zmianą selektorów (menu wiersza zamiast przycisków „Podstawa”/„Przygotuj rozliczenie”, pole kosztu w wierszu) dodane zaznaczenie „wpisz ręcznie” na stronie szczegółów — wymagane od #21, spec padał na `main` (wniosek z historii git i kodu; przebiegu na czystym `main` nie wykonywałem).
11. `e2e/hr-payroll.spec.ts` nadpisuje przy każdym przebiegu zrzuty w `docs/evidence/payroll-2026-09-22/`; przywróciłem je z gita, żeby nie mieszać dowodów etapów.

## Przegląd przed scaleniem i poprawki z przeglądu

Niezależna lektura zmian i powtórzenie całej bramki, 24.11.2026. Poprawki naniesione po przeglądzie:

| # | Co | Dlaczego | Dowód |
|---|---|---|---|
| 1 | Dwa nowe znaczniki: `PREVIOUS_MONTH_PARTIAL` („poprzedni miesiąc był niepełny…") i `PREVIOUS_HAD_ABSENCE` („poprzedni miesiąc zawierał nieobecność zmieniającą wypłatę…") | Kwota z miesiąca, którego osoba nie przepracowała w całości albo w którym była na chorobowym, jest nietypowa. Bez znacznika wiersz byłby „gotowy", a automat z etapu 2 zatwierdziłby ją sam. | unit: „should flag PREVIOUS_MONTH_PARTIAL…", „should flag PREVIOUS_HAD_ABSENCE…", „should not add source-month flags when there is no source version to copy"; integracja: „payroll month sheet — November from an untypical October" (3 testy) |
| 2 | Serwer odmawia utworzenia rozliczenia z arkusza dla wykonawcy B2B (`INVALID`, bez rekordu) | Ukrycie wykonawcy na liście było tylko filtrem odczytu; reguła D12/D13 ma obowiązywać także przy zapisie. Rozliczenie, które już istnieje, nadal da się dokończyć. | integracja: „should refuse to create a settlement for an external contractor and leave no row behind" |
| 3 | Dolny pasek akcji ma odstęp z prawej | Pływający przycisk asystenta (48 px, prawy dolny róg) zasłaniał „Zatwierdź zaznaczone". | `08-blocked-row.png` — przycisk w całości widoczny |
| 4 | Przycisk kosztu pracodawcy: „wpisz ręcznie" / „licz ze stawek" zamiast przełącznika „ręcznie" | Etykieta „ręcznie" pod wyliczoną kwotą czytała się jak opis stanu, nie jak akcja. | E2E „every remaining control…" (obie etykiety klikane) |
| 5 | Przykładowa kwota w komunikacie i w teście zamieniona na neutralną | Zasada: bez kwot z produkcji, także jako przykładów. | — |

Bramka po poprawkach:

| Komenda | Wynik |
|---|---|
| `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` | exit 1: 4019 PASS, **4 FAIL** — te same cztery testy Popplera w `document-processor.test.ts` (narzędzia nie ma na tej maszynie; GitHub Actions instaluje `poppler-utils`), 2 pominięte |
| `npm run typecheck:app` | exit 0 |
| `npx eslint <zmienione pliki .ts/.tsx>` | exit 0 |
| `npm run build` | exit 0 |
| `npx playwright test e2e/hr-payroll-sheet.spec.ts e2e/hr-payroll.spec.ts` | exit 0, 12 passed |

Rozstrzygający wynik testów jednostkowych to przebieg GitHub Actions na PR (tam Poppler jest zainstalowany).
