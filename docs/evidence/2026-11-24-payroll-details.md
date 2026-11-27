# Etap 5 (#46) — strona szczegółów rozliczenia i scenariusz finałowy „miesiąc właściciela"

Gałąź `payroll-details-46`, bez commita. Dane wyłącznie syntetyczne. Plan: `docs/plans/2026-11-24-payroll-ux-simplification.md` §12, §13.

## Co zbudowano

- `src/components/hr/payroll/payroll-settlement-view.tsx` — nowy układ: nagłówek z trzema kwotami, blokady/ostrzeżenia, „Kwoty i zatwierdzenie" (brutto, netto, koszt pracodawcy wstępnie wypełnione podpowiedzią arkusza; „Zapisz i zatwierdź" albo — dla zatwierdzonego — wymagany „Powód korekty" i „Zapisz korektę"), „Nadgodziny z kalendarza", „Premie i korekty", „Składniki do kadrowej", trzy natywne `<details>` („Koszt pracodawcy i podział", „Wersje", „Historia zmian") z prawdziwymi liczbami w `<summary>`. Pasek pięciu etapów i „rewizja N" usunięte.
- `src/app/api/hr/payroll/settlements/[id]/settle/route.ts` (nowa, POST, tylko ADMIN) — wywołuje `settleEmployeeMonth`, czyli tę samą ścieżkę co wiersz arkusza. Korekta zatwierdzonego bez powodu → 400 z komunikatem przy polu.
- `src/app/api/hr/payroll/settlements/[id]/detail-response.ts` (nowy) — dane strony: szczegół + miesiąc, numer listy płac z `PayrollMonth`, podpowiedź/godziny/znaczniki wiersza arkusza (przez `getPayrollSheet`, bez nowej logiki). GET i PATCH `[id]` zwracają te dane.
- `src/lib/validations/payroll.ts` — `PayrollSettlementSettleSchema`.
- `employer-cost-panel.tsx` — tylko treść panelu (nagłówek `<details>` w widoku), `describeSplit`.
- `payroll.module.css` — usunięte `.rail`, `.step*`, `.grid2`; dodane style panelu kwot i zwijanych paneli. `.stack` zostaje (używa go panel automatu).
- Numer listy płac: na stronie szczegółów tylko do odczytu („Lista płac: X · zmień na arkuszu miesiąca"). Pole „Numer listy płac / notatka" przy rozliczeniu usunięte. **Istniejące notatki:** kolumna `payrollOfficeReference` zostaje w bazie (nic nie jest kasowane); w szkicu z taką notatką widać podpowiedź „Wcześniejsza notatka przy tym rozliczeniu: „…" — zostanie zastąpiona numerem listy płac miesiąca przy zatwierdzeniu"; poprzednie wersje i historia pokazują ją dalej.
- Testy: `__tests__/integration/hr/payroll-settle-detail.test.ts` (10), `e2e/hr-payroll-details.spec.ts` (8), `e2e/hr-payroll-owner-month.spec.ts` (10 kroków), zaktualizowane `e2e/hr-payroll.spec.ts`, `e2e/hr-payroll-automation.spec.ts`, `e2e/hr-payroll-hourly.spec.ts` (rozwinięcie zwiniętych paneli przed asercjami o wersjach/historii; asercje nie osłabione).

## Odstępstwo w `src/lib/payroll/**` (jedna, minimalna zmiana)

`src/lib/payroll/service.ts`: `SettleEmployeeMonthInput` dostał opcjonalne `correctionReason`; krok otwarcia korekty używa go zamiast stałej `SHEET_CORRECTION_REASON`. Domyślne zachowanie arkusza bez zmian. Powód: „Zapisz korektę" ma być atomowe i zapisywać powód wpisany przez właściciela w tym samym zdarzeniu `settlement.reopen`.

## DOWÓD

### Bramka (kolejność z polecenia)

| # | Polecenie | Wynik |
|---|---|---|
| 1 | `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` | exit 1: `Tests 4 failed \| 4325 passed \| 2 skipped`, `Test Files 1 failed \| 314 passed` — 4 porażki to dokładnie `__tests__/unit/invoice-import/document-processor.test.ts` (brak Poppler), baseline; 4315 + 10 nowych = 4325 |
| 2 | `npm run typecheck:app` | exit 0 |
| 3 | `npx eslint` na wszystkich zmienionych/dodanych `.ts`/`.tsx` (specyfikacje, trasy, widoki, `service.ts`, `payroll.ts`) | exit 0, bez ostrzeżeń |
| 4 | `npm run build` | exit 0 |
| 5 | `npx playwright test e2e/hr-payroll.spec.ts e2e/hr-payroll-sheet.spec.ts e2e/hr-payroll-automation.spec.ts e2e/hr-payroll-hourly.spec.ts e2e/hr-payroll-owner-month.spec.ts e2e/hr-payroll-details.spec.ts` | exit 0, `42 passed (2.4m)` |
| 5b | `npx playwright test e2e/hr-contractors.spec.ts` | exit 0, `10 passed` |

Uwaga do 5: uruchomione razem z `e2e/hr-contractors.spec.ts` w jednym przebiegu Playwright (alfabetycznie kontraktorzy idą pierwsi) dwa testy innych specyfikacji padają z przyczyny kolejności danych, nie układu strony: spec kontraktorów zakłada na wspólnej bazie pięć kart UoP (`e2e-ctr-*`, start 2026-01-01, bez końca zatrudnienia), więc trafiają do arkuszy maja i września — `hr-payroll-automation` (lista „wymaga uwagi" w maju zawiera `e2e-ctr-*`) i `hr-payroll-sheet` (kolejność pól przy wpisie z klawiatury we wrześniu). Szczegółowo w sekcji „Defekty". Poprawki układu strony dotknęły trzech innych specyfikacji (rozwinięcie zwiniętych paneli) i te przechodzą.

Zdjęcia: tylko `docs/evidence/2026-11-24-payroll-details/` jest nowy. Zmienione celowo starsze zrzuty strony szczegółów (zmienił się układ): `docs/evidence/payroll-2026-09-22/` (5 plików), `docs/evidence/2026-11-24-payroll-automation/04-detail-automat.png`, `…/06-change-again-detail.png`, `docs/evidence/2026-11-24-payroll-hourly/05-detail-hourly.png`. Pozostałe zrzuty z uruchomień przywrócone `git checkout`.

### Definition of Done (§12)

| Punkt | Dowód |
|---|---|
| Szkic 1280×800: brutto, netto, „Zapisz i zatwierdź" bez przewijania, z podpowiedzią | `e2e/hr-payroll-details.spec.ts` „shows amounts and "Zapisz i zatwierdź" on the first screen at 1280×800…" (bounding boxy, brak nakładania na przycisk asystenta); `01-draft-1280x800.png` |
| „Zapisz i zatwierdź": wersja, zdarzenia, ta sama kwota na arkuszu | `e2e/hr-payroll.spec.ts` „sets base, pulls calendar hours…"; `__tests__/integration/hr/payroll-settle-detail.test.ts` (te same akcje audytu co wiersz arkusza, te same zapisane kwoty); `details.spec` „leaves the same audit actions as a sheet row…" |
| Premia/korekta/usunięcie, nadgodziny, kalendarz, zwolnienie, podział | `e2e/hr-payroll.spec.ts` (premia, korekta, nadgodziny, kalendarz); `details.spec` „opens „Koszt pracodawcy i podział" itself … and lets the owner set it" (zwolnienie ze składek i podział) |
| Korekta zatwierdzonego z powodem → v2, v1 zastąpiona | `details.spec` „shows the effective amounts of an approved settlement, demands a reason, and a correction makes v2"; integracyjny test (powód w `settlement.reopen`, v1 superseded); `02-approved-correction-1280.png` |
| „Wersje" i „Historia zmian" zwinięte, klik i klawiatura, prawdziwe liczby | `details.spec` „folds Wersje and Historia zmian with real numbers; they open by click and by keyboard"; `03-folded-panels.png`, `04-unfolded-panels.png` |
| Numer listy płac = numer miesiąca z arkusza, zmienia się po zmianie na arkuszu | `details.spec` „shows the month list number read-only and follows the number typed on the sheet"; `e2e/hr-payroll.spec.ts` |
| 390 px bez przewijania poziomego | `details.spec` „fits a 390 px phone without horizontal scroll, folded and unfolded, draft and approved"; `06-draft-390.png`, `06-approved-390.png` |
| Panel kosztu otwiera się sam bez podziału | `details.spec` (ten sam test co wyżej); `05-split-missing-open.png` |
| Osoba na stawce godzinowej: podpowiedź z godzin, bez przycisków wypłata/czas wolny | `details.spec` „shows the hours-based suggestion and its hint for an hourly person, without payout buttons" |
| Nic klikalnego pod przyciskiem asystenta (1280×800 i 390 px) | `details.spec` test układu i test 390 px (`actionableUnder`) |
| Integracyjne i jednostkowe bez zmian | bramka 1: tylko baseline 4 × Poppler |

### Scenariusz finałowy (§13) — `e2e/hr-payroll-owner-month.spec.ts`, 10 testów, `10 passed`

Miesiące stałe: M−1 = czerwiec 2026, M = lipiec 2026 (żadna inna specyfikacja ich nie rozlicza; osoby zatrudnione 2026-06-01…2026-07-31). Wszystko przez UI. Poza UI wyłącznie: przebieg automatu skryptem `e2e/payroll-automation-run.ts run 2026-07` i restart aplikacji (plik `restart-request`).

| Krok | Test | Co udowadnia |
|---|---|---|
| 1 | `step 1 — ADMIN creates three cards and a B2B contractor with an INSTALLER account` | karty UoP, Zarząd, UZ, wykonawca B2B przez formularze; konta (INSTALLER powiązany z wykonawcą) przez Użytkowników; zrzut `owner-month-01-accounts.png` |
| 2 | `step 2 — the contractor is only on "Wykonawcy", in Montaże and in Użytkownicy` | brak na liście pracowników i na arkuszu, jest w „Wykonawcy", w wyborze opiekuna montażu, w Użytkownikach |
| 3 | `step 3 — ADMIN sets the engagements, types June by hand…` | angaże przez „Angaż…", kwoty ręcznie, „Zatwierdź zaznaczone (3)", numer listy płac zapisany i widoczny po odświeżeniu; `owner-month-03-june-approved.png` |
| 4 | `step 4 — ADMIN switches the automat on…` | przełącznik w „Ustawienia płac", potem skrypt; zatwierdzeni dokładnie UoP i Zarząd |
| 5 | `step 5 — two salaried people are "Zatwierdzone automatycznie"…` | etykieta „Zatwierdzone automatycznie · v1", powiadomienie „Wynagrodzenia za lipiec: 2 zatwierdzone automatycznie…", pasek pracownika za lipiec (konto EMPLOYEE po wymuszonej zmianie hasła) |
| 6 | `step 6 — ADMIN enters the hourly person's hours…` | godziny w Czas pracy, „Zatwierdź godziny", brutto 1300,00 = 26 h × 50,00 zł, koszt 1533,09, zatwierdzenie wiersza |
| 7 | `step 7 — sick leave approved in July labels the row…` | typ SL dodany przez ekran typów (baza go nie miała), wniosek i zatwierdzenie przez UI, etykieta „zmiana po zatwierdzeniu" z „nieobecność", korekta w wierszu → v2 (v1 `AUTO_CARRYOVER` zastąpiona, v2 `MANUAL`) |
| 8 | `step 8 — the company result for July counts the three people once and no contractor` | Break-even: przyrost „w tym koszt pracodawcy" dla PUL = 7831,20 + 8000,00 + 1533,09 (policzone w teście ze stawek 20,48% / 0% / 17,93%), JAG bez zmiany, brak nazwiska wykonawcy |
| 9 | `step 9 — after an application restart every state above is unchanged` | prawdziwy restart; czerwiec v1 i numer listy, lipiec v2/auto v1/godzinowa v1, automat włączony, powiadomienie, wynik firmy, pasek pracownika z 6500,00 |
| 10 | `step 10 — MANAGER, EMPLOYEE and INSTALLER see no amount and get 403 from every payroll route` | wyliczenie `route.ts` pod `src/app/api/hr/payroll/**` (15 plików, każda metoda), 403 dla trzech ról; strony arkusza, szczegółów, stawek, break-even przekierowują i nie pokazują żadnej kwoty scenariusza |

Brak UI: **centra kosztów JAG/PUL** (żaden ekran ich nie tworzy) — jedyny seed (`upsert` w `beforeAll`). Poza tym nic nie jest zasiewane.

### Audyt 6 punktów (§7)

1. Klik wszystkich elementów zmienionych ekranów: szczegóły — test układu i testy paneli klikają kwoty, zapis, korektę, zwijane panele (mysz i klawiatura), kosztu/podziału, linku do arkusza; arkusz i dialog angażu — scenariusz finałowy. Nie klikano: kolejnych wariantów każdego przycisku nadgodzin poza `hr-payroll.spec.ts`.
2. Każdy utworzony rekord da się zmienić z UI: rozliczenie (korekta v2), numer listy (arkusz), podział/zwolnienia (panel), godziny, angaż (cofnięcie w dialogu — istniejące).
3. Po restarcie dane przetrwały: `hr-payroll.spec.ts` „re-reads … after a real server restart", krok 9.
4. Czysta baza bez SQL: scenariusz finałowy (jedyny seed: centra kosztów).
5. Druga rola: 403/przekierowanie — krok 10, integracyjny test trasy `settle` (MANAGER 403, EMPLOYEE 403, bez sesji 401).
6. Zmiana w bazie zmienia ekran: test „list number follows the sheet", krok 5/7 (kwoty z bazy), `e2e` godzin.

## Defekty z wcześniejszych etapów

1. **Kolejność specyfikacji (etap 4, #45)**: `e2e/hr-contractors.spec.ts` zakłada na wspólnej bazie karty UoP z `startDate` 2026-01-01 bez końca zatrudnienia i ich nie sprząta. Uruchomione przed specyfikacjami płac psują im dane: `hr-payroll-automation.spec.ts:165` (lista „wymaga uwagi" w maju zawiera `e2e-ctr-blank`, `e2e-ctr-manager`, `e2e-ctr-staff-b`, `e2e-ctr-staff`) i `hr-payroll-sheet.spec.ts:126` (Tab przeskakuje po dodatkowych wierszach). Nie naprawiałem — to nie jest zakres etapu 5; osobne uruchomienia obu zestawów przechodzą (42 + 10). Naprawa: nadać kartom z `hr-contractors` `endDate` albo sprzątać je w `afterAll`.
2. Etap 4/„Wykonawcy": brak — wykonawca nie wchodzi na arkusz ani do kosztu firmy (kroki 2 i 8).

## Przegląd przed scaleniem i poprawki z przeglądu

Niezależny przegląd orkiestratora (27.11.2026) na tej samej gałęzi, po raporcie agenta.

### Co sprawdziłem sam

- **Trasa `POST /api/hr/payroll/settlements/[id]/settle`:** `requirePayrollAdmin`, nagłówki `PAYROLL_NO_STORE`, schemat Zod `.strict()`, a zapis wyłącznie przez `settleEmployeeMonth` z `expectedRevision` — ta sama transakcja i ten sam ślad audytu co wiersz arkusza. Wyścig między odczytem statusu a zapisem zatrzymuje kontrola rewizji.
- **Odstępstwo w `src/lib/payroll/service.ts`** (opcjonalne `correctionReason`): dwie linie, arkusz bez tego pola zachowuje się jak dotąd. Przyjęte — bez niego powód korekty nie trafiłby do zdarzenia `settlement.reopen` w tej samej transakcji.
- **Dane strony** (`detail-response.ts`): podpowiedź, wyliczenie godzin i znaczniki pochodzą z `getPayrollSheet`, czyli z tej samej funkcji co arkusz; komponent niczego nie liczy sam.
- **Zmienione starsze testy E2E:** asercje przeniesione do nowego układu, nie osłabione. Jedna usunięta asercja („Kadrowa potwierdziła" na karcie) dotyczyła osobnego kroku potwierdzenia, którego już nie ma; zastąpiły ją asercje o zdarzeniach „Zapisano dane od kadrowej" i „Zatwierdzono wersję" w historii.
- **Style:** skrypt porównał klasy z `payroll.module.css` z użyciami w komponentach — brak osieroconych i brak niezdefiniowanych.
- Obejrzałem zrzuty: szkic 1280×800, korekta zatwierdzonego, 390 px i arkusz lipca po korekcie ze scenariusza finałowego.

### Poprawki naniesione po przeglądzie

1. **Zerwane połączenie przy zapisie** nie zostawia już wyłączonych przycisków do przeładowania strony: „Zapisz i zatwierdź", „Zapisz korektę" i pozostałe akcje pokazują „Błąd połączenia — nic nie zapisano" i odblokowują formularz.
2. **Defekt kolejności z punktu wyżej naprawiony:** `e2e/hr-contractors.spec.ts` w `afterAll` przenosi zatrudnienie swoich kart na grudzień 2024 i je dezaktywuje, więc nie trafiają na arkusze i listy innych specyfikacji tego samego przebiegu.

### Bramka po poprawkach (przebieg orkiestratora)

| # | Polecenie | Wynik |
|---|---|---|
| 1 | `npm test -- --maxWorkers=2 --hookTimeout=60000 --testTimeout=60000 --exclude __tests__/unit/finance/ksef-sync.test.ts` | 4325 przeszło, 4 nie przeszły — te same 4 testy Popplera |
| 2 | `npm run typecheck:app` | exit 0 |
| 3 | `npx eslint <zmienione pliki .ts/.tsx>` | exit 0 |
| 4 | `npm run build` | exit 0 |
| 5 | `npx playwright test e2e/hr-contractors.spec.ts e2e/hr-time-tracking.spec.ts e2e/hr-payroll*.spec.ts` — **jeden przebieg, jedna baza** | 55 przeszło (10 wykonawcy, 3 czas pracy, 42 płace w tym 10 kroków „miesiąca właściciela" i 8 testów strony szczegółów) |

Przebieg 5 jest tym samym zestawem, w którym przed poprawką 2 padały dwa testy.

### Świadomie zostawione

- Ręczna próba „miesiąca właściciela" przez właściciela (plan §13) — po wdrożeniu.
- Testy montaży nie były uruchamiane w tym etapie (zmiana ich nie dotyka; stan po etapie 4: 8 z 9 plików zielonych, zgłoszenie #52).

