# Task 4 — opiekun, delegacja i klauzula podjazdu

Data: 2026-08-23

## Zakres dostarczony

- Karta ma zawsze dwóch różnych, aktywnych opiekunów. Tylko administrator lub manager może audytowanie zmienić primary/backup.
- Administrator lub manager ustanawia delegację z początkiem, końcem i powodem oraz może ją zakończyć wcześniej. Dostęp pracownika-delegata wynika wyłącznie z tych dat, nie z urlopów.
- Firma tworzy wersje polityki opłaty za podjazd. Wersja bez `legalApprovedAt` pozostaje nieaktywna: nie można jej wybrać do karty i nie pojawia się w formularzu klienta. Nie dodano automatycznej treści prawnej ani seeda zatwierdzenia.
- Opiekun, zastępca albo aktywny delegat może wybrać zatwierdzoną domyślną kwotę. Inna kwota trafia do `PENDING_APPROVAL`, a decyzję podejmuje wyłącznie administrator/manager.
- Publiczny formularz pokazuje dokładną zatwierdzoną kwotę i wymaga checkboxa. Jeżeli opłata zostanie wybrana dopiero po wysłaniu formularza, klient dostaje osobne, proste potwierdzenie — bez ponownego wypełniania odpowiedzi. Zapis obejmuje czas przyjęcia, pełną migawkę klauzuli i user-agent. IP jest opcjonalne i trafia do bazy wyłącznie jako wersjonowany HMAC-SHA-256 z zaufanego, jawnie skonfigurowanego nagłówka proxy; bez takiej konfiguracji zapis pozostaje `null`.
- `InstallationMismatch` wymaga opisu, powodu (`CANNOT_PERFORM` albo `EXECUTION_RISK`) i referencji dowodu. Ma status dowodu `PENDING_PRIVATE_FILE` aż do przyszłego kroku plików. Koordynator może zapisać decyzję, ale zadanie rozliczeniowe powstanie dopiero po rzeczywistym `VERIFIED_PRIVATE_FILE` z identyfikatorem pliku i czasem weryfikacji — Task 4 nie udaje tej czynności.

## Integralność i granice

- Migracje dodają status i pola prywatnego dowodu oraz wzmacniają triggery SQLite. Triggery chronią referencję `visitFeePolicyId` w addytywnie zmienianej tabeli `InstallationOrder`, więc nie można zapisać osieroconej polityki ani usunąć/zmienić ID polityki użytej przez kartę. Polityka użyta w historycznej migawce nie pozwala już na zmianę kwoty, tekstu, wersji ani akceptacji prawnej.
- Trigger billingowy odrzuca `MISMATCH_VISIT_FEE` z pustym `mismatchId`, bez decyzji koordynatora, bez zweryfikowanego prywatnego pliku, bez kompletnej prawnie zatwierdzonej migawki (`policyId`, kwota, niepusta klauzula, wersja, akceptacja prawna i klienta) albo z inną kwotą.
- Oba warianty akceptacji — wraz z pierwszym wysłaniem formularza i po wcześniejszym wysłaniu — przekazują jawne `true` oraz nieprzezroczysty digest SHA-256 całej migawki (`policyId`, status, kwota, tekst, wersja, data zatwierdzenia prawnego). `updateMany` wykonuje compare-and-set na niezaakceptowanej, dokładnie tej samej migawce. Równoległe identyczne żądanie jest idempotentne; zmiana dowolnego pola, także samego tekstu przy tej samej kwocie i wersji, zwraca 409, odświeża dane i zeruje checkbox. Audyt publicznej akceptacji nie zawiera tokenu, IP ani user-agenta.
- Data `legalApprovedAt` z przyszłości jest odrzucana przy tworzeniu polityki, wyborze polityki i zatwierdzaniu override. Obrona publicznej projekcji dodatkowo ukrywa każdą przyszłą datę i nie blokuje nią formularza.
- Migracja `20260823020000_installation_governance_durability` blokuje w Task 4 bezpośrednie wytworzenie `VERIFIED_PRIVATE_FILE` przez INSERT lub UPDATE. Dla prawidłowych historycznych zadań billingowych dowód i kompletna migawka opłaty na zleceniu stają się niezmienne.
- Migracja `20260823030000_installation_fee_acceptance_integrity` wymaga, aby zmiana któregokolwiek pola prawnej migawki już zaakceptowanej przez klienta wyzerowała w tym samym atomowym UPDATE czas akceptacji, hash IP i user-agent. Próba przeniesienia starej akceptacji na nową treść jest odrzucana. Po utworzeniu zadania rozliczeniowego wcześniejszy trigger trwałości blokuje zarówno zmianę migawki, jak i samo wyzerowanie akceptacji.
- INSERT i UPDATE zadania `MISMATCH_VISIT_FEE` są dodatkowo odrzucane na poziomie SQLite, jeśli `visitFeeLegalApprovedAt` zlecenia leży w przyszłości. Ochrona obsługuje bieżący zapis Prisma w milisekundach oraz tekstowe daty z baz historycznych.
- Task 5 nie jest udawany: nie powstał upload ani endpoint fałszywej weryfikacji.

## Checkpoint interfejsu

- Cel: decyzje odpowiedzialności i opłaty są widoczne przy karcie montażu, bez ukrywania ich w osobnym procesie.
- Warstwy: panel opiekunów i panel opłaty używają istniejącej spokojnej powierzchni karty (`--wd-white`, piaskowe statusy, grafit, bursztynowy akcent), z wyraźnym stanem decyzji i komunikatem, że opłata nie jest automatyczna.
- Publiczny formularz pozostał niezależny od dashboardu: spokojna, mobilna karta z checkboxem jako końcową czynnością, bez promowania zdjęć/uploadu.

## RED → GREEN i dowody

1. Unit/integration: walidacja dat odrzuca `null` i pusty string (bez epoch z `z.coerce.date`), właściciele muszą być aktywni i różni, delegacja jest ograniczona czasowo oraz audytowana. Kwoty są kanonicznymi centami tekstowymi (bez `Number`).
2. Integracja SQLite: formularz wysłany bez opłaty staje się niegotowy do planowania po późniejszym wybraniu zatwierdzonej opłaty, a wraca do gotowości dopiero po akceptacji klienta. Dwa równoległe potwierdzenia tworzą jeden zapis i jeden bezpieczny audyt.
3. Integracja SQLite: mismatch zatwierdzony przez primary/backup nadal nie tworzy billing task bez `VERIFIED_PRIVATE_FILE`; bezpośredni zapis do bazy jest odrzucany dla każdego brakującego elementu migawki i dowodu.
4. Migracja: test realnego deploy od 20-migracyjnej bazy legacy oraz fresh chain 29 migracji potwierdza `foreign_key_check`, `integrity_check` i komplet triggerów governance. Legalne rekordy `VERIFIED` utworzone przed migracją dowodzą, że po billing task nie można obniżyć statusu dowodu, zmienić migawki zlecenia ani wyzerować akceptacji; nowe próby INSERT/UPDATE `VERIFIED` są odrzucane. Oddzielne próby bezpośredniego INSERT i UPDATE billing z przyszłą datą prawną również kończą się odrzuceniem.
5. Integracja SQLite: zaakceptowana migawka nie może zmienić nawet samego tekstu. Zmiana przed billingiem jest możliwa wyłącznie z jednoczesnym wyzerowaniem `acceptedAt`, hasha IP i user-agenta; po billing task odrzucana jest zarówno zmiana, jak i samo wyzerowanie tych pól.
6. E2E Chromium: administrator wybiera domyślną kwotę, tworzy i kończy delegację na datach liczonych względem bieżącego czasu, delegat traci dostęp po zakończeniu, zastępca edytuje kartę, a klient nie wyśle formularza bez checkboxa. Między zaznaczeniem checkboxa i pierwszym POST test zmienia sam tekst klauzuli przy tej samej kwocie i wersji: serwer zwraca konflikt, nie zapisuje `acceptedAt`, ekran pokazuje nową treść i wymaga ponownego zaznaczenia. Drugi scenariusz wysyła formularz bez opłaty, wybiera opłatę później i pozwala klientowi potwierdzić ją bez korekty formularza. Brak zatwierdzenia prawnego nie pokazuje checkboxa. Ważność linków i lokalne wartości `datetime-local` są wyliczane względem `Date.now()`, więc testy nie wygasają wraz z kalendarzem ani zmianą strefy czasowej.
7. E2E używa pojedynczego globalnego przygotowania SQLite i jednego workera: migracje i seed wykonują się raz przed suite, a scenariusze mają unikalne dane. Dzięki temu uruchomienie pełnej bramki nie wymienia pliku bazy spod działającego serwera Prisma.

## Bramka końcowa

- `npm test`: GREEN — 83 pliki / 482 testy.
- `npx playwright test --project=chromium`: GREEN — 9 scenariuszy Chromium; dwa scenariusze governance obejmują konflikt pełnej migawki i opłatę wybraną po submit.
- `npm run build`: GREEN — 134 tras, w tym dynamiczne trasy Task 4 z `params: Promise`.
- ESLint plików Task 4: GREEN. Globalne `npm run lint` nadal zgłasza istniejące błędy poza zakresem (m.in. wygenerowany Prisma i komponenty finansowo-HR); nie zostały one ukryte ani zmienione w tym zadaniu.

## Warunek wdrożenia w Coolify dla metadanych IP

- Domyślnie aplikacja ignoruje `X-Forwarded-For` oraz `X-Real-IP`; publiczny klient może je sfałszować.
- `INSTALLATION_TRUSTED_CLIENT_IP_HEADER` można ustawić dopiero po skonfigurowaniu ingress/proxy tak, aby usuwał każdą wartość tego nagłówka dostarczoną przez klienta i zawsze nadpisywał ją dokładnie jednym poprawnym IP. Brak lub wielowartościowy/niepoprawny skonfigurowany nagłówek jest odrzucany.
- Hash używa `INSTALLATION_IP_HASH_SECRET`; gdy nie ustawiono osobnego sekretu, używa wymaganego produkcyjnego `NEXTAUTH_SECRET`. Żaden sekret ani surowe IP nie trafia do dokumentacji lub audytu.
