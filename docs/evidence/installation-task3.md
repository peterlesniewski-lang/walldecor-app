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

## Corrective loop po quality review b1b63b6

1. Niemutowalna rewizja rodzica: RED — bezpośredni Prisma.update mógł zmienić status wysłanej rewizji na DRAFT. GREEN: addytywna migracja 20260822030200_installation_submitted_revision_guard ma SQLite BEFORE UPDATE i BEFORE DELETE dla InstallationFormSubmission ze statusem SUBMITTED. Integracja wykonuje warianty Prisma i raw SQL dla statusu, lineage, numeru, wersji i danych oraz potwierdza, że draft/korekta-draft nadal są mutowalne. Fresh chain ma 25 migracji i oba triggery rodzica.
2. RBAC odpowiedzi klienta: RED — przypisany INSTALLER mógł odczytać listę clarification z pełną odpowiedzią/evidence. GREEN: endpoint listy wymaga tej samej aktywnej polityki koordynatora co mutacje i zwraca 403 bez danych; server page nie pobiera ani nie przekazuje instalatorowi linków, clarification, readiness ani rewizji, a panele są niewyrenderowane. Test route, render oraz test server page potwierdzają granicę.
3. Odporne autosave i retry: RED — retry tworzył nowe clientMutationId, a utracona odpowiedź HTTP pokazywała błąd mimo zapisu na serwerze. GREEN: pojedyncza kolejka przechowuje stabilny in-flight payload/ID do potwierdzenia, scala nowe zmiany po nim i odczytuje publiczną projekcję po błędzie. Testy obejmują Tak → Nie wiem z różnymi ID dla nowych zmian, retry identycznego body oraz utracony response po commicie bez duplikatu.
4. Jawne czyszczenie opcjonalnych wartości: RED — null odrzucał kontrakt autosave, więc stara wartość zostawała w DB. GREEN: null (oraz puste MULTI) usuwa odpowiedź atomowo dla opcjonalnych TEXT, NUMBER, DIMENSION, SINGLE, MULTI i YES_NO_UNKNOWN; wymagane czyszczenie ma błąd walidacji. UI ma dostępne „Wyczyść odpowiedź”, a integracja, UI i validator sprawdzają DB/reload/submit.
5. Prerequisite linku: RED — panel proponował generowanie bez snapshotu, a błąd domenowy mógł skończyć się 500. GREEN: generowanie jest zablokowane z instrukcją „Najpierw przypnij dokładnie jeden formularz klienta…”, a istniejący link nadal można przedłużyć/cofnąć. Serwis rozróżnia wewnętrzny prerequisite od publicznego 404; internal API zwraca celowe polskie 409.
6. Dokument publiczny i lint: /m/[token] ma try/catch ograniczone do odczytu danych, a JSX jest poza nim. Weryfikacja ESLint tylko plików Task3: zero błędów.

## Bramka końcowa corrective loop

- Targeted: 7 plików / 36 testów GREEN (serwis SQLite, fresh/upgrade migration, RBAC route/page/panel, public route, UI autosave/retry/clear).
- npm test: GREEN — 75 plików / 436 testów.
- npm run build: GREEN — 133 tras, poprawne dynamiczne params Next 16.
- node scripts/validate-installation-client-form.mjs: GREEN. Izolowane HTTP/auth/SQLite, SHA-256-only token, public leak checks, optional clear + restart, concurrent submit, extend/revoke/expiry/random generic 404 z no-store, odpowiedzi i parent revision DB guards, FK/integrity.
- E2E Task3: GREEN 1/5 — pełny flow mobile + keyboard/focus, prerequisite snapshotu przed generowaniem, rapid autosave, extend, clarification/readiness, korekta, document 404 i replay po revoke.
