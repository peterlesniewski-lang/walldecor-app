# Wdrożenie protokołu odbioru montaży — runbook

Dotyczy gałęzi z cyfrowym protokołem odbioru (spec #12, zadania #13–#19, PR #20)
po scaleniu z `main` i uproszczeniu karty montażu. Wdrożenie idzie wyłącznie
przez obraz z GHCR (`docs/GITHUB-ACTIONS-BUILD.md`); na VPS nie ma kompilacji.

## Co wnosi to wydanie do bazy

Sześć addytywnych migracji Prisma (nowe tabele protokołu, linków klienta,
alertów, PDF, zadań fakturowania, rozstrzygnięć oraz nullable kolumna
`InstallationFile.acceptanceProtocolId`):

```
20260923190000_installation_acceptance_protocol
20260923210000_installation_acceptance_client_response
20260923220000_installation_acceptance_exceptions
20260923230000_installation_acceptance_pdf
20260923233000_installation_acceptance_invoice_task
20260923234500_installation_acceptance_resolution
```

Żadna nie usuwa ani nie przepisuje istniejących danych. Entrypoint kontenera
robi własny backup SQLite przed `migrate deploy`.

## Ograniczenia znane przed wdrożeniem

- Produkcja nie ma ustawionych `INSTALLATION_MEDIA_API_URL` i
  `INSTALLATION_MEDIA_API_TOKEN`. Bez nich nie działa dodawanie załączników,
  plików klienta ani zdjęć w protokole. Protokół, podpisy, e-mail z linkiem i
  PDF bez zdjęć działają niezależnie. Serwer mediów to osobna decyzja.
- SMTP i Google Calendar są skonfigurowane; e-mail z linkiem protokołu
  oraz e-mail z linkiem do formularza klienta używają istniejącego `sendEmail`.
- W logach produkcji pojawia się błąd `mkdir /app/.next/standalone/.next/cache`.
  Nie blokuje health, ale warto go sprawdzić po wdrożeniu nowego obrazu.

## Krok 1 — build obrazu

1. Push gałęzi i PR do `main`: workflow buduje obraz bez publikacji.
2. Merge do `main`: workflow publikuje tag `sha-<commit>-run-<id>-<próba>`
   i digest `sha256`. Zapisz digest z podsumowania runa.

## Krok 2 — migracja próbna na kopii bazy (na VPS, z terminala)

Uruchamiane z konta mającego dostęp do Dockera na VPS `51.83.197.9`.
Używa dokładnie tego obrazu, który ma trafić na produkcję, ale nie startuje
aplikacji: kopiuje bazę do pliku tymczasowego i wykonuje `migrate deploy`
na kopii.

```bash
DIGEST="sha256:<digest z runa>"
IMAGE="ghcr.io/peterlesniewski-lang/walldecor-app@$DIGEST"
CONTAINER=$(docker ps --format '{{.Names}}' | grep pwc0sk0w8cw8k8wkgwokgogk | head -1)
VOLUME=$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
echo "container=$CONTAINER volume=$VOLUME"

# 1. Backup bieżącej bazy i jej integralność
docker exec "$CONTAINER" sh -c '
  f=/data/backups/walldecor-before-acceptance-$(date +%Y%m%d-%H%M).db
  sqlite3 /data/walldecor.db ".backup $f" && sqlite3 "$f" "PRAGMA integrity_check;" && echo "backup: $f"'

# 2. Próba migracji na kopii, nowym obrazem, bez uruchamiania aplikacji
docker run --rm --entrypoint sh -v "$VOLUME":/data "$IMAGE" -c '
  cp /data/walldecor.db /tmp/rehearsal.db &&
  DATABASE_URL=file:/tmp/rehearsal.db node node_modules/prisma/build/index.js migrate deploy &&
  sqlite3 /tmp/rehearsal.db "PRAGMA integrity_check; PRAGMA foreign_key_check;
    SELECT COUNT(*) AS migrations FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
    SELECT name FROM sqlite_master WHERE type=\"table\" AND name LIKE \"InstallationAcceptance%\" ORDER BY name;
    SELECT COUNT(*) AS orders FROM InstallationOrder;"'
```

Oczekiwany wynik: `integrity_check = ok`, pusty `foreign_key_check`, sześć
nowych tabel `InstallationAcceptance*`, liczba kart taka sama jak przed próbą.
Plik `/tmp/rehearsal.db` znika razem z kontenerem; baza produkcyjna nie jest
dotknięta.

## Krok 3 — zgoda i wdrożenie

1. Właściciel zatwierdza konkretny digest.
2. W Coolify ustawić `WALLDECOR_APPROVED_IMAGE=ghcr.io/peterlesniewski-lang/walldecor-app@<digest>`
   (zmienna build-time, `Use Build Secrets` wyłączone) i uruchomić deploy
   istniejącego zasobu `pwc0sk0w8cw8k8wkgwokgogk`.
3. Po starcie: `https://app.walldecor.pl/api/health`, logowanie, `/installations`,
   otwarcie karty testowej, sekcja protokołów na wizycie potwierdzonej.

## Krok 4 — próba na żywo (karta testowa, dane fikcyjne)

1. Na karcie testowej: potwierdzona wizyta z przypisanym instalatorem i zakresem.
2. Konto instalatora: utworzyć protokół, wpisać wyniki, podpisać.
3. Odbiór klienta na tym samym urządzeniu (link „na miejscu”) oraz e-mail
   (link `/p/<token>`) na adres testowy.
4. Pobranie PDF przez obie strony, sprawdzenie zadania „Wystawić fakturę”
   na karcie opiekuna.
5. Odmowa odbioru → protokół jednostronny → powiadomienie w aplikacji
   i e-mail do administratora.
6. Zamknąć #13–#19 i #12 z odnośnikiem do wyniku próby.

## Cofnięcie

Rollback aplikacji to poprzedni digest w `WALLDECOR_APPROVED_IMAGE`. Migracje
są addytywne, więc poprzednia wersja aplikacji działa na zmigrowanej bazie.
Nie przywracać backupu na nowe dane użytkowników.
