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

## Corrective loop po spec review

1. Replay po revoke/expiry: RED w integracji — autosave zwracał zapisaną odpowiedź idempotentną przed sprawdzeniem linku. GREEN: każda mutacja najpierw rozwiązuje aktywny hash tokenu wewnątrz transakcji; test serwisowy, test HTTP i validator potwierdzają identyczne `404` + `no-store` dla replay autosave i submit po revoke oraz expiry.
2. Prywatny kontrakt: RED — projekcja i mutacje ujawniały `clientName` / identyfikator submission. GREEN: publicznie jest tylko firmowy kontakt WallDecor, brak klienta i pracownika, a mutacje przyjmują `revisionNumber` i `draftVersion`; serwer sam rozwiązuje rewizję dla ważnego linku.
3. Race autosave: RED — dwa opóźnione żądania mogły kończyć widok starszym stanem. GREEN: jedna kolejka in-flight, coalescing najnowszych zmian i merge po 409; unit symuluje odwrócone odpowiedzi `Tak → Nie wiem` i wymaga końcowego `UNKNOWN`. Dodatkowy RED wykazał, że debounce przez chwilę pokazywał „Wszystko zapisane”; GREEN natychmiast zmienia status na `Zapisywanie…` po lokalnej zmianie. Kolejny RED wykrył automatyczną pętlę retry po błędzie; GREEN zatrzymuje kolejkę z widocznym błędem i wysyła ponownie wyłącznie po jawnym „Spróbuj ponownie”.
4. Przedłużenie linku: RED — panel nie miał akcji mimo istniejącego API. GREEN: bezpieczna akcja `Przedłuż o 14 dni`, stan loading/error i brak ponownego pokazania URL tokenu.
5. Niemutowalność: RED — bezpośredni Prisma INSERT do wysłanej rewizji był możliwy. GREEN: addytywna migracja `20260822030100_installation_submitted_answer_insert_guard`, test integracyjny i validator sprawdzają odrzucenie INSERT oraz niezmieniony historyczny count odpowiedzi.
6. Dokumentowe 404: RED w rzeczywistym E2E — po potwierdzonym revoke `/m/[token]` oddawało soft HTTP 200, ponieważ `loading.tsx` pozwalał Next rozpocząć streaming przed asynchronicznym `notFound()`. GREEN: usunięto streamingową granicę tylko dla publicznej ścieżki; server component nadal wprost rozwiązuje token i wywołuje `notFound()`, a segmentowe `not-found.tsx` pokazuje jednolitą neutralną stronę.

## Dowody bramek

- Ostatni targeted rerun: 30/30 GREEN (public routes, UI queue z retry, client-form real SQLite, proxy oraz fresh/upgrade migrations).
- `node scripts/validate-installation-client-form.mjs`: GREEN. Izolowana baza, realne HTTP i auth, SHA-256-only token, projekcja bez PII/joinable ID, extend bez zwrotu tokenu, autosave/restart/replay, równoległy idempotent submit, resolve/korekta, replay po revoke/expiry i random z identycznym `404` + `no-store`, direct INSERT guard oraz `foreign_key_check` i `integrity_check`.
  Wynik: `{"status":"ok","revisions":2,"public404":"identical","tokenStorage":"sha256-only"}`.
- `npm test`: GREEN, 74 pliki / 426 testów. Integracyjny upgrade wykonuje rzeczywiste `prisma migrate deploy` od 20-migration legacy DB oraz fresh chain 24 migracji; sprawdza FK, integrity i trzy triggery niemutowalnych odpowiedzi.
- `npm run build`: GREEN, 133 tras. Zweryfikowane także dynamiczne `Promise` params Next 16 dla tras publicznych i internal.

## E2E — GREEN po osobnej pętli dokumentowego 404

Nowa pętla: RED 1/5 potwierdził soft 200 dla dokumentu. GREEN 3/5: pełny Playwright flow przechodzi od aktywnego anonimizowanego formularza do submit/resolve/korekty; active link pozostaje HTTP 200, a revoked, expired, random i malformed `/m/[token]?unavailable=*` dostają faktyczne HTTP 404, identyczny neutralny widoczny tekst i bez PII, powodu, tokenu ani wpływu query parametru.
