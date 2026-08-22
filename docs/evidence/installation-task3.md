# Task 3 — formularz klienta montażu

Data: 2026-08-22

## Checkpoint projektu interfejsu

- Cel: spokojne, jednoekranowe przygotowanie całego zlecenia przez klienta bez konta i bez dashboardu.
- Kierunek: papier/plaster/sand/grafit z akcentem masking-tape; Bricolage Grotesque dla nagłówków, Spline Sans dla treści, liczby tabularne.
- Układ: mobile-first, jedna kolumna do 760 px, mapa zlecenia nad formularzem; brak sidebara i KPI.
- Interakcje: pytania są partiami po 2–4 gdy formularz ma ponad cztery pytania, przyciski Tak/Nie/Nie wiem mają co najmniej 48 px, fokus jest widoczny, stan autosave ma aria-live.
- Task 5: pytanie FILE ma tylko spokojny komunikat i marker `data-task5-replace="private-upload-handoff"` / `TASK5_FILE_UPLOAD_REPLACEMENT`; nie ma atrap uploadu.

## RED → GREEN

1. Link klienta: test dla 256-bitowego tokenu, SHA-256 i jednolitego 404 był RED przy braku modułu; GREEN: 8 testów.
2. Reguły formularza: widoczność warunkowa, `UNKNOWN`, canonical decimal i FILE bez blokowania były RED; GREEN: 5 testów.
3. Prawdziwa SQLite: link, autosave CAS/replay, submit, clarification, readiness i korekta były RED; GREEN: 3 testy. Dodano później regresję, że zmiana odpowiedzi sterującej usuwa ukrytą odpowiedź zależną.
4. Readiness/state transition: RED przy braku guardu `READY_TO_PLAN`; GREEN: 2 testy oraz sprawdzenie w integracji.
5. Public/internal routes oraz proxy: RED przy braku handlers/matchera; GREEN: 7 route testów, 3 internal-route testy i 9 testów ścisłej granicy proxy.
6. Public UI i panele backoffice: RED przy braku komponentów; GREEN: 2 testy UI klienta i 2 testy paneli.
7. Persistencja `required`: wykryto w validatorze, że pole było walidowane, ale nie przechodziło template → snapshot. Dodano kolumnę oraz serializację; targeted suite GREEN 41/41.

## Dowody bramek

- `npm test -- <Task 3 suite>`: 9 plików, 41/41 GREEN po migracji `required`.
- `node scripts/validate-installation-client-form.mjs`: GREEN. Izolowana baza, realne HTTP i auth, jednorazowy link, DB SHA-256-only, minimalna projekcja publiczna, autosave/restart/replay, równoległy idempotent submit, resolve, korekta, revoke/expired/random identyczne 404 oraz `foreign_key_check` i `integrity_check`.
  Wynik: `{"status":"ok","revisions":2,"public404":"identical","tokenStorage":"sha256-only"}`.
- `npm test`: GREEN, 74 pliki / 418 testów. Integracyjny upgrade wykonuje rzeczywiste `prisma migrate deploy` od 20-migration legacy DB oraz fresh chain 23 migracji; sprawdza FK, integrity i dwa triggery niemutowalnych odpowiedzi.
- `npm run build`: GREEN, 133 tras. Zweryfikowane także dynamiczne `Promise` params Next 16 dla tras publicznych i internal.

## E2E — BLOCKED po limicie iteracji

Playwright `e2e/installations-client-form.spec.ts` był wykonywany pięć razy. Przepływ dochodził do owner resolve i korekty; ostatnia próba zatrzymała się tylko na asercji przejściowego tekstu `Zapisywanie…`: zapis już przeszedł do potwierdzonego `Wszystko zapisane` przed odczytem asercji. Nie jest to błąd zapisu; stabilizowano test, pozostawiając asercję końcowego potwierdzenia oraz readback po refreshu. Zgodnie z limitem nie wykonano szóstej próby E2E w tym loopie.
