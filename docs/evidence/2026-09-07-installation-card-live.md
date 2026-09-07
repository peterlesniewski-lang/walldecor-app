# Karta montażu — wdrożenie produkcyjne 7 września 2026

Zatwierdzenie użytkownika: „pusc live”. Ten raport uzupełnia wcześniejsze raporty lokalnego podglądu i układu.

## Wydanie

- URL: https://app.walldecor.pl/installations
- Coolify: kontekst `wallvps`, Root Team (0), serwer `tgso04og4wcwk0oc0o84s8gw`.
- Projekt `gws8gs8wg480wkww8k00cwgo` (My first project), środowisko `bckogwk400o8kg8ks08cs8c4` (production).
- Aplikacja `pwc0sk0w8cw8k8wkgwokgogk` — istniejący zasób, bez zmiany domeny i wolumenów.
- Poprzedni commit: `bde9e2b0f734993a62b0e1adee3e6913c051d37d`.
- Nowy commit: `796148c41136beb56ba46132e83d54aa3587e932` (główne zmiany w `05676db`). Fast-forward zdalnego `main`, bez force push.
- Deployment: `ycc8gog4w00gk8cs0osws444`, **finished**, 14:41:39 UTC; aplikacja **running:healthy**.

## Bramka przed wdrożeniem

- Jednostkowe/integracyjne testy montaży: **647/647**, 85 plików.
- `npm run typecheck:app`: exit 0.
- ESLint komponentu wizyt i testu regresyjnego: exit 0.
- E2E: **7/7**, świeża izolowana baza, testowe Calendar i media; testy obejmują zapis/odczyt, formularz, ustalenie, wizyty, role, załącznik i restart.
- Niezależny lokalny build produkcyjny: exit 0. Końcowy obraz Docker z commitu `796148c` został zbudowany i uruchomiony przez Coolify.
- Późny test E2E wykrył wyścig: pierwsze opóźnione odświeżenie serwera kasowało daty wpisane do nowo utworzonej wizyty. Poprawiono wybór lokalnej wartości bazowej i dodano deterministyczny test RED → GREEN.

## Baza i bezpieczeństwo operacji

- Backup SQLite przed zmianami: `/data/backups/walldecor-before-card-20260907-1420.db`, 8 527 872 bajtów, uprawnienia 0600, `integrity_check=ok`, brak błędów FK.
- Migrację sprawdzono na kopii tej bazy w starym kontenerze: `/tmp/card-migration-check-20260907.db`. Integralność/FK poprawne, zachowana karta.
- Wdrożenie wykonało `20260907000000_installation_resolution_optional_note` standardowym mechanizmem migracji; po starcie odczyt `_prisma_migrations` potwierdził zakończenie.
- Po wdrożeniu: `quick_check=ok`, `foreign_key_check` bez wyników; istniejące dane widoczne w karcie.
- Przed przełączeniem wyłączono Scheduled Task `fkwsckc8scokkw44g4swgwwg`; kolejka miała wyłącznie 5 COMPLETED, brak PROCESSING.
- Po weryfikacji ponownie włączono identyczne zadanie `npm run worker:installation-calendar`, harmonogram co minutę. Pierwszy automatyczny przebieg **Success**, 14:43:01–14:43:07 UTC.

## Kontrola publicznej aplikacji

W oddzielnej karcie zalogowanej przeglądarki sprawdzono istniejącą testową kartę bez zapisywania zmian:

- nowy układ, podsumowanie, kontakt `tel:`/`mailto:`, zachowane produkty i pomiary;
- otwarcie edycji oraz anulowanie;
- odnośniki do formularza, wizyt, załączników i spraw do ustalenia;
- rozwinięcie rzeczywistych wysłanych odpowiedzi klienta;
- zachowany termin, przypisania i status Calendar istniejącej wizyty;
- otwarcie/anulowanie dodawania załącznika z domyślnym przypisaniem do całego zlecenia;
- wizualna kontrola większych odstępów i hierarchii pomieszczenie → zakres → produkty/pomiary.

Nie wysyłano nowych e-maili ani zaproszeń i nie modyfikowano klienta. Nie wykonywano nowego uploadu do produkcyjnej usługi plików ani nowego zapisu do Google; pełny mutujący przepływ wykonano w izolowanych E2E. Sukces pustego przebiegu workera potwierdza jego uruchomienie, nie nową dostawę wydarzenia do Google.

## Wycofanie

Zachowano poprzedni commit i backup. W razie regresji można przywrócić poprzedni obraz/kod w tym samym zasobie po zatrzymaniu workera i kontroli kolejki. Migracja łagodzi wyłącznie wymóg dodatkowej notatki dla RESOLVED; WAIVED zachowuje uzasadnienie. Nie przywracać automatycznie całej starej bazy: najpierw sprawdzić zapisy dokonane po wdrożeniu i przygotować osobną kopię aktualnego stanu. Przywrócenie bazy wymaga osobnej decyzji, aby nie utracić nowych danych.
