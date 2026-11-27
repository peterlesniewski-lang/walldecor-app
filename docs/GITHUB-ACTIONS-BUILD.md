# Budowanie WallDecor-App poza VPS

Workflow: `.github/workflows/build-image.yml`.

GitHub Actions buduje obraz na maszynie GitHuba, korzystając z istniejącego
Dockerfile (łącznie z kontrolą typów i produkcyjnym buildem Next.js).
Docelowa platforma obrazu: `linux/amd64`.

## Co uruchamia workflow

- Pull request do `main`: pełny build bez publikacji obrazu i bez dostępu do
  poświadczeń rejestru.
- Push/merge do `main`: build i publikacja obrazu w GHCR.
- Ręczne `Run workflow`: na `main` publikuje obraz; na innej gałęzi tylko sprawdza
  build.

Workflow nie zawiera tokena Coolify, webhooka wdrożeniowego ani joba deploymentu.
Sukces budowania nie jest zgodą na wdrożenie.

## Wersje i zgoda na produkcję

Repozytorium obrazów: `ghcr.io/peterlesniewski-lang/walldecor-app`.
Każdy run publikuje osobny tag:
`sha-<pełny commit>-run-<run ID>-<próba>`.
Nie publikujemy ruchomych tagów `latest` ani `main`.

Podsumowanie runa zawiera tag, commit i digest `sha256`. Operator przedstawia
użytkownikowi dokładny digest i wynik sprawdzeń. Dopiero wyraźna zgoda użytkownika
pozwala zmienić uruchomioną wersję aplikacji.

## Coolify — konfiguracja istniejącego zasobu

- Kontekst: `wallvps`, `https://coolify.walldecor.pl`.
- Team: `Root Team`.
- Serwer: `tgso04og4wcwk0oc0o84s8gw` (`localhost`, VPS `51.83.197.9`).
- Projekt: `gws8gs8wg480wkww8k00cwgo` (`My first project`).
- Środowisko: `bckogwk400o8kg8ks08cs8c4` (`production`).
- Aplikacja: `pwc0sk0w8cw8k8wkgwokgogk` (`WallDecor-App`).
- Domena: `https://app.walldecor.pl`, port kontenera `3000`.
- Auto Deploy: wyłączony; Preview Deployments: wyłączone.

Coolify beta.463 nie obsługuje zmiany istniejącego zasobu na `dockerimage` przez
API aktualizacji. Zachowujemy build pack `dockerfile`, ale plik wdrożeniowy to
`/Dockerfile.coolify`. Ten plik zawiera wyłącznie `ARG` i `FROM`: pobiera gotowy
obraz, zachowując jego USER, ENTRYPOINT i HEALTHCHECK. Na VPS nie ma `npm ci`,
kompilacji Next.js ani kontroli typów; Docker tworzy tylko lokalne odwołanie do
gotowego obrazu.

Referencję konkretnego zatwierdzonego obrazu ustawiamy w Coolify jako zmienną
`WALLDECOR_APPROVED_IMAGE=ghcr.io/peterlesniewski-lang/walldecor-app@sha256:<digest>`,
dostępną tylko podczas builda. `Use Build Secrets` musi być wyłączone, aby Coolify
przekazało referencję przez zwykły `--build-arg`. `Inject Build Args to Dockerfile`
pozostawić wyłączone: globalny ARG już znajduje się przed FROM w pliku.
Bez tej zmiennej wdrożenie celowo się nie powiedzie; nie ma domyślnego
obrazu ani automatycznego powrotu do kompilacji na VPS.

Przed pierwszym wdrożeniem trzeba potwierdzić dostęp VPS do GHCR. Samo uzupełnienie
pól Docker Registry przy oryginalnym Dockerfile nie przenosi budowania poza VPS.
Nie tworzyć zastępczej aplikacji z tą samą domeną ani nowego wolumenu SQLite.
Zachować wszystkie obecne wolumeny, sekrety runtime, alias sieciowy i zadania.

Widoczność pakietu należy jawnie sprawdzić po pierwszej publikacji: GitHub może
odziedziczyć publiczny dostęp z repozytorium źródłowego. Pakiet `walldecor-app`
został ustawiony jako prywatny, a Inherit access from source repository wyłączone.
Zachowano dostęp workflow repozytorium do publikacji. Anonimowe pobieranie
jest odrzucane. VPS potrzebuje istniejącego logowania do GHCR lub dedykowanego
tokena tylko do odczytu pakietu. Nie wpisywać
tokenów do repozytorium, workflow, argumentów poleceń ani raportów.

14.10.2026 potwierdzono logowanie Docker na VPS dedykowanym tokenem wyłącznie
`read:packages` oraz pobranie obrazu
`sha256:fde830f308b7018137ccc12bf4094b660eb40d96888e6232cc855c5660a0cb9b`
w architekturze `linux/amd64`. Token wygasa 12.01.2027; przed kolejnym pobraniem
po tej dacie trzeba odnowić dostęp do GHCR. Produkcja pozostała na commicie
`1c55b01800ed5302f662dc785aaf42f2d3b47d36`, a `WALLDECOR_APPROVED_IMAGE`
nie została ustawiona. Samo pobranie obrazu nie uruchamia aplikacji ani migracji.

## Pierwsze wdrożenie — wykonane 26.10.2026

Zatwierdzony digest `sha256:672f6efb8d66754c86ad86b53f15599ca42e90f12b8378083618a41e8b77ec31`
(commit `64ab504`, run `40350166671`, PR #31). Migracja próbna na kopii bazy nowym obrazem
z wolumenem tylko do odczytu: 49 → 55 migracji, integrity ok. Backup przed zmianą:
`/data/backups/walldecor-before-acceptance-20261026-1547.db`; entrypoint zrobił drugi
(`walldecor-20261026-160159-1.db`). Zmienna `WALLDECOR_APPROVED_IMAGE` utworzona przez API
(`POST /applications/{uuid}/envs` przyjmuje tylko key/value/is_preview/is_literal/is_multiline/
is_shown_once; Coolify beta.463 sam ustawił `is_buildtime=true`). Deploy 22 s, rolling update,
kontener `pwc0sk0w8cw8k8wkgwokgogk-160139262557`, `running:healthy`. Warstwy obrazu
uruchomionego kontenera identyczne z obrazem GHCR (różni się tylko lokalny image ID przez
etykiety Coolify). Terminal Coolify (`/terminal`, serwer `localhost`) działa jako root i
zastępuje brak endpointu `execute` w API.

## Rejestr wdrożeń produkcyjnych

Jedna lista tego, co działa na `app.walldecor.pl`. Aplikację zmieniamy z wielu modułów
naraz, więc po **każdym** wdrożeniu dopisujemy wiersz (najnowszy na górze): data,
PR-y, commit, pełny digest, migracje i wynik weryfikacji. Aktualny stan produkcji
= najwyższy wiersz.

| Data (CEST) | Moduł / PR | Commit | Digest obrazu | Migracje | Weryfikacja |
|---|---|---|---|---|---|
| 27.11.2026 15:45 (CET) | Wynagrodzenia, etapy 2–5 planu: automat 1. dnia miesiąca (#49, z #43), stawka godzinowa i przypomnienie przed wypłatą (#50, z #44), wykonawcy poza HR (#53, z #45), strona szczegółów rozliczenia i scenariusz „miesiąc właściciela” (#54, z #46); naprawa dwóch niestabilnych testów (#51) | `36263d6` | `sha256:e939a25e414e688f1ca8821db8d70239700297b3fcb3c1f46f7b34f4579043c4` (run `46016756972`) | 57 → 58 (`20261124180000_payroll_auto_carryover`) | `running:healthy`; deployment `wymhpdnwkonbr8akjzhex7ka` (ok. 1 min); w logu startu kopia `/data/backups/walldecor-20261127-144514-1.db`, zastosowana migracja `20261124180000_payroll_auto_carryover` i pierwszy wpis harmonogramu `PAYROLL_PAY_REMINDER` (kod etapu 3; za listopad nikt nie czekał, powiadomienia nie wysłano); automat przenoszenia wyłączony do włączenia przez właściciela w „Ustawieniach płac”; z zewnątrz `/login` → 200, `/hr/payroll` bez sesji → logowanie; widoku po zalogowaniu nie sprawdzano z zewnątrz (potwierdza właściciel). Wdrożenie na polecenie właściciela z 27.11 („po dokończeniu zrób wdrożenie”). Obraz do cofnięcia: `sha256:bead23e624f3e34f7d46fa66fb385613daf4e4cc7e8646bf70ac909d67d1da1f` |
| 25.11.2026 11:08 (CET) | Wynagrodzenia: arkusz miesiąca (#48, etap 1 z #42); plan (#47) | `4a65119` | `sha256:bead23e624f3e34f7d46fa66fb385613daf4e4cc7e8646bf70ac909d67d1da1f` (run `45456943327`) | 56 → 57 (`20261124120000_payroll_month`) | `running:healthy`; w logu startu kopia `/data/backups/walldecor-20261125-100843-1.db` i zastosowana migracja `20261124120000_payroll_month`, która istnieje tylko w tym obrazie; widoku po zalogowaniu nie sprawdzano z zewnątrz (potwierdza właściciel) |
| 20–24.11.2026 (data wdrożenia nieodnotowana; obraz zbudowany 20.11) | wpis odtworzony 25.11 ze stanu Coolify — wdrożenia nie odnotowano w rejestrze; zakres: wszystko z `main` do PR #40 | `bd3bf6f` | `sha256:2771b6601b3757465d860b8d083a3c2874ad67d77c34fd217bd8766cd215051f` (run `44761302672`) | do 56 | stan odczytany 24.11: `running:healthy`, `WALLDECOR_APPROVED_IMAGE` wskazywał ten digest |
| 27.10.2026 11:28 | KSeF: podświetlanie terminów płatności (#34, #35) | `59a1b60` | `sha256:2219392aff08ce15f98bc3d0b5fc9ca4bbef06c313b140bf0aca675da2cfc548` (run `40486237652`) | brak | `running:healthy`; nowy kod w `page-ea7eaf53…js`, 8 wierszy z kolorem na żywej liście |
| 26.10.2026 18:17 | Montaże: poprawki UX, e-maile alertów (#32) | `40637b6` | `sha256:e9f58f95…52fd9e` (run `40375069002`) | brak | `running:healthy` |
| 26.10.2026 16:02 | Montaże: cyfrowy protokół odbioru (#31) | `64ab504` | `sha256:672f6efb8d66754c86ad86b53f15599ca42e90f12b8378083618a41e8b77ec31` (run `40350166671`) | 49 → 55 | `running:healthy` |

Uwaga: PR-y #29 (KSeF: kopiowanie sumy, tytuł przelewu), #34 i #35 weszły do `main`
przed wdrożeniem 27.10 11:28. Dwa „deploye" tego dnia (09:36 i 10:09) tylko ponownie
uruchomiły obraz z 26.10 18:17, bo nie ustawiono nowego `WALLDECOR_APPROVED_IMAGE`.
Status `finished` w Coolify nie dowodzi, że działa nowy kod — po wdrożeniu sprawdzamy
obecność zmiany w plikach JS na produkcji (lub w działającym widoku).

## Procedura wdrożenia — po zgodzie

1. Potwierdzić zielony run GitHub Actions i jego dokładny digest.
2. Potwierdzić, że VPS potrafi pobrać ten obraz, bez uruchamiania go na produkcji.
3. Sprawdzić trwałe wolumeny i aktualny stan migracji SQLite; wykonać i zweryfikować
   backup przed zmianą uruchomionej wersji.
4. Uzyskać zgodę użytkownika na konkretny digest.
5. Ustawić `WALLDECOR_APPROVED_IMAGE` na ten digest i w istniejącym zasobie Coolify
   uruchomić wyłącznie zatwierdzony obraz przez `/Dockerfile.coolify`.
6. Powiązać zatwierdzony digest GHCR z wariantem `linux/amd64` i porównać jego
   image/config ID z `.Image` uruchomionego kontenera; lokalny tag Coolify nie
   potwierdza tożsamości obrazu. Sprawdzić health i rzeczywisty przepływ logowania
   pod `https://app.walldecor.pl`.
7. Dopisać wiersz do rejestru wdrożeń powyżej (commit, pełny digest, migracje, weryfikacja).

## Cofnięcie zmiany

Zachować poprzedni obraz i zatwierdzony digest. Rollback aplikacji nie cofa
migracji bazy, dlatego zgodność schematu trzeba sprawdzić przed rollbackiem.
Nie usuwać wolumenów ani uruchamiać `db push --accept-data-loss`.

Konfigurację źródła można przywrócić do Dockerfile z repozytorium
`peterlesniewski-lang/walldecor-app`, gałęzi `main`, pliku `/Dockerfile`.
Pozostawić Auto Deploy wyłączony; taki rollback konfiguracji ponownie wymaga
budowania na VPS i nie jest docelową ścieżką wdrożeń.
