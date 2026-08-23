# Task 5 — prywatne pliki montażowe (evidence)

## Zakres

- prywatny adapter mediów zgodny z kontraktem `POST upload`, `POST signed-download`, `GET stream`, `DELETE`;
- publiczny upload per pytanie, opcjonalne przekazanie QR do telefonu oraz sesja mobilna add-only;
- wewnętrzne pliki projektu dla zlecenia, pomieszczenia lub zakresu oraz dowody niezgodności;
- proxy pobrania przez aplikację po sprawdzeniu dostępu; przeglądarka nie dostaje adresu ani tokenu media service;
- reguły SQLite dla lifecycle pliku, snapshotów targetu, hash-only QR, mostka dowodu i rozliczenia.

## Weryfikacja lokalna — 2026-08-23

- pełny `npm test`: **88 plików / 504 testy**, green;
- `npm run build`: green (Next.js 16; dynamic params jako `Promise`);
- świeży pełny łańcuch migracji oraz upgrade: green (`catalog-hierarchy-upgrade`);
- testy usługi mediów: upload SHA-256, wymagany FILE, QR burn/hash/revoke, limit równoległy `maxFiles=1`, retry po błędzie i soft-delete: green;
- kontrakt signed-download używa dokładnie `{ expires_at, signature }` i `?exp=...&sig=...`.
- pełny `npm run test:e2e`: green (10 scenariuszy); scenariusz Task 5 wykonuje desktopowy QR, mobilny upload prawidłowego PNG, sprawdza oba wejścia aparat/biblioteka, polling desktopu, wysłanie formularza, wewnętrzne pobranie SHA-256, cofnięcie przekazania i odmowę po soft-delete;
- SVG QR w E2E jest porównywany z kodem wygenerowanym dla dokładnego `handoffUrl`, nie tylko z obecnością obrazka;
- `npm run validate:installation-media`: green. Walidator uruchamia Next, tworzy i odbiera QR, wysyła plik, zatrzymuje ten proces Next, uruchamia nowy proces na tej samej SQLite i trwałym katalogu testowych mediów, po czym potwierdza pobranie tych samych bajtów, wysłanie formularza i odmowy po revoke/soft-delete;
- adapter filesystem ma osobny test odczytu z nowego procesu Node, więc nie opiera dowodu trwałości na globalnym `Map`.

## Ograniczenia środowiska

E2E używa jawnego `INSTALLATION_MEDIA_TEST_ADAPTER=filesystem` wyłącznie poza produkcją, w kontrolowanym katalogu `/tmp/walldecor-installations-e2e-media-*`; adapter odmawia pracy w `NODE_ENV=production`. Produkcyjny serwer mediów oraz backup Google Drive nie są deklarowane jako wdrożone w tym zadaniu. `qrcode` nie dodał nowych wyników audytu; repo miało baseline 9 produkcyjnych podatności, które wymagają osobnej klasyfikacji w Task 12.
