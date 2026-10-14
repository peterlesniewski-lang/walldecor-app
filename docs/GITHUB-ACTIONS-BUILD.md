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

## Pierwsze wdrożenie — dopiero po zgodzie

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

## Cofnięcie zmiany

Zachować poprzedni obraz i zatwierdzony digest. Rollback aplikacji nie cofa
migracji bazy, dlatego zgodność schematu trzeba sprawdzić przed rollbackiem.
Nie usuwać wolumenów ani uruchamiać `db push --accept-data-loss`.

Konfigurację źródła można przywrócić do Dockerfile z repozytorium
`peterlesniewski-lang/walldecor-app`, gałęzi `main`, pliku `/Dockerfile`.
Pozostawić Auto Deploy wyłączony; taki rollback konfiguracji ponownie wymaga
budowania na VPS i nie jest docelową ścieżką wdrożeń.
