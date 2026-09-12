# Faktury i wspólne AI — końcowy odbiór lokalny

12 września 2026. Checkout `walldecor-invoice-ai`, gałąź `feat/invoice-import-codex-ai`, baza `391518d`. **Aplikacja odebrana lokalnie. Nie wdrożono; brak commitu i pusha. Cały plan pozostaje otwarty do odbioru środowiska i produkcji.**

## Dowody użytkowe

- [Wspólne AI i oba czaty](2026-09-11-shared-ai-linux-acceptance.md): rzeczywisty oficjalny CLI, dedykowane logowanie właściciela, `gpt-5.6-luna/low`, poprawny JSON, priorytet i trwałość kolejki, oba interfejsy oraz osobny brak logowania. Bez płatnego fallbacku.
- [Jedna faktura UI/OAuth](2026-09-11-invoice-single-oauth-acceptance.md): upload, odczyt, poprawa, zatwierdzenie, dashboard, identyczny oryginał, cofnięcie i edycja tej samej faktury oraz restart.
- [Paczka UI/OAuth i ręczne AUTH](2026-09-12-invoice-batch-manual-acceptance.md): 6 wejść → 4 oryginały i odczyty; PLN, dwustronicowy PDF EUR, pusta strona, korekta, duplikat i uszkodzony PDF. Dwa zatwierdzone koszty 123+430=553 PLN. Ręczna obsługa po AUTH osobno, z pustą sesją. SHA pobrań, baza i historia sprawdzone niezależnie.
- [KSeF i ryzyka UI](2026-09-12-invoice-ksef-ui-acceptance.md): jawne KEEP/APPLY, cofnięcie, stare i nowe kompletne miesiące, dwie karty i dwuklik, zerwany multipart, zachowanie oryginału. Nadejście KSeF syntetyczne; realny interfejs, HTTP i SQLite.
- Ten sam raport obejmuje poprawiony starszy formularz: duplikat nie tworzy kolejnego kosztu i można otworzyć istniejący dokument. Pełny zagraniczny identyfikator pozostaje zachowany. GET po kontrolowanej awarii nie powtarza POST ani nie kasuje formularza.

To dowody wymienionych scenariuszy, nie gwarancja bezbłędnego OCR ani wszystkich możliwych awarii. Ręczna kontrola i odrębne zatwierdzenie pozostają wymagane. PDF potwierdzony przez metadane dwóch stron, odczyt treści, osadzony podgląd i identyczne bajty; nie deklarujemy pełnej wizualnej kontroli obu stron w natywnym viewerze.

## Końcowe poprawki i regresja

Końcowy przegląd wykrył możliwość obejścia deduplikacji przez starszy formularz oraz automatyczne pobieranie obrazów z Markdown odpowiedzi encyklopedii. Obie luki odtworzono testami przed zmianą, poprawiono i poddano osobnym przeglądom SPEC/QUALITY.

Starsze create/approve i import używają wspólnej tożsamości wewnątrz transakcji rezerwującej zapis. Odpowiedź 409 wskazuje istniejący dokument. Nowy GET ujawnia tylko osiem pól, wymaga ADMIN i wyłącza cache. Obrazy AI są renderowane jako tekst alternatywny; brak `<img>` i preloads, zachowane listy, wyróżnienia oraz jawnie klikane bezpieczne linki. Dowodem zabezpieczenia Markdown są rzeczywisty renderer i wynik SSR/DOM, nie pomiar wszystkich żądań przeglądarki.

Świeże końcowe polecenia, po poprawkach aplikacji:

- `CODEX_VALIDATION_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex npm test` — **2653/2653 PASS, 255 plików, zero pominięć**, 13:18 Europe/Warsaw. Opt-in CLI używa syntetycznego lokalnego dostawcy i pustej sesji.
- `npm run typecheck:app` — PASS.
- `npm run build` — PASS, 145 stron, BUILD_ID `g1oUIEPrwMYhq9zCtnhyo`.
- ESLint wszystkich zmienionych i nowych plików TS/TSX/JS/MJS, `--max-warnings 0` — PASS; `git diff --check` — PASS.
- Ponowny Playwright starszego formularza na tym buildzie — PASS, run `1789212004439-aca60623`; niezależny SQLite/SHA/zrzuty PASS. Późniejsze zmiany dotyczą jedynie skryptu selektora i dokumentacji, nie aplikacji.

## Lokalny obraz amd64 — odbiór częściowy

Zbudowano `worker/ai/Dockerfile` z `--platform linux/amd64`. Obraz `walldecor-ai-gate:amd64-20260912`, dokładny ID/digest:

`sha256:574999e9ae63b60912061fb870cb159fe923af604b47127eebc29007be2d54e9`.

To lokalny Docker Desktop na hoście ARM64, nie natywny serwer amd64. CLI w obrazie `0.153.4`, model i katalog bez zmian. Czternaście plików runtime/skryptów/polityki ma hashe zgodne z checkoutem. UID 1000, katalogi `/oauth` i `/runtime` 0700; brak kodu aplikacji i klienta Prisma w obrazie.

**ZERO-tools PASS:** cztery przypadki, siedem żądań do wyłącznie syntetycznego serwera w kontenerze, brak Authorization, obrazy i ścisły schemat JSON. Wymuszone `exec_command`, `apply_patch` i `functions.exec` zostały odrzucone; żaden marker wykonania nie powstał. Network none, readonly rootfs, cap-drop ALL, no-new-privileges, 512 MiB/128 PID. `exec` na `/runtime` wyłącznie dla testowego shimu walidatora; produkcyjny noexec bez zmian. Pełne dowody syntetyczne skopiowano z tmpfs do `test-results/ai-amd64-boundary-20260912-1323/`. `docker cp` nie widział tego tmpfs; kopiowanie strumieniem archiwum z `docker exec` zachowało summary i cztery evidence.json.

**Blokada sesji amd64 NIEZALICZONA:** `scripts/validate-ai-linux-lock.mjs`, run `20260912112356-a0d9d9e9`, zatrzymał się na `WAIT_TIMEOUT:inference:undefined`. Raport i transkrypt: `test-results/ai-linux-lock-20260912112356-a0d9d9e9/`. Własny kontener i syntetyczny wolumen posprzątane, `cleanupPassed=true`.

Jednorazowe odtworzenie z zachowaniem kontenera potwierdziło zakończenie przy próbie snapshotu: exit 133, `OOMKilled=false`, log:

```text
assertion failed [!result.is_error]: Failed to create temporary file
(ThreadContextFcntl.cpp:85 create_tempfile)
```

Nie dowiedziono dokładnej przyczyny ani przejścia blokady w tym środowisku. Nie rozszerzano uprawnień, nie zmieniano readonly/noexec ani konfiguracji Dockera, nie montowano sesji właściciela. Odbiór ARM64 pozostaje wcześniejszym pozytywnym dowodem; nie zastępuje brakującego natywnego amd64.

Niezależny audyt potwierdził kompletnych siedem żądań ZERO-tools oraz niezaliczony wynik blokady w zapisanych artefaktach. Powyższy dodatkowy błąd odtworzenia i stan kontenera są obserwacją głównego wykonawcy z odczytu Dockera, bez oddzielnego pliku logu w artefaktach. Po zachowaniu dowodów usunięto dokładnie dwa własne kontenery boundary/debug i jeden syntetyczny wolumen debug; osobny skrypt blokady wcześniej usunął swoje zasoby. Pozostał wyłącznie wcześniejszy kontener n8n; sesja właściciela i obrazy nie zostały usunięte.

## Warunki następnego kroku

1. Zgoda właściciela na commit i push tej gałęzi, zgodnie z regułą repozytorium. Nie wykonano merge ani publikacji alternatywną ścieżką.
2. Odebrany natywny obraz amd64: ZERO-tools, blokada sesji z kontrolą negatywną, dedykowane logowanie właściciela i rzeczywisty smoke w środowisku docelowym. Nie kopiować lokalnych poświadczeń.
3. Kopia rzeczywistej SQLite i plików, migracja klonu, kontrola integralności oraz zachowania danych. Trzy nowe migracje są addytywne; bez `db push`/reset.
4. Prywatny trwały wolumen oryginałów i osobny wolumen OAuth, jeden worker, brak publicznych portów wykonawcy, uzgodnione sekrety tylko w środowisku. Dopiero wtedy publikacja i weryfikacja rzeczywistego publicznego przepływu.

Nie wykonano operacji bankowych ani kasowych. Produkcyjne dane i konfiguracja nie zostały zmienione w tym odbiorze.
