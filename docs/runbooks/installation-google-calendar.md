# Google Calendar dla wizyt montażowych — runbook

> Ten dokument opisuje przygotowanie po zaakceptowaniu wdrożenia. **W tym etapie
> nic nie jest konfigurowane ani wdrażane na Google Workspace, Coolify ani
> produkcji.** Aplikacja i SQLite pozostają źródłem prawdy; worker tylko
> synchronizuje kolejkę outbox do Google Calendar.

## Kolejność bezpiecznego uruchomienia

1. Pozostaw `INSTALLATION_CALENDAR_ADAPTER=disabled` i nie włączaj zadania
   cyklicznego.
2. Lokalnie użyj adaptera `fake` wyłącznie do testów. `adapter fake jest zabroniony w produkcji` — produkcyjny worker kończy się bez pobrania zadań.
3. Na koncie `info@walldecor.pl` utwórz osobny, testowy kalendarz o nazwie
   **TEST – Montaże**. Najpierw przejdź na nim cały smoke test opisany niżej.
4. Dopiero po potwierdzeniu create/update/cancel ustaw ID firmowego kalendarza
   i uruchom zadanie w Coolify.

## Google Workspace: uprawnienia domenowe

Do tej integracji potrzebne jest konto superadministratora Google Workspace.

1. W projekcie Google Cloud utwórz osobny service account dla synchronizacji i
   włącz **Google Calendar API**. Zapisz jego *OAuth client ID* do konfiguracji
   Domain-wide Delegation (DWD), a plik JSON traktuj jak sekret.
2. W konsoli administratora przejdź do: **Bezpieczeństwo → Kontrola dostępu i
   danych → Kontrola interfejsu API → Zarządzaj delegowaniem domenowym**.
   Dodaj OAuth client ID service accountu oraz dokładnie ten scope:

   ```text
   https://www.googleapis.com/auth/calendar
   ```

3. Subject (delegowany użytkownik) musi być dokładnie
   `info@walldecor.pl`. To to konto jest właścicielem firmowego kalendarza i z
   niego wychodzą zaproszenia do instalatorów.
4. Nie podawaj klientom ani instalatorom service accountu. Do wydarzenia worker
   dodaje wyłącznie e-maile aktywnych instalatorów przypisanych do zakresów
   wizyty.

DNS aplikacji nie ma znaczenia dla dostępu do Google Calendar: jest to
serwer–serwer do API Google. Publiczny HTTPS/DNS jest wymagany osobno dla
aplikacji i linków w opisie wydarzenia, ale nie dla DWD ani cron workera.

## Zmienne środowiskowe

W web-app i w zadaniu cyklicznym muszą znaleźć się **identyczne** wartości
`DATABASE_URL` oraz ustawienia kalendarza:

```dotenv
DATABASE_URL=file:/data/walldecor.db
INSTALLATION_CALENDAR_ENABLED=true
INSTALLATION_CALENDAR_ADAPTER=google
INSTALLATION_CALENDAR_WORKER_BATCH_SIZE=20
GOOGLE_CALENDAR_ID=ID_TESTOWEGO_LUB_FIRMOWEGO_KALENDARZA
GOOGLE_CALENDAR_IMPERSONATED_USER=info@walldecor.pl
GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64=BASE64_JSON_SERVICE_ACCOUNTU
```

Najpierw użyj ID kalendarza **TEST – Montaże**, następnie — po udanym smoke
teście — ID kalendarza firmowego. `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64`
jest sekretem: nie wklejaj go do dokumentacji, logów, opisu zadania, zrzutów
ekranu ani Git. W panelu Coolify ustaw go jako masked/secret i sprawdź, że
podgląd konfiguracji pokazuje wyłącznie flagi gotowości, nie klucz ani ID
kalendarza.

Batch jest skończony (maksymalnie 100 rekordów), więc uruchomienie co minutę
nie tworzy procesu działającego w tle. Jedno wywołanie Google ma limit krótszy
niż lease outboxa (5 minut); nie zwiększaj go powyżej lease.

## Coolify: zadanie cykliczne

Scheduled Task w Coolify działa **w wybranym działającym kontenerze aplikacji**,
a nie w osobnym kontenerze. Nie zmieniaj entrypointu web i nie uruchamiaj
workera jako drugiego procesu przy starcie kontenera.

1. Wybierz zasób aplikacji **WallDecor-App**. Zanim dodasz zadanie, potwierdź,
   że jej aktualny kontener jest zdrowy, ma podłączony trwały wolumen `/data`
   oraz że istniejący `DATABASE_URL` wskazuje bazę SQLite właśnie na tym
   wolumenie.
2. W sekcji Scheduled Tasks tej aplikacji dodaj zadanie z dokładnymi wartościami:

   - Cron: `* * * * *` (co minutę)
   - Command: `npm run worker:installation-calendar`
   - Timeout: 1200 s

3. Nie dodawaj drugiego wolumenu ani osobnych zmiennych dla Scheduled Task.
   Zadanie korzysta z działającego kontenera WallDecor-App, a więc z jego
   istniejącego `/data`, `DATABASE_URL` i zmiennych Google. Jeżeli te elementy
   nie są poprawne w aplikacji, najpierw napraw konfigurację aplikacji i nie
   uruchamiaj zadania.
4. Timeout musi obejmować najgorszy czas batcha: `batchSize × 45 s + margines`.
   Dla domyślnego batcha 20 ustawione 1200 sekund daje 900 sekund na żądania i
   300 sekund marginesu. Cron może uruchomić kolejny batch, gdy poprzedni jeszcze
   trwa; lease outboxa zabezpiecza zadania przed podwójnym przejęciem, lecz po
   obserwacji czasu wykonania trzeba wspólnie dostroić batch i timeout.
5. Sprawdź dostępność konfiguracji jako administrator w aplikacji w sekcji
   ustawień kalendarza: muszą być zielone wyłącznie flagi enabled, google,
   credentials, calendar i impersonation. Nie oczekuj tam sekretów.

Prawidłowy log jednego batcha jest wyłącznie obiektem JSON z licznikami:
`claimed`, `completed`, `retried`, `attention`. Kod `2` oznacza wymagające
uwagi zadania; kod `1` oznacza bezpieczny błąd konfiguracji lub procesu;
niezależnie od kodu nie powinny pojawić się payload wydarzenia, e-maile,
klucze ani surowy błąd Google.

## Smoke test na TEST – Montaże

1. Utwórz zlecenie, zakres i aktywnego instalatora z testowym e-mailem.
2. Utwórz i potwierdź wizytę. Po następnym uruchomieniu workera ma powstać
   jedno wydarzenie w **TEST – Montaże**, a jego status w aplikacji ma być
   zsynchronizowany.
3. Zmień termin tej wizyty. Worker ma zaktualizować istniejące wydarzenie, nie
   tworzyć drugiego.
4. Anuluj wizytę. Worker ma anulować właściwe wydarzenie po sprawdzeniu jego
   prywatnego identyfikatora wizyty; cudze wydarzenie nie może zostać usunięte.
5. Dopiero gdy wszystkie trzy kroki są potwierdzone w aplikacji i kalendarzu,
   przełącz `GOOGLE_CALENDAR_ID` z testowego na firmowy.

## Rollback i kopie

Rollback to: wyłączyć `INSTALLATION_CALENDAR_ENABLED`, zatrzymać Scheduled
Task i wykonać redeploy web-app. **Nie usuwaj** wizyt, rekordów outboxa,
wolumenu SQLite ani wydarzeń ręcznie jako pierwszego kroku — zachowują historię
i umożliwiają kontrolowane wznowienie po naprawie.

Przed pierwszym uruchomieniem potwierdź aktualną kopię trwałego wolumenu SQLite
oraz możliwość jej odtworzenia. Backup nie zastępuje smoke testu; po rollbacku
najpierw diagnozuj statusy `ATTENTION` i konfigurację, potem świadomie wznawiaj
worker.
