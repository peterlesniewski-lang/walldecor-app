# Wynagrodzenia: lista jak arkusz, automat 1. dnia, stawka godzinowa i wykonawcy poza HR

**Data:** 2026-11-24 · **Status:** plan do akceptacji właściciela; zgłoszenia GitHub powstają po akceptacji
**Wykonanie:** etapy 1–3 Opus, etapy 4–5 Sonnet z przeglądem Opus · **Każdy etap:** osobne zgłoszenie, osobna gałąź od `main`, osobny PR, osobne wdrożenie

Ten dokument jest kompletnym briefem dla agenta, który nie zna wcześniejszej rozmowy. Sekcje 1–7 obowiązują w każdym etapie. Agent realizuje **tylko jeden etap naraz** i nie zaczyna następnego.

---

## 1. Po co to robimy

Moduł `/hr/payroll` (tylko ADMIN) służy właścicielowi do wpisania co miesiąc brutto i netto każdej osoby z listy płac. Z tych kwot powstaje koszt pracodawcy, który trafia do wyniku firmy i break-even, oraz pasek wynagrodzenia widoczny dla pracownika.

Obserwacje z produkcji (stan na 24.11.2026, bez danych osobowych):

| Co widać | Skutek |
|---|---|
| Rozliczenie jednej osoby to: „Przygotuj rozliczenie" → osobna strona → brutto, netto → „Potwierdź dane kadrowej" → „Zatwierdź" → powrót. W listopadzie wszystkie rozliczenia wpisano w 8 minut, klikając kroki jeden po drugim. | Pięć kroków i dwie nawigacje na osobę, bez żadnej wartości dodanej. |
| Koszt pracodawcy każdej osoby w listopadzie był identyczny z październikiem. | Cały miesiąc był przepisywaniem tych samych kwot. Nowy miesiąc startuje pusty. |
| Na liście płac od października wisi wykonawca B2B (konto potrzebne do modułu Montaże) ze statusem „brak rozliczenia". | Licznik „zatwierdzone X / Y" nigdy nie dojdzie do pełna, a kolejni wykonawcy zaśmiecą listę. Wynik firmy i tak pomija B2B. |
| Jedna z korekt (wersja v2, powód „błędne dane") nie zmieniła żadnej kwoty — zniknął tylko numer listy płac. | Pole pomocnicze wpisywane przy każdej osobie kosztuje pełny cykl korekty. |
| Kolumna „Podstawa" pokazuje angaż, a nie kwotę, którą właściciel faktycznie wpisuje (brutto z listy płac jest inne niż angaż). | Główna kolumna listy nie odpowiada na pytanie „ile wpisałem". |
| Osoba na stawce godzinowej ma 0 h w kalendarzu; kwotę wpisuje się ręcznie. Moduł nie liczy „godziny × stawka". | Brak powiązania godzin z wypłatą. |

Cel: typowy miesiąc ma nie wymagać żadnego wpisywania; wyjątki poprawia się w jednym wierszu jednym kliknięciem; wykonawcy nie pojawiają się w HR poza własną zakładką.

---

## 2. Decyzje właściciela (zamknięte — nie zmieniać bez pytania)

| # | Decyzja |
|---|---|
| D1 | **Automat** zatwierdza rozliczenia 1. dnia miesiąca, z góry za ten miesiąc, kopiując kwoty z miesiąca bezpośrednio poprzedniego. Dotyczy wyłącznie osób ze stałą pensją miesięczną. |
| D2 | Wynagrodzenia wypłacane są do ostatniego dnia roboczego miesiąca, którego dotyczą. |
| D3 | Kwoty wpisuje się **na liście miesiąca**, w wierszu osoby. Strona szczegółów służy tylko wyjątkom (premie, korekty, nadgodziny, podział JAG/PUL). |
| D4 | Na liście jedno kliknięcie wykonuje „potwierdzenie danych kadrowej" i „zatwierdzenie" naraz. W historii zapisują się oba zdarzenia. |
| D5 | Korekta zatwierdzonej kwoty to zmiana wartości w wierszu i jedno kliknięcie; powód korekty wpisuje się sam. Powstaje nowa wersja. |
| D6 | **Numer listy płac** jest cechą miesiąca (jedno pole na miesiąc, edytowalne w każdej chwili), nie wersji rozliczenia. |
| D7 | Pasek wynagrodzenia jest widoczny dla pracownika od razu po zatwierdzeniu, także automatycznym. |
| D8 | Automat **nie** zatwierdza sam (wiersz „wymaga uwagi" z podpowiedzianą kwotą), gdy: (1) brak zatwierdzonego miesiąca poprzedniego, (2) osoba zaczyna lub kończy pracę w trakcie miesiąca, (3) angaż zmienił się od miesiąca źródłowego, (4) miesiąc źródłowy zawierał premię lub korektę, (5) w kalendarzu są nadgodziny niezatwierdzone lub nierozstrzygnięte, (6) w miesiącu jest zatwierdzona nieobecność zmieniająca wypłatę, (7) osoba w GLOBAL nie ma podziału JAG/PUL. Doprecyzowane przy odbiorze etapu 1 (ta sama zasada: nie kopiować kwoty nietypowej): do (4) liczą się też wypłacone nadgodziny w miesiącu źródłowym; (8) miesiąc źródłowy nie był przepracowany w całości; (9) miesiąc źródłowy zawierał nieobecność zmieniającą wypłatę. |
| D9 | Zmiany, które pojawią się **po** zatwierdzeniu (nadgodziny, nieobecność, data zakończenia pracy, zmiana angażu), dają znacznik „zmiana po zatwierdzeniu — sprawdź kwotę" i powiadomienie. Automat nigdy sam nie otwiera zatwierdzonego rozliczenia. |
| D10 | Automat jest po wdrożeniu **wyłączony**. Właściciel włącza go raz w ustawieniach. Włączenie nie uruchamia przebiegu za bieżący miesiąc — pierwszy przebieg jest 1. dnia następnego miesiąca. |
| D11 | Automat kopiuje brutto i netto. Koszt pracodawcy przelicza z aktualnych stawek; jeśli w miesiącu źródłowym był wpisany ręcznie, kopiuje kwotę. Premii i korekt nie kopiuje. W historii autorem jest „Automat". |
| D12 | **Wykonawca zewnętrzny** = karta osoby z rodzajem umowy `B2B`. Firma nie ma pracowników na B2B; to wyłącznie podwykonawcy rozliczani fakturą za pracę. Bez nowego pola w bazie. |
| D13 | Wykonawcy są widoczni tylko w: nowej zakładce „Wykonawcy" przy liście pracowników, module Montaże, Ustawienia → Użytkownicy. Nie ma ich w: Wynagrodzeniach, Czasie pracy (ewidencja, grafik, nadgodziny), Urlopach (salda, kalendarz, wnioski), raportach HR i PDF, strukturze, listach wyboru przełożonego. Bez przełączników „pokaż". |
| D14 | Osoba bez wpisanego rodzaju umowy **zostaje** na liście płac i w HR, z ostrzeżeniem. Nikt nie może zniknąć przez brak danych. |
| D15 | **Stawka godzinowa:** brutto = zatwierdzone godziny z Czasu pracy × stawka. Każda zatwierdzona godzina jest płatna tą samą stawką (bez dodatku za soboty i nadgodziny, bez decyzji „wypłata czy czas wolny"). Kwotę można zmienić ręcznie. |
| D16 | Godziny osoby na umowie zleceniu wpisuje i zatwierdza ADMIN w Czasie pracy, także z wyprzedzeniem na dni do końca miesiąca. Nie budujemy ekranu wpisywania godzin przez pracownika. |
| D17 | Netto przy stawce godzinowej podpowiada się z proporcji netto do brutto z ostatniego zatwierdzonego miesiąca tej osoby. |
| D18 | Osoby godzinowe są zatwierdzane wyłącznie ręcznie. Dwa dni robocze przed ostatnim dniem roboczym miesiąca ADMIN dostaje przypomnienie o niezatwierdzonych osobach. Dzień roboczy = poniedziałek–piątek bez świąt ustawowych. |
| D19 | Osoba godzinowa bez godzin w kalendarzu dostaje podpowiedź kwoty z poprzedniego miesiąca z ostrzeżeniem „brak godzin — sprawdź kwotę". |
| D20 | Szacunek kosztu pracodawcy w wyniku firmy (dla miesiąca bez zatwierdzonego rozliczenia) bierze koszt z ostatniego zatwierdzonego miesiąca tej osoby; dopiero gdy go nie ma — angaż × stawki. |
| D21 | Nowe karty wykonawców nie dostają sald urlopowych. |
| D22 | Strona szczegółów rozliczenia jest porządkowana jako ostatni etap. |

---

## 3. Słownik

Terminy istniejące są w `CONTEXT.md` (Angaż, Lista płac, Pasek wynagrodzenia, Koszt pracodawcy, Szacunek kosztu pracodawcy). Nowe na potrzeby planu:

- **Arkusz miesiąca** — lista `/hr/payroll` po przebudowie: wiersz na osobę, pola brutto i netto edytowalne w miejscu.
- **Podpowiedź** — kwoty wyliczone przy odczycie arkusza (z poprzedniego miesiąca albo z godzin), wpisane w pola wiersza. Podpowiedź **nie jest zapisana w bazie**.
- **Wiersz gotowy** — ma podpowiedź, nie ma znaczników ani blokad; nadaje się do zatwierdzenia bez czytania.
- **Znacznik** — powód, dla którego wiersz wymaga spojrzenia (reguły D8). Nie blokuje ręcznego zatwierdzenia.
- **Blokada** — istniejące `PayrollBlocker` z `src/lib/payroll/summary.ts`. Blokuje zatwierdzenie.
- **Automat** — zaplanowane zadanie w procesie aplikacji, które 1. dnia miesiąca zatwierdza wiersze gotowe.
- **Wykonawca zewnętrzny** — patrz D12. Termin do dopisania w `CONTEXT.md` w etapie 4.

---

## 4. Stan obecny — gdzie co jest

| Obszar | Pliki |
|---|---|
| Lista miesiąca (UI) | `src/app/(dashboard)/hr/payroll/page.tsx`, `src/components/hr/payroll/payroll-month-view.tsx` |
| Szczegóły rozliczenia (UI) | `src/app/(dashboard)/hr/payroll/[id]/page.tsx`, `src/components/hr/payroll/payroll-settlement-view.tsx`, `employer-cost-panel.tsx`, `base-salary-dialog.tsx` |
| Stawki pracodawcy (UI) | `src/app/(dashboard)/hr/payroll/rates/page.tsx`, `src/components/hr/payroll/employer-rates-view.tsx` |
| Pasek pracownika | `src/app/(dashboard)/hr/my-pay/page.tsx`, `src/components/hr/payroll/my-pay-view.tsx` |
| Styl modułu | `src/components/hr/payroll/payroll.module.css` (tokeny `--pr-*`, DM Mono, animacja `rise`) |
| Logika | `src/lib/payroll/service.ts` (tworzenie, akcje, wersje, audyt), `calendar.ts` (migawka kalendarza i angażu, odcisk), `summary.ts` (blokady, ostrzeżenia), `employer-cost.ts` (stawki, podział JAG/PUL), `cost-context.ts`, `period.ts`, `money.ts`, `http.ts` |
| Kontrakty dla finansów i paska | `src/lib/payroll/contracts.ts` (`getEffectivePayrollCosts`, `getMonthlyEmployerCosts`, `getOwnPayrollStatements`) |
| Walidacja | `src/lib/validations/payroll.ts` |
| API | `src/app/api/hr/payroll/{settlements,settlements/[id],base-salaries,cost-settings,cost-splits,employer-rates}` |
| Schemat | `prisma/schema.prisma` (modele `Payroll*`), migracje `prisma/migrations/20260922120000_hr_payroll_settlements`, `20260930090000_payroll_employer_cost` |
| Testy | `__tests__/unit/hr/payroll-calculations.test.ts`, `payroll-employer-cost.test.ts`, `__tests__/integration/hr/payroll-settlement-flow.test.ts`, `payroll-employer-cost-flow.test.ts`, `e2e/hr-payroll.spec.ts` |
| Dokumenty | `docs/plans/2026-09-22-payroll-data-contract.md`, `docs/evidence/2026-09-22-payroll-settlement.md` |
| Wzorzec harmonogramu | `src/instrumentation.ts`, `src/lib/finance/ksef-auto-sync.ts` (slot w `AppSetting`, nadrabianie po przestoju) |
| Powiadomienia | model `Notification`; przykład tworzenia: `src/app/api/alerts/check/route.ts` |
| Czas pracy | `src/app/api/hr/time-tracking/**`, zatwierdzanie wpisu: `[id]/approve/route.ts`, `bulk-approve/route.ts` |
| Urlopy | `LeaveRequestNew`, `LeaveType`, katalog typów: `src/lib/hr/leave-type-catalog.ts` |
| Święta i daty | `getPolishHolidays(year)` w `src/lib/hr/constants.ts`, `getWarsawBusinessDate` w `src/lib/hr/business-date.ts` |
| Pracownicy | `src/app/(dashboard)/hr/employees/**`, `src/app/api/hr/employees/route.ts`, `src/components/hr/employees/{employee-filters,employee-select}.tsx`, `src/lib/hr/access.ts` |
| Konta wykonawców | rola `INSTALLER` w `User`, powiązanie z kartą: `src/app/api/users/route.ts`, `src/lib/accounts/installer-invariant.ts`, `src/components/settings/users-management.tsx` |

Jak działa dziś lista: `listSettlementsForMonth` zwraca **wszystkie** karty zatrudnione w miesiącu, także B2B. Nowy miesiąc nie ma żadnych kwot. Kwoty wpisuje się wyłącznie na stronie szczegółów akcjami `payrollOffice.confirm` i `approve` (PATCH `/api/hr/payroll/settlements/[id]`).

---

## 5. Niezmienniki — nie wolno ich złamać

1. **Rozliczenia nie da się usunąć** (trigger `PayrollSettlement_no_delete`). Dlatego nie wolno tworzyć rozliczeń „na zapas". W ścieżce arkusza rekord `PayrollSettlement` powstaje **w tej samej transakcji** co jego zatwierdzenie; nieudane zatwierdzenie nie zostawia po sobie żadnego rekordu.
2. **Zatwierdzona wersja jest niezmienna.** Zmiana kwoty = otwarcie korekty → nowa wersja, która zastępuje poprzednią. Dla osoby i miesiąca obowiązuje dokładnie jedna wersja (`supersededAt IS NULL`).
3. **Historia tylko dopisywana.** Każda zmiana stanu zapisuje `PayrollAuditEvent` w tej samej transakcji, z tymi samymi nazwami akcji co dziś (`settlement.create`, `settlement.reopen`, `calendar.sync`, `payrollOffice.confirm`, `settlement.approve`).
4. **Kwoty to całkowite grosze** (`Int`). Parsowanie wyłącznie przez `parsePlnToGrosze`, wyświetlanie przez `formatGrosze`. Żadnego `Float`.
5. **Dane płacowe tylko dla ADMIN.** Każda nowa trasa pod `/api/hr/payroll/*` używa `requirePayrollAdmin()` i nagłówka `PAYROLL_NO_STORE`. Reguła w `src/proxy.ts` już obejmuje ten prefiks — nie wolno wystawić danych płacowych pod inną ścieżką.
6. **Finanse czytają płace tylko przez `contracts.ts`.** Sygnatury i znaczenie pól istniejących funkcji nie mogą się zmienić; wolno dodawać pola.
7. **Logika współdzielona, nie kopiowana.** Ścieżka arkusza i automat używają tych samych funkcji co strona szczegółów (potwierdzenie, zatwierdzenie, korekta). Przed dopisaniem nowej ścieżki wydziel z `applySettlementAction` funkcje przyjmujące klienta transakcji.
8. **Migracje jako pliki SQL** w `prisma/migrations/<znacznik>_<nazwa>/migration.sql`, w stylu istniejących migracji płac (CHECK-i, triggery). Produkcja uruchamia `prisma migrate deploy` (patrz `docker-entrypoint.sh`). Zapis w `CLAUDE.md` o `db push` jest nieaktualny — **nie używać `db push`**.
9. **Filtr „nie B2B" a wartości puste.** W Prisma warunek `{ employmentType: { not: 'B2B' } }` odrzuca także wiersze z `null`. Zawsze używać `OR: [{ employmentType: null }, { employmentType: { not: 'B2B' } }]` (stała ze wspólnego modułu, patrz etap 1). Gdy zapytanie ma już własne `OR` (np. wyszukiwanie), łączyć przez `AND`.
10. **Prywatność.** W testach, fixture'ach, zrzutach ekranu, dokumentach i treści PR-ów wyłącznie dane syntetyczne (wzór: „Testowa Płacowa"). Żadnych prawdziwych nazwisk ani kwot z produkcji.
11. Reguły projektu z `CLAUDE.md`: `params` i `searchParams` jako `Promise` (Next.js 16), klient Prisma z `@/generated/prisma`, TypeScript strict bez `any`, kod po angielsku, interfejs po polsku, Zod na każdym wejściu API (`.nullish()` dla pól czyszczonych, `.strict()` jak w istniejących schematach płac).

---

## 6. Zasady globalne każdego etapu

- Żaden widoczny element interaktywny nie jest atrapą: działa albo nie istnieje. Nie renderować UI „na przyszłość" pod kolejne etapy.
- Dane na ekranie pochodzą z bazy; akcja zmienia stan w bazie, a nie tylko pokazuje komunikat; podpowiedź jest liczona z prawdziwych danych, nie ze stałych.
- Logika domenowa w `src/lib/**`, nie w komponentach. Komponent wolno użyć `calculateEmployerCostGrosze` do podglądu na żywo, ale ostateczną kwotę zawsze liczy serwer.
- Wygląd: istniejący język modułu (`payroll.module.css`, tokeny `--pr-*`, DM Mono dla kwot, animacja wejścia `rise`, `prefers-reduced-motion`). Nie dodawać nowych czcionek ani palet. Pola kwot wyrównane do prawej, cyfry tabelaryczne.
- Dostępność: każde pole ma etykietę (`aria-label` z nazwiskiem osoby), kolejność Tab idzie wierszami, stany błędu mają `role="alert"`.
- Świadome uproszczenia i odstępstwa od planu trafiają do raportu, nie są ukrywane.
- Po zakończeniu etapu: aktualizacja `project_status.md`; `architecture.md` przy zmianie schematu; `CONTEXT.md` przy nowym terminie; pytanie do właściciela o commit i push (bez samodzielnego pushowania).

---

## 7. Bramka i raport (wspólne)

Bramka etapu — wszystko zielone albo etap **nie** jest ukończony:

```bash
npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts
npm run typecheck:app
npx eslint <zmienione pliki>
npm run build
npx playwright test <specyfikacje wymienione w etapie> e2e/hr-payroll.spec.ts
```

- Polecenie testów jest tym samym, którego używa GitHub Actions (`.github/workflows/build-image.yml`). Plik `ksef-sync.test.ts` jest tam jawnie wyłączony (11 znanych błędów sprzed tej pracy). Testy `__tests__/unit/invoice-import/document-processor.test.ts` wymagają Popplera (`pdfinfo`, `pdftoppm`); na komputerze bez niego 4 z nich nie przechodzą, a rozstrzyga wynik GitHub Actions.
- Testy integracyjne budują świeżą bazę z migracji (wzór: `__tests__/integration/hr/payroll-settlement-flow.test.ts`), E2E korzysta z `e2e/global-setup.ts`.
- Limit 5 iteracji naprawczych. Po przekroczeniu STOP i opis problemu — nie oznaczać etapu jako ukończonego, nie wyłączać ani nie osłabiać testów.
- Raport końcowy w `docs/evidence/<data>-<etap>.md` z sekcją **DOWÓD**: uruchomione komendy z wynikiem oraz dla każdego punktu DoD zrzut ekranu, odpowiedź API albo rekord z bazy. Zrzuty w `docs/evidence/<katalog>/`. Etap bez sekcji DOWÓD nie jest ukończony.

Audyt atrap przed zamknięciem etapu (wynik każdego punktu w raporcie):

1. Kliknięty każdy widoczny element na zmienionych ekranach.
2. Utworzony zapis da się zmienić przez UI (korekta kwoty, zmiana numeru listy, wyłączenie przełącznika).
3. Restart aplikacji — dane przetrwały.
4. Czysta baza: główny przepływ etapu przechodzi bez SQL i bez zaglądania do kodu.
5. Druga rola (MANAGER, EMPLOYEE, INSTALLER) nie widzi danych płacowych i dostaje 403 lub przekierowanie.
6. Zmiana danych w bazie zmienia ekran (ekran nie renderuje stałych).

---

## 8. Etap 1 — Arkusz miesiąca (Opus)

### Cel

ADMIN otwiera miesiąc, widzi w wierszach kwoty podpowiedziane z poprzedniego miesiąca, poprawia tylko różnice i zatwierdza wszystkie osoby jednym kliknięciem; wykonawców B2B nie ma na liście.

### Zadania

1. **Reguła wykonawcy** — nowy `src/lib/hr/contractors.ts`: stała `EXTERNAL_CONTRACTOR_EMPLOYMENT_TYPE = 'B2B'`, `isExternalContractor(employee)`, fragmenty zapytań `STAFF_WHERE` (patrz niezmiennik 9) i `CONTRACTOR_WHERE`. To jedyne miejsce, w którym zapisana jest reguła D12.
2. **Podpowiedź i znaczniki** — nowy czysty moduł `src/lib/payroll/carryover.ts` z funkcją oceniającą jedną osobę w miesiącu. Wejście: daty zatrudnienia, rodzaj umowy, segmenty angażu w miesiącu (`resolveBaseSegments`), obowiązująca wersja z miesiąca **bezpośrednio poprzedniego** (albo `null`), kontekst kosztu (`EmployerCostContext`), blokady z migawki kalendarza, zatwierdzone nieobecności zmieniające wypłatę. Wyjście:
   - `suggestion` albo `null`: brutto i netto z wersji źródłowej; koszt pracodawcy przeliczony z aktualnych stawek, gdy źródło miało `employerCostSource = 'CALCULATED'` i stawki istnieją, w pozostałych przypadkach (`OVERRIDDEN`, starsze `ENTERED`, brak stawek) skopiowany jako kwota wpisana ręcznie; `sourceMonth`.
   - `flags`: `NO_PREVIOUS_MONTH`, `PARTIAL_MONTH`, `BASE_CHANGED`, `PREVIOUS_HAD_ADJUSTMENTS`, `PAY_AFFECTING_ABSENCE`, `HOURLY_BASIS`, `EMPLOYMENT_TYPE_MISSING`.
   - `autoEligible`: jest podpowiedź, brak znaczników, brak blokad, angaż miesięczny.
   - Nieobecność zmieniająca wypłatę = zatwierdzony `LeaveRequestNew` zachodzący na miesiąc, którego typ ma `isPaid = false` **albo** kod z listy `SL`, `ML`, `PL`, `FIL` (chorobowe i zasiłki; w katalogu mają `isPaid = true`, a mimo to zmieniają kwotę z listy płac). Lista kodów jako stała w `src/lib/payroll/`.
3. **Odczyt arkusza** — `getPayrollSheet(db, period)` w `service.ts` i `GET /api/hr/payroll/sheet?month=YYYY-MM`. Zakres wierszy: osoby zatrudnione w miesiącu (`isEmployedInPeriod`), które nie są wykonawcami, **plus** każda osoba mająca już rozliczenie w tym miesiącu. Wiersz zawiera: dane osoby, bieżący angaż, rozliczenie (id, status, rewizja), obowiązującą wersję (kwoty), kwoty szkicu, `suggestion`, `flags`, `blockers`, `autoEligible`, stawki do podglądu kosztu. Poziom miesiąca: numer listy płac, suma zatwierdzonego kosztu bieżącego i poprzedniego miesiąca.
4. **Zatwierdzenie w jednej transakcji** — `settleEmployeeMonth(db, actorId, input)` w `service.ts`. W **jednej** transakcji: brak rozliczenia → utworzenie; szkic z nieaktualnym kalendarzem → ponowne pobranie; rozliczenie zatwierdzone → otwarcie korekty z powodem `Korekta kwot na liście miesiąca`; następnie sprawdzenie blokad, potwierdzenie kwot (`validatePayrollOfficeFigures`, koszt wyliczony albo wpisany ręcznie), zatwierdzenie nowej wersji. Blokada lub błąd walidacji wycofuje całą transakcję. Gdy rozliczenie jest zatwierdzone, a przesłane kwoty są identyczne z obowiązującą wersją — nic nie rób i zwróć `UNCHANGED` (żadnej nowej wersji).
5. **Migawka wejść w wersji** — przy każdym zatwierdzeniu (obie ścieżki) dopisz do `snapshotJson` klucz `inputs`: daty zatrudnienia przycięte do miesiąca i posortowane identyfikatory nieobecności zmieniających wypłatę. Etap 2 porównuje je ze stanem bieżącym.
6. **Zapis zbiorczy** — `POST /api/hr/payroll/sheet` z `{ month, rows: [{ employeeId, finalGross, finalNet, employerCost?, expectedRevision? }] }` (Zod `.strict()`, kwoty jak w istniejącym `plnAmount`). Każdy wiersz w osobnej transakcji; odpowiedź 200 z wynikiem na wiersz: `APPROVED` (z numerem wersji), `UNCHANGED`, `BLOCKED` (z listą blokad po polsku), `CONFLICT` (nieaktualna rewizja albo rozliczenie powstało w międzyczasie), `INVALID` (komunikat walidacji). Częściowy sukces jest dozwolony i raportowany.
7. **Numer listy płac miesiąca** — nowa tabela `PayrollMonth` (klucz `year` + `month`, `listReference` do 200 znaków, `updatedById`, `updatedAt`), migracja SQL, `PUT /api/hr/payroll/months/[month]`. Przy zatwierdzeniu z arkusza numer miesiąca jest kopiowany do `payrollOfficeReference` nowej wersji. Zmiana numeru później nie wymaga korekty i nie tworzy wersji.
8. **UI arkusza** — przebudowa `payroll-month-view.tsx`:
   - Nagłówek: nawigacja miesiąca bez zmian, opis skrócony do jednego zdania, pole „Numer listy płac" (zapis po opuszczeniu pola lub Enter, widoczne potwierdzenie zapisu), wskaźniki: „Zatwierdzone X / Y", „Koszt pracodawcy (zatwierdzony)" z różnicą do poprzedniego miesiąca, „Wymaga uwagi: N".
   - Kolumny wiersza: zaznaczenie · osoba (nazwisko i imię; pod spodem stanowisko, centrum kosztów, umowa, angaż) · Brutto (pole) · Netto (pole) · Koszt pracodawcy (liczony na żywo ze stawek; przycisk „wpisz ręcznie” zamienia go w pole, „licz ze stawek” przywraca wyliczenie; przy braku stawek od razu pole) · różnica do poprzedniego miesiąca · status · akcje.
   - Pola wypełnia kolejno: obowiązująca wersja → kwoty szkicu → podpowiedź → puste. Podpowiedź ma odrębny wygląd (stonowany kolor, kursywa) i podpis źródła, np. „z października"; po edycji wygląda jak zwykła wartość.
   - Zaznaczenie: domyślnie zaznaczone tylko wiersze gotowe (`autoEligible`). Wiersz ze znacznikiem jest odznaczony i zaznacza się sam po edycji pola albo ręcznie. Wiersz z blokadą nie daje się zaznaczyć; pokazuje treść blokady i akcję, która ją usuwa („Angaż…" dla braku angażu, „Otwórz" dla pozostałych).
   - Znaczniki jako etykiety z polskim opisem (np. „angaż zmienił się od października", „poprzedni miesiąc zawierał premię", „stawka godzinowa — sprawdź kwotę", „brak rodzaju umowy — uzupełnij w karcie").
   - Wiersz zatwierdzony: pieczątka „Zatwierdzone · vN", pola pokazują zatwierdzone kwoty. Zmiana wartości pokazuje w wierszu przycisk „Zapisz korektę"; bez zmiany przycisku nie ma.
   - Pasek akcji przyklejony do dołu: „Zatwierdź zaznaczone (N)" z sumą kosztu zaznaczonych. Po zapisie wynik każdego wiersza jest widoczny w wierszu (pieczątka albo powód odmowy), a arkusz pobiera dane ponownie.
   - Klawiatura: Tab przechodzi brutto → netto → następny wiersz; Enter w polu zatwierdza ten wiersz. Kwoty przyjmują zapis `6500,50`.
   - Menu wiersza: „Szczegóły rozliczenia" (gdy rozliczenia nie ma — „Otwórz rozliczenie szczegółowe (utworzy szkic)", istniejące `POST /api/hr/payroll/settlements`), „Angaż…" (istniejący `BaseSalaryDialog`; pole „Obowiązuje od" wstępnie ustawione na pierwszy dzień oglądanego miesiąca).
   - Zmiana miesiąca przy niezapisanych zmianach: nawigacja jest wstrzymana i pojawia się komunikat w treści strony z akcjami „Zatwierdź zaznaczone" i „Porzuć zmiany". Bez okien `confirm()`.
   - Widok wąski (do 640 px): wiersz układa się w kartę, pola pod sobą; pasek akcji zostaje przyklejony.

### Poza zakresem etapu 1

- Harmonogram i automatyczne zatwierdzanie (etap 2).
- Wyliczanie brutto z godzin; osoby godzinowe mają w tym etapie podpowiedź z poprzedniego miesiąca i znacznik `HOURLY_BASIS` (etap 3).
- Znacznik „zmiana po zatwierdzeniu" (etap 2).
- Ukrywanie wykonawców poza listą płac (etap 4).
- Zmiany na stronie szczegółów. Pole „Numer listy płac / notatka" na stronie szczegółów zostaje do etapu 5.

### Definition of Done

- [ ] ADMIN otwiera miesiąc, w którym poprzedni miesiąc jest zatwierdzony dla trzech osób ze stałą pensją: w ich wierszach pola brutto i netto zawierają kwoty z poprzedniego miesiąca z podpisem źródła, a w bazie **nie ma** żadnego `PayrollSettlement` za oglądany miesiąc.
- [ ] ADMIN klika „Zatwierdź zaznaczone (3)": dla każdej osoby powstaje rozliczenie `APPROVED` z wersją v1 i trzema zdarzeniami historii (utworzenie, dane kadrowej, zatwierdzenie); wskaźnik pokazuje 3 / 3; po odświeżeniu strony i po restarcie aplikacji stan jest taki sam.
- [ ] ADMIN zmienia brutto jednej osoby przed zatwierdzeniem: koszt pracodawcy w wierszu przelicza się od razu, a po zatwierdzeniu wersja zawiera zmienioną kwotę i koszt wyliczony przez serwer.
- [ ] ADMIN zmienia netto w wierszu zatwierdzonym i klika „Zapisz korektę": powstaje wersja v2, v1 jest zastąpiona, `getEffectivePayrollCosts` zwraca dokładnie jeden rekord dla tej osoby, w historii jest powód korekty.
- [ ] ADMIN klika „Zapisz korektę" bez zmiany kwot (albo wysyła te same kwoty przez API): nie powstaje nowa wersja, wynik to `UNCHANGED`.
- [ ] Wiersz osoby bez angażu albo z nierozstrzygniętymi nadgodzinami nie daje się zaznaczyć i pokazuje powód; wysłanie go przez API zwraca `BLOCKED` i **nie zostawia** rekordu rozliczenia w bazie.
- [ ] Wiersz ze znacznikiem (zmiana angażu, premia w poprzednim miesiącu, częściowy miesiąc, nieobecność zmieniająca wypłatę, stawka godzinowa, brak poprzedniego miesiąca) jest odznaczony, pokazuje opis znacznika i po ręcznym zaznaczeniu daje się zatwierdzić.
- [ ] Osoba z rodzajem umowy B2B nie pojawia się na arkuszu i nie jest liczona we wskaźniku. Osoba B2B, która ma już rozliczenie w danym miesiącu, jest widoczna. Osoba bez rodzaju umowy jest widoczna z ostrzeżeniem. Próba zatwierdzenia z arkusza wykonawcy, który nie ma jeszcze rozliczenia, jest odrzucana przez serwer i nie zostawia rekordu.
- [ ] ADMIN wpisuje numer listy płac w nagłówku: po odświeżeniu numer jest widoczny; wersje zatwierdzone później mają go w `payrollOfficeReference`; zmiana numeru nie tworzy wersji.
- [ ] Dwie karty przeglądarki: zatwierdzenie w drugiej karcie wiersza zatwierdzonego już w pierwszej zwraca `CONFLICT` albo `UNCHANGED` i nie tworzy drugiej obowiązującej wersji.
- [ ] MANAGER i EMPLOYEE dostają 403 z `GET` i `POST /api/hr/payroll/sheet` oraz `PUT /api/hr/payroll/months/[month]`; bez sesji sama trasa zwraca 401, a w przeglądarce `src/proxy.ts` przekierowuje do logowania, zanim żądanie dotrze do trasy; wejście na `/hr/payroll` przekierowuje.
- [ ] Styczeń bierze podpowiedź z grudnia poprzedniego roku.

### Testy

- Jednostkowe `__tests__/unit/hr/payroll-carryover.test.ts`: każdy znacznik osobno; koszt przeliczony, skopiowany i starszy `ENTERED`; brak poprzedniej wersji daje `null`, nie zero; przełom roku; pełny rok dwunastu kolejnych miesięcy; kwoty ujemne i zero są odrzucane walidacją. Osobny test reguły wykonawcy: pusty rodzaj umowy nie jest wykonawcą.
- Integracyjne `__tests__/integration/hr/payroll-sheet-flow.test.ts`: wszystkie punkty DoD na poziomie API i bazy, w tym brak rekordu po `BLOCKED`, kolejność zdarzeń historii, jedna obowiązująca wersja po korekcie, role. Istniejący test „should start a new month empty…" zostaje — podpowiedź nie jest zapisem w bazie.
- E2E `e2e/hr-payroll-sheet.spec.ts`: przepływ z DoD przez UI (podpowiedź, zmiana jednej kwoty, zatwierdzenie zbiorcze, korekta w wierszu, restart serwera, brak osoby B2B, odmowa dla EMPLOYEE).

---

## 9. Etap 2 — Automat 1. dnia miesiąca (Opus)

Wymaga wdrożonego etapu 1.

### Cel

Gdy automat jest włączony, 1. dnia miesiąca osoby ze stałą pensją mają zatwierdzone rozliczenie bez udziału ADMIN-a, a ADMIN dostaje powiadomienie z liczbą wierszy zatwierdzonych i wymagających uwagi.

### Zadania

1. **Pochodzenie wersji** — kolumna `origin` w `PayrollSettlementVersion` (`MANUAL` domyślnie, `AUTO_CARRYOVER`), migracja SQL z CHECK. Trigger niezmienności wersji musi objąć nową kolumnę — odtwórz go tak, jak zrobiła to migracja `20260930090000_payroll_employer_cost` (DROP + CREATE z pełną listą kolumn).
2. **Autor „Automat"** — stała `PAYROLL_SYSTEM_ACTOR_ID = 'system:payroll-auto'` używana jako autor utworzenia, potwierdzenia, zatwierdzenia i zdarzeń historii. Kolumny autorów nie mają kluczy obcych. Wszędzie, gdzie interfejs rozwiązuje identyfikator autora na nazwę (m.in. `getSettlementDetail`), ten identyfikator daje nazwę „Automat".
3. **Przebieg** — `src/lib/payroll/auto-carryover.ts`: `runPayrollAutoCarryover(db, period)`. Dla każdej osoby z zakresu arkusza **bez żadnego rozliczenia** w miesiącu i z `autoEligible = true` wywołuje `settleEmployeeMonth` z kwotami podpowiedzi, autorem „Automat", `origin = AUTO_CARRYOVER` i notatką wersji `Automatyczne przeniesienie z RRRR-MM`. Osoby z istniejącym rozliczeniem (także szkicem) pomija. Zwraca podsumowanie: zatwierdzone, wymagające uwagi (z powodami), błędy. Ponowne uruchomienie za ten sam miesiąc nie tworzy niczego nowego.
4. **Harmonogram** — `src/lib/payroll/auto-carryover-scheduler.ts` na wzór `ksef-auto-sync.ts`, rejestrowany w `src/instrumentation.ts`. Klucze `AppSetting`: `payroll_auto_carryover_enabled`, `payroll_auto_carryover_last_month`, `payroll_auto_carryover_last_result`. Przebieg jest należny, gdy automat jest włączony, w strefie Europe/Warsaw jest co najmniej 1. dzień miesiąca godz. 06:00 i `last_month` jest wcześniejszy niż bieżący miesiąc. Slot jest zajmowany przed przebiegiem. Po przestoju serwera przebieg wykonuje się przy pierwszym sprawdzeniu w danym miesiącu. Zmienna środowiskowa `PAYROLL_AUTO_CARRYOVER=off` wyłącza harmonogram całkowicie; poza produkcją działa tylko przy `=on`.
5. **Włączanie** — `GET/PUT /api/hr/payroll/automation` (ADMIN). Włączenie ustawia `last_month` na bieżący miesiąc (D10). Panel „Automatyczne przenoszenie wynagrodzeń" na stronie `/hr/payroll/rates`: przełącznik, data następnego przebiegu, wynik ostatniego przebiegu (data, liczby). Pozycja menu w `src/components/hr/hr-sidebar.tsx` zmienia nazwę ze „Stawki pracodawcy" na „Ustawienia płac". Na arkuszu jedna linia stanu: „Automat: włączony · następny przebieg 1 grudnia" albo „Automat: wyłączony", z linkiem do ustawień.
6. **Powiadomienie po przebiegu** — `Notification` dla każdego aktywnego użytkownika ADMIN: tytuł w rodzaju „Wynagrodzenia za grudzień: 3 zatwierdzone automatycznie, 2 wymagają uwagi", link do arkusza miesiąca. Przebieg, który nic nie zatwierdził i nie ma wierszy wymagających uwagi, nie wysyła powiadomienia.
7. **Oznaczenie na arkuszu** — wiersz z obowiązującą wersją `AUTO_CARRYOVER` ma pieczątkę „Zatwierdzone automatycznie · vN", wizualnie odróżnioną od ręcznej.
8. **Zmiana po zatwierdzeniu (D9)** — dla wiersza zatwierdzonego arkusz porównuje stan bieżący ze stanem z zatwierdzenia: odcisk kalendarza i angażu (`calendarFingerprint`, istniejący mechanizm) oraz `inputs` z migawki wersji (daty zatrudnienia, nieobecności zmieniające wypłatę). Różnica daje etykietę „zmiana po zatwierdzeniu — sprawdź kwotę" z wyliczeniem, co się zmieniło (godziny lub angaż, daty zatrudnienia, nieobecność). Wiersz oferuje dwie akcje: korektę kwoty (z etapu 1) oraz „Kwota aktualna", która dopisuje zdarzenie historii `settlement.changesAcknowledged` z sygnaturą bieżącego stanu i chowa etykietę do następnej zmiany. Wersje bez klucza `inputs` (sprzed etapu 1) porównują tylko odcisk kalendarza.
9. **Codzienne powiadomienie o zmianach** — ten sam harmonogram, raz dziennie o 07:00 Europe/Warsaw: dla bieżącego miesiąca powiadamia ADMIN-ów o osobach z niepotwierdzoną zmianą po zatwierdzeniu. Jedna zmiana = jedno powiadomienie (sygnatury zapamiętane w `AppSetting`); ta sama, niezmieniona sytuacja nie generuje powiadomienia następnego dnia.
10. **Szacunek w wyniku firmy (D20)** — `getMonthlyEmployerCosts` w `contracts.ts`: dla osoby bez zatwierdzonej wersji w miesiącu szacunek to koszt pracodawcy z jej najnowszej obowiązującej wersji z **wcześniejszego** miesiąca, podzielony na salony według podziału obowiązującego w szacowanym miesiącu; gdy takiej wersji nie ma — dotychczasowe wyliczenie z angażu i stawek; gdy i to niemożliwe — `MISSING` jak dziś. Osoba godzinowa z wcześniejszą wersją dostaje `ESTIMATE` zamiast `MISSING`. Nowe pole `estimateSource` (`LAST_APPROVED` | `BASE_RATES` | `null`). Zaktualizuj definicję „Szacunek kosztu pracodawcy" w `CONTEXT.md` i sprawdź odbiorców w `src/lib/finance/employer-costs.ts`.

### Poza zakresem etapu 2

- Automatyczne zatwierdzanie osób godzinowych (nigdy — D18).
- Automatyczne otwieranie korekt (nigdy — D9).
- Przebieg za miesiące wcześniejsze niż bieżący.
- Ukrywanie paska pracownika dla wersji automatycznych (D7 — pasek jest widoczny od razu).

### Definition of Done

- [ ] ADMIN włącza automat w ustawieniach płac: przełącznik zostaje włączony po odświeżeniu, panel pokazuje datę następnego przebiegu (1. dzień następnego miesiąca), a w bieżącym miesiącu **nie powstaje** żadne rozliczenie.
- [ ] Przebieg za miesiąc M przy zatwierdzonym M−1 (test wywołuje funkcję przebiegu z ustawionym czasem): osoby gotowe mają wersję v1 z `origin = AUTO_CARRYOVER`, brutto i netto równe M−1, koszt przeliczony aktualnymi stawkami albo skopiowany przy koszcie wpisanym ręcznie, notatkę z miesiącem źródłowym; w historii autorem jest „Automat".
- [ ] Każda z siedmiu reguł D8 osobno powoduje, że osoba **nie** dostaje rozliczenia, a podsumowanie przebiegu podaje jej powód. Osoba godzinowa i osoba z istniejącym szkicem też są pominięte.
- [ ] Drugi przebieg za ten sam miesiąc nie tworzy żadnej wersji ani zdarzenia.
- [ ] Serwer uruchomiony 5. dnia miesiąca przy włączonym automacie i niewykonanym przebiegu wykonuje go przy pierwszym sprawdzeniu; przy wyłączonym automacie nie wykonuje nic.
- [ ] Po przebiegu każdy aktywny ADMIN widzi w dzwonku powiadomienie z liczbami i linkiem prowadzącym do arkusza miesiąca; MANAGER i EMPLOYEE go nie dostają.
- [ ] Arkusz pokazuje dla wierszy automatycznych pieczątkę „Zatwierdzone automatycznie", a strona szczegółów autora „Automat" w historii i wersjach.
- [ ] Pracownik, którego rozliczenie zatwierdził automat, widzi je w „Mój pasek".
- [ ] Po zatwierdzeniu ADMIN zatwierdza w Urlopach zwolnienie chorobowe osoby w tym miesiącu: jej wiersz dostaje etykietę zmiany z opisem „nieobecność"; kliknięcie „Kwota aktualna" chowa etykietę i zapisuje zdarzenie w historii; kolejna nowa zmiana pokazuje etykietę ponownie.
- [ ] To samo dla wpisu czasu pracy z nadgodzinami dodanego po zatwierdzeniu oraz dla daty zakończenia pracy ustawionej w karcie na dzień w tym miesiącu.
- [ ] Zmiana po zatwierdzeniu generuje jedno powiadomienie dla ADMIN-a; następnego dnia, bez nowych zmian, drugie nie powstaje.
- [ ] Wynik firmy za miesiąc bez zatwierdzonego rozliczenia osoby pokazuje jako szacunek koszt z jej ostatniego zatwierdzonego miesiąca; po zatwierdzeniu rozliczenia pokazuje kwotę zatwierdzoną, bez podwojenia.
- [ ] ADMIN wyłącza automat: następny należny przebieg się nie wykonuje.

### Testy

- Jednostkowe: wyznaczanie należnego przebiegu (pierwszy dzień, przed 06:00, po przestoju, włączenie w środku miesiąca, przełom roku); sygnatura zmian; szacunek kosztu (ostatnia wersja, powrót do angażu, osoba godzinowa, brak danych, przełom roku).
- Integracyjne `__tests__/integration/hr/payroll-auto-carryover.test.ts` oraz rozszerzenie `payroll-employer-cost-flow.test.ts`: punkty DoD na bazie z migracji, w tym strażnik bazy — bezpośrednia zmiana `origin` zatwierdzonej wersji jest odrzucana.
- E2E `e2e/hr-payroll-automation.spec.ts`: włączenie przełącznika, przebieg, pieczątka automatyczna na arkuszu, powiadomienie w dzwonku, etykieta zmiany i „Kwota aktualna". Przebieg w teście uruchamia skrypt wywołujący `runPayrollAutoCarryover` bezpośrednio na izolowanej bazie E2E. **Nie dodawać trasy HTTP do wywoływania przebiegu** — w tym repozytorium mechanizmy testowe nigdy nie są punktami HTTP (patrz komentarz w `e2e/dev-server.ts`).

---

## 10. Etap 3 — Stawka godzinowa (Opus)

Wymaga wdrożonych etapów 1 i 2.

### Cel

Dla osoby ze stawką godzinową ADMIN widzi w wierszu arkusza „godziny × stawka = brutto", może jednym kliknięciem zatwierdzić jej czekające godziny i zatwierdzić rozliczenie przed wypłatą.

### Zadania

1. **Wyliczenie** — w `carryover.ts` dla angażu `HOURLY_GROSS`: zatwierdzone minuty miesiąca (istniejąca definicja `approvedWorkedMinutes`: czas minus przerwy, tylko wpisy zatwierdzone — obejmuje soboty i nadgodziny), minuty czekające na zatwierdzenie, stawka; brutto = minuty × stawka w groszach / 60, zaokrąglone do grosza w górę od połowy, arytmetyką całkowitą. Netto = brutto × (netto / brutto z ostatniej zatwierdzonej wersji tej osoby), gdy taka wersja istnieje; inaczej puste. Koszt pracodawcy jak w etapie 1.
   - Zero zatwierdzonych minut → podpowiedź z poprzedniego miesiąca i znacznik `HOURLY_NO_HOURS` („brak godzin — sprawdź kwotę").
   - Dwa segmenty angażu w miesiącu → bez wyliczenia, znacznik `BASE_CHANGED`, kwota do wpisania ręcznie.
   - Wiersz godzinowy nigdy nie jest `autoEligible` i jest domyślnie odznaczony (znacznik `HOURLY_BASIS` zostaje).
2. **Blokady przy stawce godzinowej (D15)** — w `summary.ts`: przy `HOURLY_GROSS` blokady `OVERTIME_PENDING_APPROVAL` i `OVERTIME_UNRESOLVED` nie obowiązują; `HOURLY_ENTRIES_PENDING` i `OPEN_TIME_ENTRY` obowiązują nadal. W wersji minuty nadgodzin do wypłaty i do odbioru wynoszą 0. Na stronie szczegółów panel nadgodzin osoby godzinowej nie pokazuje przycisków „Wypłata / Czas wolny", tylko informację, że każda zatwierdzona godzina jest płatna stawką.
3. **Zatwierdzanie godzin z arkusza** — `POST /api/hr/payroll/sheet/approve-hours` z `{ employeeId, month }` (ADMIN): zatwierdza wszystkie czekające wpisy czasu pracy tej osoby w miesiącu, które mają godzinę wyjścia, zapisując zatwierdzającego tak samo jak `src/app/api/hr/time-tracking/[id]/approve/route.ts`. Wspólną logikę zatwierdzenia wpisu wydziel do `src/lib/hr/time-tracking/` i użyj w obu trasach. Wpisy bez godziny wyjścia pozostają i nadal blokują.
4. **UI wiersza godzinowego** — pod nazwiskiem: „38 h zatwierdzone · 6 h czeka" i przycisk „Zatwierdź godziny" (widoczny tylko, gdy coś czeka). Przy polu brutto wyliczenie „38 h × 50,00 zł". Po zatwierdzeniu godzin wiersz przelicza się bez przeładowania strony. Ręczna zmiana brutto jest dozwolona i wygrywa z wyliczeniem.
5. **Przypomnienie przed wypłatą (D18)** — czysta funkcja wyznaczająca dzień przypomnienia: ostatni dzień roboczy miesiąca minus dwa dni robocze (poniedziałek–piątek bez `getPolishHolidays`). W tym dniu (albo w pierwszym kolejnym, jeśli serwer nie działał, nie później niż ostatni dzień miesiąca) harmonogram z etapu 2 wysyła ADMIN-om powiadomienie „Wynagrodzenia za listopad: N osób bez zatwierdzonego rozliczenia, wypłata do 30.11" z linkiem do arkusza. Raz na miesiąc; gdy wszyscy są zatwierdzeni — brak powiadomienia.

### Poza zakresem etapu 3

- Wpisywanie godzin przez pracownika (D16).
- Porównanie planu z grafiku z godzinami faktycznymi.
- Dodatki za soboty, nadgodziny i pracę w święta przy stawce godzinowej.
- Wyliczanie netto ze składek i podatku.

### Definition of Done

- [ ] ADMIN wpisuje w Czasie pracy godziny osoby na stawce godzinowej, także na dni przyszłe do końca miesiąca: arkusz pokazuje je jako „czeka", a brutto liczy tylko z godzin zatwierdzonych.
- [ ] ADMIN klika „Zatwierdź godziny": wpisy z godziną wyjścia mają status zatwierdzony i zapisanego zatwierdzającego, licznik „czeka" spada do zera, brutto w wierszu równa się zatwierdzonym godzinom × stawka co do grosza.
- [ ] Sobotni wpis osoby godzinowej (w kalendarzu liczony w całości jako nadgodziny) wlicza się do godzin płatnych tą samą stawką i **nie** blokuje zatwierdzenia rozliczenia.
- [ ] Niezatwierdzony wpis albo wpis bez godziny wyjścia blokuje zatwierdzenie rozliczenia osoby godzinowej, z czytelnym powodem w wierszu.
- [ ] Netto w wierszu podpowiada się z proporcji ostatniego zatwierdzonego miesiąca (dla osoby, u której netto było równe brutto, netto równa się brutto); ADMIN może je zmienić przed zatwierdzeniem.
- [ ] Osoba godzinowa bez godzin w kalendarzu ma podpowiedź z poprzedniego miesiąca i ostrzeżenie „brak godzin — sprawdź kwotę"; da się ją zatwierdzić ręcznie.
- [ ] Wiersz godzinowy nie jest domyślnie zaznaczony do zatwierdzenia zbiorczego, a przebieg automatu z etapu 2 go pomija.
- [ ] ADMIN ręcznie zmienia wyliczone brutto i zatwierdza: wersja zawiera kwotę wpisaną, a w historii są zatwierdzone godziny.
- [ ] Po zatwierdzeniu rozliczenia zmiana godzin tej osoby daje etykietę „zmiana po zatwierdzeniu" (mechanizm etapu 2).
- [ ] W dniu przypomnienia ADMIN dostaje jedno powiadomienie z liczbą niezatwierdzonych osób i datą ostatniego dnia roboczego; gdy wszystkie osoby są zatwierdzone, powiadomienie nie powstaje.
- [ ] MANAGER i EMPLOYEE dostają 403 z `POST /api/hr/payroll/sheet/approve-hours`.
- [ ] Rozliczenie osoby ze stałą pensją nadal wymaga rozstrzygnięcia nadgodzin (brak regresji).

### Testy

- Jednostkowe: wyliczenie brutto (zaokrąglenia, 0 minut, dwa segmenty angażu), proporcja netto (brak poprzedniej wersji, netto równe brutto), blokady godzinowe kontra miesięczne, sobota jako automatyczne nadgodziny, dzień przypomnienia (miesiąc kończący się w weekend; marzec 2027, gdzie poniedziałek wielkanocny 29.03 przesuwa dzień przypomnienia na 26.03; grudzień).
- Integracyjne `__tests__/integration/hr/payroll-hourly-flow.test.ts`: punkty DoD na poziomie API i bazy.
- E2E `e2e/hr-payroll-hourly.spec.ts`: wpisanie godzin, „Zatwierdź godziny", wyliczone brutto, zatwierdzenie, odmowa dla innej roli.

---

## 11. Etap 4 — Wykonawcy poza HR (Sonnet, przegląd Opus)

Wymaga wdrożonego etapu 1 (moduł `src/lib/hr/contractors.ts`). Może iść równolegle z etapami 2 i 3.

### Cel

ADMIN zarządza wykonawcami w osobnej zakładce, a w pozostałych częściach HR widzi wyłącznie pracowników; wykonawcy nadal działają w Montażach i w zarządzaniu kontami.

### Zadania

1. **Zakładki listy** — `/hr/employees` dostaje dwie zakładki z licznikami: „Pracownicy" (domyślna, bez wykonawców) i „Wykonawcy" (`?kind=contractors`, tylko B2B). Filtr rodzaju umowy na zakładce pracowników nie zawiera B2B; na zakładce wykonawców nie ma go wcale. Pozostałe filtry, wyszukiwanie i stronicowanie działają w obu.
2. **API listy** — `GET /api/hr/employees` przyjmuje `kind=staff | contractors | all`. Domyślnie `all`, żeby nie zmienić zachowania istniejących wywołań; każde wywołanie z HR dostaje jawne `kind`. Sprawdź wszystkie miejsca wywołujące ten adres (dziś: `employee-form.tsx`, `leave/balances/page.tsx`, `employee-select.tsx`, `reports-dashboard.tsx`) i komponent `EmployeeSelect` — wybór karty przy zakładaniu konta w Ustawienia → Użytkownicy musi nadal oferować wykonawców.
3. **Dodawanie i karta wykonawcy** — przycisk „Dodaj wykonawcę" na zakładce prowadzi do istniejącego formularza z rodzajem umowy ustawionym na B2B bez możliwości zmiany. Zapis wykonawcy nie tworzy sald urlopowych (D21). Profil wykonawcy pokazuje tylko dane podstawowe i etykietę „Wykonawca zewnętrzny"; zakładki czasu pracy i urlopów oraz sekcje płacowe nie są renderowane. Zmiana rodzaju umowy w edycji przenosi kartę między zakładkami bez dodatkowej logiki.
4. **Ukrycie w HR** — każde zapytanie o listę osób w HR stosuje `STAFF_WHERE`. Punkt wyjścia (stan z 24.11.2026) — agent powtarza wyszukiwanie `employee.(findMany|count|groupBy)` oraz relacji `employees` i `_count` w `src/` i uzasadnia w raporcie decyzję dla **każdego** trafienia:

   | Decyzja | Miejsca |
   |---|---|
   | Wyklucz wykonawców | `lib/hr/time-tracking/range-loader.ts`; `api/hr/time-tracking/bulk/handler.ts`; `api/hr/schedules/{route,template/route,copy/route}.ts`; `(dashboard)/hr/time-tracking/schedule/page.tsx`; `api/hr/overtime-requests/route.ts`; `api/hr/leave/{summary,calendar}/route.ts`; `api/hr/leave-requests/{route,export/route}.ts`; `api/hr/leave-balances/route.ts`; `(dashboard)/hr/leave/{page,approval/page}.tsx`; `api/hr/reports/{export,monthly-pdf,projects,plan-vs-actual,overtime,attendance}/route.ts`; listy przełożonych w `(dashboard)/hr/employees/{new/page,[id]/edit/page}.tsx`; strona struktury |
   | Zakładki (pkt 1–2) | `(dashboard)/hr/employees/page.tsx`, `api/hr/employees/route.ts` |
   | Bez zmian — wykonawca musi być widoczny | `lib/installations/{order-service,delegation-service,scope-assignment-service}.ts`; `(dashboard)/installations/{new/page,[id]/page}.tsx`; Ustawienia → Użytkownicy |
   | Bez zmian — to nie lista | `api/hr/employees/[id]/route.ts` (jedna karta); `api/hr/time-tracking/bulk-approve/route.ts` (kontrola uprawnień); `api/hr/{positions,divisions,departments}/[id]/route.ts` (sprawdź: jeśli liczą przypisane karty przed usunięciem, wykonawca nadal ma blokować usunięcie) |
   | Już załatwione | `lib/payroll/service.ts` (etap 1); `lib/payroll/contracts.ts`, `lib/finance/employer-costs.ts` (filtr po rodzaju umowy) |

5. **Słownik** — dopisz „Wykonawca zewnętrzny" do `CONTEXT.md` (definicja z D12 i D13; unikać: „pracownik B2B", „współpracownik").

### Poza zakresem etapu 4

- Nowe pole lub model wykonawcy w bazie (D12).
- Zmiany w module Montaże i w rolach kont.
- Usuwanie istniejących sald urlopowych i wpisów czasu pracy wykonawców — zostają w bazie, przestają być widoczne.
- Dane firmy wykonawcy (NIP, numer rachunku) — osobne zgłoszenie, jeśli właściciel zechce.

### Definition of Done

- [ ] ADMIN otwiera `/hr/employees`: zakładka „Pracownicy" nie zawiera żadnej karty B2B, zakładka „Wykonawcy" zawiera tylko karty B2B, liczniki zakładek zgadzają się z liczbą wierszy.
- [ ] ADMIN dodaje wykonawcę przyciskiem na zakładce: karta pojawia się na zakładce „Wykonawcy", w bazie nie powstaje dla niej żaden `LeaveBalanceNew`, a profil nie ma zakładek czasu pracy ani urlopów.
- [ ] ADMIN edytuje dane wykonawcy i dezaktywuje jego kartę z poziomu zakładki — obie operacje działają jak dla pracownika.
- [ ] ADMIN zmienia rodzaj umowy karty z B2B na UoP: karta przechodzi na zakładkę „Pracownicy" i pojawia się w grafiku, saldach urlopowych i na arkuszu płac; zmiana odwrotna ją stamtąd usuwa.
- [ ] Przy jednym aktywnym wykonawcy i jednym pracowniku w bazie: wykonawcy nie ma w ewidencji czasu pracy, grafiku (także w kopiowaniu i szablonach), wnioskach nadgodzin, saldach, kalendarzu i wnioskach urlopowych, eksportach, raportach i PDF miesięcznym, strukturze ani na listach wyboru przełożonego; pracownik jest we wszystkich tych miejscach.
- [ ] Osoba z pustym rodzajem umowy jest widoczna we wszystkich miejscach z poprzedniego punktu.
- [ ] Wykonawca jest nadal wybieralny w karcie montażu (przypisanie do zakresu, wizyty) i w Ustawienia → Użytkownicy przy zakładaniu konta z rolą INSTALATOR; istniejące testy E2E montaży przechodzą bez zmian.
- [ ] MANAGER widzi na obu zakładkach tylko karty ze swojego zakresu (istniejąca reguła `getScopedEmployeeWhere`); EMPLOYEE i INSTALLER nie mają dostępu do listy jak dziś.
- [ ] `CONTEXT.md` zawiera termin „Wykonawca zewnętrzny".

### Testy

- Integracyjne `__tests__/integration/hr/contractor-visibility.test.ts`: macierz „miejsce × rodzaj karty" (pracownik, wykonawca, pusty rodzaj umowy) dla każdej trasy z tabeli; brak sald po utworzeniu wykonawcy; parametr `kind`.
- E2E `e2e/hr-contractors.spec.ts`: zakładki, dodanie wykonawcy, jego nieobecność w grafiku i urlopach, obecność w wyborze montażysty i w zarządzaniu kontami.
- Bramka dodatkowo: `npx playwright test e2e/installations-*.spec.ts e2e/hr-time-tracking.spec.ts`.

---

## 12. Etap 5 — Strona szczegółów rozliczenia (Sonnet)

Wymaga wdrożonych etapów 1–3.

### Cel

ADMIN, który wchodzi w szczegóły z powodu wyjątku, ma kwoty i zatwierdzenie na pierwszym ekranie, a rzadko używane panele zwinięte.

### Zadania

1. **Kolejność paneli** w `payroll-settlement-view.tsx`: (1) nagłówek z trzema kwotami, (2) blokady i ostrzeżenia, jeśli są, (3) „Kwoty i zatwierdzenie", (4) „Nadgodziny z kalendarza", (5) „Premie i korekty", (6) „Składniki do kadrowej", (7) zwinięte: „Koszt pracodawcy i podział", „Wersje", „Historia zmian".
2. **Panel „Kwoty i zatwierdzenie"** łączy dzisiejsze „Dane od kadrowej" i „Zatwierdzenie": pola brutto, netto i koszt pracodawcy wstępnie wypełnione tą samą podpowiedzią co arkusz (funkcja z `carryover.ts`), przycisk „Zapisz i zatwierdź" korzystający z `settleEmployeeMonth`, opcjonalna notatka do wersji. Dla rozliczenia zatwierdzonego: pola z obowiązującymi kwotami, pole „Powód korekty" i przycisk „Zapisz korektę".
3. **Numer listy płac** — pokazany tylko do odczytu z `PayrollMonth`, z linkiem do arkusza miesiąca. Pole „Numer listy płac / notatka" przy rozliczeniu znika.
4. **Zwinięte panele** jako natywne `<details>`, z podsumowaniem w nagłówku (np. „Wersje · 2 · obowiązuje v2"). Panel „Koszt pracodawcy i podział" otwiera się sam, gdy brakuje podziału JAG/PUL.
5. **Pasek etapów** (pięć pigułek) znika; jego rolę pełni lista blokad. Z wiersza metadanych znika „rewizja N".
6. Aktualizacja `e2e/hr-payroll.spec.ts` do nowego układu bez osłabiania asercji.

### Poza zakresem etapu 5

- Nowe akcje lub pola, których nie ma w etapach 1–3.
- Zmiany logiki w `src/lib/payroll/**`.

### Definition of Done

- [ ] ADMIN otwiera szkic rozliczenia przy rozdzielczości 1280×800: pola brutto i netto oraz przycisk „Zapisz i zatwierdź" są widoczne bez przewijania i zawierają podpowiedź z poprzedniego miesiąca.
- [ ] ADMIN klika „Zapisz i zatwierdź": powstaje wersja, w historii są zdarzenia potwierdzenia i zatwierdzenia, arkusz miesiąca pokazuje tę samą kwotę.
- [ ] ADMIN dodaje premię, poprawia ją z powodem i usuwa; rozstrzyga nadgodziny; pobiera ponownie kalendarz; ustawia zwolnienie ze składek i podział JAG/PUL — każda z tych operacji działa jak przed zmianą.
- [ ] ADMIN wpisuje powód i zapisuje korektę zatwierdzonego rozliczenia: powstaje kolejna wersja, poprzednia jest oznaczona jako zastąpiona.
- [ ] Panele „Wersje" i „Historia zmian" są zwinięte, rozwijają się kliknięciem i klawiaturą, a ich nagłówki pokazują prawdziwe liczby z bazy.
- [ ] Numer listy płac na stronie szczegółów odpowiada numerowi miesiąca z arkusza; po zmianie numeru na arkuszu zmienia się także tutaj.
- [ ] Widok 390 px szerokości: wszystkie panele mieszczą się bez poziomego przewijania.

### Testy

- E2E: zaktualizowany `e2e/hr-payroll.spec.ts` plus nowy test układu (widoczność pól bez przewijania, zwinięte panele, numer miesiąca).
- Integracyjne i jednostkowe bez zmian — muszą przechodzić w całości.

---

## 13. Scenariusz finałowy — „miesiąc właściciela"

Wykonywany po etapie 5 na czystej bazie, przez UI, bez SQL, jako E2E `e2e/hr-payroll-owner-month.spec.ts` oraz raz ręcznie przez właściciela. Dane syntetyczne.

1. ADMIN zakłada trzy karty: osoba na UoP ze stałą pensją, członek zarządu, osoba na umowie zleceniu ze stawką godzinową; oraz jednego wykonawcę B2B z kontem INSTALATOR.
2. Wykonawca jest widoczny tylko na zakładce „Wykonawcy", w Montażach i w Użytkownikach.
3. ADMIN ustawia angaże i zatwierdza miesiąc M−1 z arkusza, wpisując kwoty ręcznie; ustawia numer listy płac.
4. ADMIN włącza automat. Test uruchamia przebieg za miesiąc M skryptem na izolowanej bazie E2E (jak w etapie 2, bez trasy HTTP).
5. Dwie osoby ze stałą pensją mają rozliczenie „Zatwierdzone automatycznie"; ADMIN ma powiadomienie; pracownik widzi pasek za miesiąc M.
6. ADMIN wpisuje godziny osoby na zleceniu do końca miesiąca, klika „Zatwierdź godziny", sprawdza wyliczone brutto, zatwierdza wiersz.
7. ADMIN zatwierdza zwolnienie chorobowe osoby na UoP w miesiącu M; jej wiersz dostaje etykietę zmiany; ADMIN poprawia kwotę w wierszu — powstaje v2.
8. Wynik firmy za miesiąc M zawiera koszt pracodawcy trzech osób, każdej raz; wykonawcy w nim nie ma.
9. Restart aplikacji — wszystkie powyższe stany bez zmian.
10. MANAGER, EMPLOYEE i INSTALLER nie widzą żadnej kwoty i dostają 403 z każdej trasy płacowej.

Suma zielonych etapów nie zastępuje tego scenariusza.

---

## 14. Kolejność, gałęzie, wdrożenie

```
Etap 1 ──► Etap 2 ──► Etap 3 ──► Etap 5 ──► Scenariusz finałowy
   └─────► Etap 4 (równolegle z 2 i 3)
```

- Każdy etap: gałąź od aktualnego `main`, PR, przegląd, akceptacja właściciela, wdrożenie. Następny etap startuje po scaleniu poprzedniego.
- Migracje: etap 1 (`PayrollMonth`), etap 2 (`origin` + odtworzenie triggera). Etapy 3–5 bez migracji. Na produkcji migracje stosuje `docker-entrypoint.sh` (kopia zapasowa bazy, potem `migrate deploy`).
- Po wdrożeniu etapu 2 właściciel sam włącza automat w ustawieniach płac.
- Zgłoszenia GitHub: etap 1 → #42, etap 2 → #43, etap 3 → #44, etap 4 → #45, etap 5 i scenariusz finałowy → #46. Etykietę `ready-for-agent` ma zgłoszenie, którego zależności są już scalone (na start tylko #42); kolejnym nadaje się ją po scaleniu poprzedników.

Polecenie startowe dla agenta:

> Przeczytaj `docs/plans/2026-11-24-payroll-ux-simplification.md`: sekcje 1–7 w całości oraz sekcję etapu N. Zrealizuj wyłącznie etap N. Decyzje z sekcji 2 i niezmienniki z sekcji 5 są zamknięte — jeśli któryś uniemożliwia zadanie, zatrzymaj się i opisz problem. Zakończ raportem z sekcją DOWÓD według sekcji 7. Nie rób commita ani pusha bez pytania.

---

## 15. Ryzyka i sprawy do obserwacji

| Ryzyko | Jak plan je ogranicza | Co zostaje |
|---|---|---|
| Automat zatwierdza z góry, więc pasek pracownika i koszt pokazują kwotę skopiowaną, zanim przyjdzie lista płac (D1, D7 — świadoma decyzja). | Reguły D8, etykieta zmiany, powiadomienia, korekta jednym kliknięciem. | Zmiana, której aplikacja nie zna (np. ustna podwyżka bez zmiany angażu), wymaga ręcznej korekty. |
| Harmonogram działa w procesie aplikacji; przestój 1. dnia opóźnia przebieg. | Nadrabianie przy pierwszym sprawdzeniu po starcie; wynik ostatniego przebiegu widoczny w ustawieniach. | — |
| Wyliczenie godzinowe zależy od tego, czy ADMIN wpisał i zatwierdził godziny. | Licznik „czeka", przycisk w wierszu, przypomnienie przed wypłatą, ostrzeżenie przy braku godzin. | Godziny wpisane z wyprzedzeniem są traktowane jako wykonane (D16). |
| Filtr wykonawców przeoczony w którymś zapytaniu HR albo ukrywający karty bez rodzaju umowy. | Wspólna stała `STAFF_WHERE`, test macierzy widoczności, wymóg uzasadnienia każdego trafienia wyszukiwania. | Nowe ekrany HR muszą pamiętać o filtrze — dopisać do `CLAUDE.md` po etapie 4. |
| Reguła „B2B = wykonawca" przestanie pasować, gdy firma zatrudni pracownika na B2B. | Reguła w jednym module; zamiana na osobne pole to zmiana w jednym miejscu plus migracja. | Decyzja właściciela w przyszłości. |
| Nieaktualna instrukcja o `db push` w `CLAUDE.md`. | Niezmiennik 8. | Poprawić `CLAUDE.md` przy okazji etapu 1. |
