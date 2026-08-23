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

## Korekta P1 po przeglądzie — 2026-08-23

- endpointy plików nie tworzą niejawnej korekty: po `SUBMITTED` publiczne `GET files`, `POST files` i `POST handoff` zwracają 404, a w bazie pozostaje wyłącznie przesłana rewizja bez `draftKey`;
- wcześniej otwarta sesja telefonu także traci prawo dodawania po wysłaniu formularza;
- dopiero jawne „Zgłoś korektę” tworzy rewizję 2 z prawidłowym `revisionOfId`, kopią odpowiedzi oraz dostępem do gotowych, nieusuniętych plików wcześniejszej rewizji;
- regresja usług była najpierw czerwona na niejawnym pustym szkicu, po poprawce: **6/6 green**;
- po poprawce `npm test`: **88 plików / 504 testy**, `npm run build`: green, świeży/upgrade łańcuch migracji: green w `catalog-hierarchy-upgrade`;
- dedykowany Playwright `e2e/installations-media.spec.ts`: **1/1 green** z realnymi bajtami PNG, trzema odmowami endpointów po submit i odtworzeniem odpowiedzi/pliku po jawnej korekcie;
- `npm run validate:installation-media`: green, `restart=verified`, SHA-256 `0698f85f451be29efe982f6c5b3404ef75e0c894f569758dd2ad152f559f3816`.

## Korekta bezpieczeństwa uploadu i usuwania — 2026-08-23

- wszystkie trzy endpointy uploadu używają wspólnego parsera strumieniowego multipart (`busboy` 1.6.0, licencja MIT), bez `Request.formData()` i bez `File.arrayBuffer()` przed walidacją; `Content-Length` jest odrzucany od razu, a transfer chunked jest przerywany po limicie 10 MB z ograniczeniami liczby plików, pól i części;
- regresje dla publicznego desktopu, telefonu i panelu wewnętrznego potwierdzają, że przekroczenie limitu nie tworzy rekordu bazy ani wywołania media service, a źródłowy stream zostaje anulowany po najwyżej 10 MB + 32 KiB;
- publiczny desktop i telefon zwracają wyłącznie jawny DTO pliku: `id`, `originalFilename`, `contentType`, `byteSize`, `sha256`, `createdAt`;
- timeout media client obejmuje upload, podpisanie, cały odczyt body pobrania i usunięcie. Pobranie jest dodatkowo ograniczone do 10 MB oraz porównywane z zapisanym rozmiarem i SHA-256; test z body, które nigdy nie kończy odczytu, potwierdza abort i bezpieczny komunikat bez tokena;
- soft-delete natychmiast blokuje pobieranie w aplikacji. Stan zdalnego czyszczenia jest trwały (`PENDING`, `RETRY`, `SUCCEEDED`) z liczbą prób, błędem, terminem kolejnej próby i `remoteDeletedAt`; panel pokazuje awarię i ma działający przycisk ręcznego ponowienia. Zadanie nie deklaruje automatycznego workera;
- baza blokuje sfabrykowane przejścia stanu i audyt sukcesu bez rzeczywistego `SUCCEEDED`. Migracja naprawia też granicę milisekund dla dowodu dołączanego w bieżącej sekundzie;
- dowód niezgodności wybiera się z czytelnej listy otwartych niezgodności bieżącego zlecenia; techniczne ID nie jest wpisywane ręcznie, a po udanym dołączeniu pozycja znika z listy;
- pełny `npm test`: **90 plików / 520 testów**, green;
- `npm run build`: green;
- świeży pełny łańcuch migracji i upgrade legacy: green, w tym `PRAGMA integrity_check`;
- dedykowany Playwright Task 5: **1/1 green**; pełny `npm run test:e2e -- --workers=1`: **10/10 green**;
- `npm run validate:installation-media`: green, `restart=verified`, SHA-256 `0698f85f451be29efe982f6c5b3404ef75e0c894f569758dd2ad152f559f3816`;
- changed-file ESLint: **0 błędów**; `npm audit --omit=dev` nadal pokazuje istniejący baseline **9 produkcyjnych findings** (3 moderate, 5 high, 1 critical). `busboy` nie jest źródłem żadnego z nich; aktualizacje Next/Auth/Anthropic pozostają bramką bezpieczeństwa Task 12, bez `audit fix` w tym zadaniu.

## Korekta wyścigu upload–delete — 2026-08-23

- zwykłe usunięcie pliku w stanie `PENDING` jest odrzucane przed wywołaniem media service; deterministyczny test zatrzymuje upload pomiędzy rezerwacją rekordu a odpowiedzią adaptera, równolegle próbuje DELETE i potwierdza końcowy `READY` bez przedwczesnego zdalnego usunięcia;
- jeżeli prywatny serwer zapisał już bajty, lecz transakcja `PENDING → READY` nie może się zakończyć, aplikacja atomowo ustawia `FAILED`, odcina dostęp oraz rezerwuje `remoteDeleteStatus=PENDING` przed próbą kompensacyjnego DELETE. Awaria tej próby przechodzi do trwałego `RETRY`; test tworzy świeży PrismaClient i nową instancję adaptera, ponawia usunięcie i potwierdza `SUCCEEDED` oraz brak zdalnego obiektu;
- trigger `InstallationFile_soft_delete_remote_state_guard` blokuje bezpośrednie ukrycie rekordu przez zmianę samych `softDeletedAt/softDeletedById`. Pierwsze odcięcie widoczności musi w tej samej instrukcji mieć aktora, terminalny stan pliku i `remoteDeleteStatus=PENDING`; sprawdza to bezpośredni test SQL oraz pełny fresh/legacy-upgrade z `PRAGMA integrity_check`;
- timeout operacji DELETE obejmuje również pełne body odpowiedzi. Test odpowiedzi `200` z zakończonymi nagłówkami i niekończącym się body potwierdza anulowanie readera oraz błąd timeout; status `SUCCEEDED` nie jest zapisywany na podstawie samych nagłówków;
- targeted Task 5: **8 plików / 51 testów**, green; pełny `npm test`: **90 plików / 523 testy**, green;
- `npm run build`: green; pełny Playwright: **10/10 green** (49,5 s);
- `npm run validate:installation-media`: green, `restart=verified`, SHA-256 `0698f85f451be29efe982f6c5b3404ef75e0c894f569758dd2ad152f559f3816`.

## Korekta addytywnego łańcucha migracji — 2026-08-23

- `20260823060000_installation_remote_delete_lifecycle/migration.sql` przywrócono byte-for-byte do wersji możliwej do wcześniejszego zastosowania; SHA-256 pliku i historycznego wpisu Prisma wynosi `4c6a561d580d306a10773121e9c5e610fe3428a8bb8699ee6132aa8738248f1e`;
- trigger wiążący soft-delete z trwałym stanem zdalnego czyszczenia jest instalowany wyłącznie przez nową, addytywną migrację `20260823070000_installation_soft_delete_remote_guard`;
- rzeczywisty test upgrade najpierw uruchamia `prisma migrate deploy` na osobnym katalogu migracji zatrzymanym dokładnie na historycznym checksumie `60000`, zapisuje plik `READY`, a następnie dwukrotnie uruchamia deploy bieżącego łańcucha. Wynik: 33 zakończone i nierollbackowane migracje, niezmieniony checksum `60000`, aktywny guard, odrzucony bezpośredni SQL bypass i `PRAGMA integrity_check=ok`;
- świeży pełny łańcuch 33 migracji: green; targeted migracje/media/governance: **3 pliki / 26 testów**, green;
- pełny `npm test`: **90 plików / 524 testy**, green; `npm run build`: green; pełny Playwright: **10/10 green** (49,2 s);
- `npm run validate:installation-media`: green, `restart=verified`, SHA-256 `0698f85f451be29efe982f6c5b3404ef75e0c894f569758dd2ad152f559f3816`.
