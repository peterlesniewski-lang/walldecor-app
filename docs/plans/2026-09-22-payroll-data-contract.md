# Rozliczenia wynagrodzeń — kontrakt danych dla kolejnych etapów

**Data:** 2026-09-22 · **Gałąź:** `monthly-salary-settlement` · **Kod kontraktu:** `src/lib/payroll/contracts.ts`

W tej gałęzi zbudowano wyłącznie ekran i operacje administratora. Dwa kolejne etapy — prywatny ekran
„Moje wynagrodzenia” i przekazanie kosztów do finansów / Break-even — mają czytać dane **tylko** przez
funkcje opisane poniżej. Nie czytają bezpośrednio tabel `PayrollSettlement*`.

## Model w skrócie

| Tabela | Rola |
|---|---|
| `PayrollBaseSalary` | Podstawa z datą `effectiveFrom` (`MONTHLY_GROSS` / `HOURLY_GROSS`). Tylko dopisywanie; pomyłkę się cofa (`revokedAt` + powód). |
| `PayrollSettlement` | Jedno rozliczenie na pracownika i miesiąc (`DRAFT` / `APPROVED`), `revision` chroni przed nadpisaniem przez dwie osoby naraz. |
| `PayrollOvertimeLine` | Kopia wpisów `TimeEntry` z nadgodzinami (status wpisu w chwili pobrania) i rozstrzygnięcie `PAYOUT` / `TIME_OFF`. |
| `PayrollAdjustment` | Premie (`BONUS` > 0) i korekty (`CORRECTION` ≠ 0), usuwane miękko. |
| `PayrollSettlementVersion` | **Niezmienna** wersja zatwierdzona: ostateczne brutto, netto, pełny koszt pracodawcy i pełny snapshot. |
| `PayrollAuditEvent` | Historia zmian (przed/po/powód/autor); tylko dopisywanie. |

Kwoty są w **groszach (`Int`)**, nie w `Float`.

## Niezmienniki gwarantowane przez bazę (migracja `20260922120000_hr_payroll_settlements`)

1. Dla danego pracownika i miesiąca obowiązuje (`supersededAt IS NULL`) **najwyżej jedna** wersja: indeks częściowy `PayrollSettlementVersion_effective_employee_month_key`.
2. Wersji zatwierdzonej nie można zmienić ani usunąć. Jedyną dopuszczalną zmianą jest jednorazowe oznaczenie jej jako zastąpionej.
3. Zatwierdzonego rozliczenia nie można edytować. Najpierw trzeba je otworzyć do korekty (`reopen`), a dopóki nowa wersja nie zostanie zatwierdzona, w kosztach liczy się wersja poprzednia.
4. Premii, korekt ani nadgodzin nie można zmienić, gdy rozliczenie nie jest robocze.
5. Historii zmian i rozliczeń nie można usuwać.
6. CHECK-i w bazie: netto ≤ brutto, kwoty dodatnie, poprawne statusy i rodzaje; potwierdzenie kadrowej wymaga wszystkich trzech kwot.

## 1. Finanse / Break-even — `getEffectivePayrollCosts(db, { year, month })`

Zwraca `PayrollCostRecord[]`, jeden rekord na pracownika z zatwierdzonym rozliczeniem w danym miesiącu:

```ts
{
  sourceKey: 'payroll:<employeeId>:<YYYY-MM>', // stały przy korektach
  versionId, versionNumber,
  employeeId, costCenterId,                    // centrum kosztów zapisane w chwili zatwierdzenia (JAG | PUL | GLOBAL)
  year, month,
  employerCostGrosze,                          // ← kwota do ujęcia jako koszt
  finalGrossGrosze,                            // tylko informacyjnie
  approvedAt,
}
```

**Zasady dla konsumenta (obowiązkowe):**
- Upsert po `sourceKey`, przechowuj `versionId`. Gdy przyjdzie nowy `versionId` dla tego samego `sourceKey`, kwotę **zastępujesz**, a nie dodajesz. Tak działa ochrona przed podwójnym ujęciem kosztu.
- Kosztem jest `employerCostGrosze` (pełny koszt pracodawcy od kadrowej). Nie sumuj go z `finalGrossGrosze`.
- Wersje robocze nie trafiają do kontraktu. Ponownie otwarte rozliczenie nadal zwraca poprzednią zatwierdzoną wersję, aż zostanie zatwierdzona nowa.
- Jeśli finanse mają zamknięte okresy (`FinancePeriodClose`), to one decydują, czy późniejsza wersja zmienia zamknięty miesiąc. Kontrakt zwraca zawsze stan bieżący.
- Otwarta decyzja właściciela: alokacja kosztu pracowników `GLOBAL` do salonów (spec: w MVP brak alokacji).

## 2. „Moje wynagrodzenia” — `getOwnPayrollStatements(db, session.user.employeeId)`

Zwraca `EmployeePayrollStatement[]` (tylko obowiązujące wersje, od najnowszej): miesiąc, wersja, data
zatwierdzenia, brutto, netto, podstawa, premie, korekty, godziny nadliczbowe do wypłaty / w czasie wolnym.

**Świadomie pominięte:** pełny koszt pracodawcy, numer listy płac kadrowej, notatki administratora i historia zmian.
Pokazanie kosztu pracodawcy pracownikowi to decyzja właściciela; kontrakt łatwo rozszerzyć.

**Zasady bezpieczeństwa (obowiązkowe):**
- `employeeId` bierzemy **wyłącznie** z sesji. Nigdy z parametru URL ani z body.
- Nowe API (np. `GET /api/me/payroll`) powinno mieć własną ścieżkę, poza `/api/hr/payroll/*`, która w proxy jest zablokowana dla ról innych niż ADMIN.
- Test obowiązkowy: pracownik B nie dostaje danych pracownika A (wzór: `e2e/hr-payroll.spec.ts`, test odmowy dostępu).

## API administratora (ta gałąź)

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET/POST | `/api/hr/payroll/base-salaries` | historia / nowa podstawa (`effectiveFrom`, `amount` "4321,00", `basis`) |
| POST | `/api/hr/payroll/base-salaries/[id]/revoke` | cofnięcie z powodem |
| GET/POST | `/api/hr/payroll/settlements` | lista miesiąca (`?month=YYYY-MM`) / utworzenie szkicu |
| GET | `/api/hr/payroll/settlements/[id]` | szczegóły + podsumowanie, blokady, wersje, historia |
| PATCH | `/api/hr/payroll/settlements/[id]` | akcje: `calendar.sync`, `overtime.resolve`, `adjustment.add/update/delete`, `payrollOffice.confirm`, `approve`, `reopen` — każda wymaga `expectedRevision` |

Wszystkie wymagają roli ADMIN (403 dla pozostałych; dodatkowo reguła w `src/proxy.ts`) i zwracają `Cache-Control: no-store, private`.
