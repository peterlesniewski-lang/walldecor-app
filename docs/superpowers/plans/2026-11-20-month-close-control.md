# Kontrola zamknięcia miesiąca z Subiekta GT — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** W wykonaniu „Zamknięcie miesiąca” administrator jednym kliknięciem widzi sumy kontrolne z Subiektu GT (rejestry VAT FV i PA, WZ/PZ, kasy, korekty do wcześniejszych miesięcy, faktury bez fiskalizacji) per magazyn, porównuje je z wydrukami dla księgowej i widzi, co zmieniło się w Subiekcie od poprzedniego sprawdzenia.

**Architecture:** Mostek `walldecor-bridge` (tylko odczyt) dostaje narzędzie `month_close_control` — realizuje Codex na SERWER według `docs/PLAN-MONTH-CLOSE-2026-11-20.md` w prywatnym repo mostka (tam też dane akceptacyjne z prawdziwych wydruków). Aplikacja pobiera wynik dla okresu wykonania, zapisuje migawkę (audyt i wykrywanie późnych zmian) i pokazuje panel w szczególe wykonania. Wydruki i wysyłka do księgowej pozostają ręczne (faza 2: Sfera).

**Tech Stack:** Next.js 16, React 19, Prisma 5/SQLite (`@/generated/prisma`), Zod 4, Vitest, Playwright.

> Repo `walldecor-app` jest **publiczne**: w kodzie, testach i dokumentach tylko dane syntetyczne — żadnych prawdziwych sum, nazw kontrahentów ani numerów dokumentów z Subiektu.

---

## Zasady i granice

- Faza 1 bez Sfery: aplikacja **nie generuje** wydruków, rejestrów, JPK ani paczki na Drive. Pokazuje sumy kontrolne do porównania.
- Panel nie odhacza zadań listy. Status zadań zmienia wyłącznie człowiek.
- Tylko ADMIN widzi panel i wywołuje endpointy (dane finansowe); MANAGER/EMPLOYEE widzą wykonanie jak dotąd.
- Kontrakt JSON mostka (sekcja „Kontrakt REST” w pliku przekazania) jest jedynym punktem styku; testy używają syntetycznych odpowiedzi zgodnych z nim.
- Token aplikacji musi mieć dodatkowo `finance:read` (zmiana w Coolify po wdrożeniu mostka 0.3.0).
- Żaden widoczny element nie jest atrapą. Commit/push po potwierdzeniu użytkownika.

## Kontrakt (skrót — pełny w repo mostka)

`GET /api/month-close/control?year=RRRR&month=M` → `{ year, month, warehouses[], cash_registers[], warnings[], summary }`.
Per magazyn: `vat_register_invoices { documents, gross, vat, zero_value_documents, corrections { documents, gross, vat }, corrections_to_earlier_periods[] { number, issued_at, corrected_number, corrected_issued_at, gross } }`, `vat_register_receipts { documents, gross, vat, returns { documents, gross, vat } }`, `unfiscalized_invoices { documents, gross }`, `goods_issued` i `goods_received { documents, net, vat, gross, cost }`. Kasy: `{ symbol, name, opening, receipts, payments, closing, receipt_documents, payment_documents }`.

## Mapa plików

| Plik | Odpowiedzialność |
|---|---|
| `src/lib/finance/subiekt-bridge-client.ts` (mod) | `monthCloseControlSchema`, `fetchMonthCloseControl` |
| `src/lib/operations/month-close-control.ts` (nowy, czysty) | etykiety magazynów (mapa `SUBIEKT_WAREHOUSE_MAP`), hash migawki, porównanie z poprzednią migawką, kontrole spójności |
| `src/lib/operations/month-close-control-service.ts` (nowy) | pobranie, zapis migawki, odczyt ostatniej, widok |
| `prisma/schema.prisma` + migracja (nowy model) | `MonthCloseControlSnapshot` |
| `src/app/api/operations/runs/[id]/month-close-control/route.ts` (nowy) | `POST` — sprawdź teraz (ADMIN) |
| `src/components/operations/month-close-control-panel.tsx` (nowy) | panel w szczególe wykonania |
| `src/app/(dashboard)/operations/runs/[id]/page.tsx` (mod) | osadzenie panelu (ADMIN, miesiąc ustawiony, mostek skonfigurowany) |
| testy w `__tests__/unit/operations/`, `__tests__/integration/operations/`, `__tests__/unit/finance/` | patrz zadania |

---

### Task C1: Klient mostka — `fetchMonthCloseControl`

**Files:** `src/lib/finance/subiekt-bridge-client.ts`, `__tests__/unit/finance/subiekt-bridge-client.test.ts`

- [ ] **Testy (czerwone):** poprawna odpowiedź → sparsowane dane i URL `…/api/month-close/control?year=2026&month=9`; liczby jako stringi (DECIMAL) akceptowane jak w `salesSummarySchema`; brak pola / zły typ → `invalid_response`; 403 → `unauthorized`; `month` poza 1–12 → `bridge_error` bez wywołania fetch.
- [ ] **Implementacja:** schema Zod zgodna z kontraktem (kwoty przez istniejące `amount`, liczniki przez `count`, daty `DATE_RE`, `warnings: z.array(z.string())`); `fetchMonthCloseControl(config, { year, month }, fetchImpl?, timeoutMs?)` przez istniejące `bridgeGetJson` + `parseOrThrow`. Komunikat `unauthorized` rozszerzyć o zakres `finance:read`.
- [ ] **Spójność wewnętrzna (w kliencie, jak kontrola sum w `fetchSalesSummary`):** dla każdej kasy `opening + receipts − payments = closing` z tolerancją 1 gr; niespełnione → `invalid_response` z kodem `CASH_MISMATCH` (nie zapisujemy niespójnych danych).
- [ ] Run: `npx vitest run __tests__/unit/finance/subiekt-bridge-client.test.ts` → PASS. Commit `feat(operations): bridge client for month close control`.

### Task C2: Czyste funkcje kontroli

**Files:** `src/lib/operations/month-close-control.ts`, `__tests__/unit/operations/month-close-control.test.ts`

Funkcje (bez I/O):
- `warehouseLabel(symbol, map)` — `MAG` → „MAG · Jagiellońska (JAG)”, `PUŁ` → „PUŁ · Puławska (PUL)”, `INT` → „INT · e-commerce (PUL)”, nieznany → sam symbol + ostrzeżenie. Mapa z `parseWarehouseMap` (`src/lib/finance/subiekt-revenue.ts`) — nie duplikować mapowania.
- `snapshotHash(control)` — SHA-256 kanonicznego JSON (posortowane klucze, magazyny i kasy po symbolu), bez `summary`.
- `diffControls(previous, current)` → lista zmian `{ path: 'MAG.vat_register_invoices.gross', label: 'Rejestr VAT FV · brutto', before, after }` dla wszystkich liczb; nowe/zniknięte magazyny i kasy; nowe/zniknięte korekty do wcześniejszych okresów (po numerze).
- `consistencyNotes(control)` — informacje dla człowieka, nie błędy: liczba pozycji 0,00 w rejestrze FV, korekty do wcześniejszych okresów, faktury bez fiskalizacji > 0. Tylko z pól kontraktu — żadnych reguł, których mostek nie dostarcza.

- [ ] **Testy (czerwone), po jednym przypadku:** etykiety trzech magazynów i nieznanego; hash niezależny od kolejności magazynów; hash zmienia się przy zmianie grosza; diff wykrywa zmianę kwoty, nową korektę, zniknięcie kasy; brak zmian → pusta lista; przełom roku (grudzień → styczeń nie miesza okresów — diff porównuje tylko migawki tego samego okresu, egzekwuje to serwis, test w C3); kwoty ujemne (korekty) i zero.
- [ ] **Implementacja**, run, commit `feat(operations): month close control comparison`.

### Task C3: Migawki i serwis

**Files:** `prisma/schema.prisma`, `prisma/migrations/<timestamp>_month_close_control_snapshot/migration.sql`, `src/lib/operations/month-close-control-service.ts`, `__tests__/integration/operations/month-close-control.test.ts`

Model (addytywny, bez zmian istniejących tabel):

```prisma
model MonthCloseControlSnapshot {
  id           String   @id @default(cuid())
  periodYear   Int
  periodMonth  Int
  payloadJson  String
  payloadHash  String
  fetchedAt    DateTime @default(now())
  fetchedById  String
  fetchedBy    User     @relation(fields: [fetchedById], references: [id], onDelete: Restrict)

  @@index([periodYear, periodMonth, fetchedAt])
}
```

(dopisać relację odwrotną w `User`; migrację wygenerować `prisma migrate dev --create-only`, sprawdzić SQL, opisać w `architecture.md`.)

Serwis:
- `checkMonthCloseControl(db, { runId, actorId, fetchImpl?, env? })`: wykonanie musi istnieć i mieć `periodMonth` (inaczej błąd `NO_PERIOD`); pobiera kontrolę dla `periodYear/periodMonth`; zapisuje migawkę **tylko gdy hash różni się od ostatniej** dla okresu (inaczej aktualizuje nic i zwraca „bez zmian od <data>”); zwraca `{ control, previousFetchedAt, changes, notes, unchangedSince }`. Błąd mostka → `{ ok:false, kind, error }`, nic nie zapisuje.
- `loadLatestMonthCloseControl(db, year, month)` — ostatnia migawka + zmiany względem przedostatniej (do pokazania po odświeżeniu strony bez odpytywania mostka).
- Migawki są per okres, nie per wykonanie (ponowne „Otwórz/Zamknij” albo nowe wykonanie tego samego miesiąca widzi tę samą historię).

- [ ] **Testy integracyjne (czerwone)** na świeżej bazie z łańcucha migracji (wzór: `__tests__/integration/finance/subiekt-purchases.test.ts`): pierwsze sprawdzenie zapisuje migawkę; drugie identyczne — brak nowej migawki, `unchangedSince`; zmiana kwoty — nowa migawka i lista zmian; wykonanie bez miesiąca → `NO_PERIOD`; mostek niedostępny → nic nie zapisane; migawka grudnia nie jest porównywana ze styczniem.
- [ ] **Implementacja**, run, commit `feat(operations): store month close control snapshots`.

### Task C4: Endpoint

**Files:** `src/app/api/operations/runs/[id]/month-close-control/route.ts`, testy w pliku integracyjnym z C3

- `POST` — `requireFinanceAdmin()`; `params: Promise<{ id: string }>` + `await params` (Next.js 16); wywołuje `checkMonthCloseControl`. Statusy: brak sesji 401, nie-ADMIN 403, brak wykonania 404, `NO_PERIOD` 409, mostek nieskonfigurowany 409, odrzucony token 502, pozostałe błędy mostka 503 — komunikaty po polsku, bez szczegółów technicznych.
- [ ] Testy: ADMIN 200 z danymi; MANAGER 403; nieistniejące wykonanie 404; wykonanie bez miesiąca 409; mostek nieskonfigurowany 409. Commit `feat(operations): month close control endpoint`.

### Task C5: Panel w szczególe wykonania

**Files:** `src/components/operations/month-close-control-panel.tsx` (`'use client'`), `src/app/(dashboard)/operations/runs/[id]/page.tsx`, `__tests__/unit/operations/month-close-control-panel.test.tsx`

- Strona (Server Component) renderuje panel tylko gdy: rola ADMIN, `periodMonth` ustawiony, `readSubiektBridgeConfig()` ≠ null. Ostatnią migawkę czyta z bazy (`loadLatestMonthCloseControl`) i przekazuje jako props — bez odpytywania mostka przy wejściu na stronę.
- Panel „Kontrola z Subiektu GT — <miesiąc rok>”:
  - przycisk „Sprawdź w Subiekcie” (stan ładowania, błąd w `role="alert"`), linijka „Sprawdzono <data godzina>” / „Bez zmian od <data>”;
  - per magazyn (etykieta z C2) karty: **Rejestr VAT FV** (pozycje, w tym 0,00; brutto; VAT; korekty), **Rejestr VAT PA** (pozycje, brutto, VAT, zwroty), **WZ** i **PZ** (dokumenty, netto, VAT, brutto, koszt), **Bez fiskalizacji** (liczba, brutto — wyróżnione gdy > 0);
  - **Kasy**: stan początkowy, KP, KW, stan końcowy;
  - **Korekty do wcześniejszych miesięcy**: tabela numer / data / dokument korygowany / data / brutto;
  - **Zmiany od poprzedniego sprawdzenia** (gdy są): lista `label: przed → po`, wyróżniona; gdy wykonanie jest zamknięte — nagłówek „Subiekt zmienił się po zamknięciu miesiąca”;
  - `warnings` z mostka i `notes` z C2 jako lista informacji;
  - podpowiedź: „Porównaj liczby z wydrukami rejestrów i raportów przed wysłaniem paczki do księgowej.”
- Wygląd spójny z istniejącym widokiem wykonania (`run-detail-client.tsx`, komponenty `src/components/operations/*`), kwoty w formacie PLN jak w panelach Subiekta (`subiekt-purchases-panel.tsx`); bez nowych fontów i palet.
- [ ] Testy (czerwone): render migawki z props; klik → POST na `/api/operations/runs/<id>/month-close-control` i nowe dane; błąd → alert; zmiany po zamknięciu → nagłówek ostrzeżenia; korekty do wcześniejszych miesięcy w tabeli; brak migawki → tylko przycisk i tekst „Jeszcze nie sprawdzano”. Plus test strony: MANAGER nie widzi panelu, wykonanie bez miesiąca nie ma panelu.
- [ ] Commit `feat(operations): month close control panel`.

### Task C6: Weryfikacja i dokumentacja

- [ ] `npx vitest run` (znane, niezwiązane porażki: 11 w `ksef-sync.test.ts`; niestabilny `codex-runner.test.ts`), `npx tsc --noEmit` dla `src/`, `npm run build`.
- [ ] Po wdrożeniu mostka 0.3.0 i podmianie tokenu (`finance:read`): na produkcji „Sprawdź w Subiekcie” dla wykonania wrzesień 2026 → liczby zgodne z wydrukami z folderu `09` (porównuje właściciel; dowód tylko w prywatnym repo mostka).
- [ ] `project_status.md`, `architecture.md` (nowy model), `.env.example` (zakres tokenu), pamięć projektu.

## Kolejność i zależności

1. Mostek M1 (sonda) i M2 (narzędzie) — Codex na SERWER. Równolegle C1–C5 w aplikacji na syntetycznych danych.
2. Mostek M3 (zgodność z wydrukami) przed wdrożeniem aplikacji.
3. Wdrożenie mostka 0.3.0 → token z `finance:read` w Coolify → wdrożenie aplikacji → C6.

## Poza zakresem (faza 2)

Wydruki FS/KFS i zestawień przez Sferę, automatyczna paczka na Drive, JPK_FA, wysyłka do księgowej, Portal Archi.
