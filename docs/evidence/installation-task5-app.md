# Task 5 — prywatne pliki montażowe (evidence)

## Zakres

- prywatny adapter mediów zgodny z kontraktem `POST upload`, `POST signed-download`, `GET stream`, `DELETE`;
- publiczny upload per pytanie, opcjonalne przekazanie QR do telefonu oraz sesja mobilna add-only;
- wewnętrzne pliki projektu dla zlecenia, pomieszczenia lub zakresu oraz dowody niezgodności;
- proxy pobrania przez aplikację po sprawdzeniu dostępu; przeglądarka nie dostaje adresu ani tokenu media service;
- reguły SQLite dla lifecycle pliku, snapshotów targetu, hash-only QR, mostka dowodu i rozliczenia.

## Weryfikacja lokalna — 2026-08-23

- pełny `npm test`: **88 plików / 497 testów**, green;
- `npm run build`: green (Next.js 16; dynamic params jako `Promise`);
- świeży pełny łańcuch migracji oraz upgrade: green (`catalog-hierarchy-upgrade`);
- testy usługi mediów: upload SHA-256, wymagany FILE, QR burn/hash/revoke i soft-delete: green;
- kontrakt signed-download używa dokładnie `{ expires_at, signature }` i `?exp=...&sig=...`.

## Ograniczenia środowiska

E2E używa wyłącznie jawnego `INSTALLATION_MEDIA_TEST_ADAPTER=memory`; adapter odmawia pracy w `NODE_ENV=production`. Produkcyjny serwer mediów oraz backup Google Drive nie są deklarowane jako wdrożone w tym zadaniu. `qrcode` nie dodał nowych wyników audytu; repo miało baseline 9 produkcyjnych podatności, które wymagają osobnej klasyfikacji w Task 12.
