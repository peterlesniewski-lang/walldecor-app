# Task 4 — opiekun, delegacja i klauzula podjazdu

Data: 2026-08-22

## Zakres dostarczony

- Karta ma zawsze dwóch różnych, aktywnych opiekunów. Tylko administrator lub manager może audytowanie zmienić primary/backup.
- Administrator lub manager ustanawia delegację z początkiem, końcem i powodem oraz może ją zakończyć wcześniej. Dostęp pracownika-delegata wynika wyłącznie z tych dat, nie z urlopów.
- Firma tworzy wersje polityki opłaty za podjazd. Wersja bez `legalApprovedAt` pozostaje nieaktywna: nie można jej wybrać do karty i nie pojawia się w formularzu klienta. Nie dodano automatycznej treści prawnej ani seeda zatwierdzenia.
- Opiekun, zastępca albo aktywny delegat może wybrać zatwierdzoną domyślną kwotę. Inna kwota trafia do `PENDING_APPROVAL`, a decyzję podejmuje wyłącznie administrator/manager.
- Publiczny formularz pokazuje dokładną zatwierdzoną kwotę i wymaga checkboxa przed wysłaniem. Zapisuje czas przyjęcia, wersję klauzuli z migawki zlecenia, SHA-256 adresu IP i user-agent.
- `InstallationMismatch` wymaga opisu, powodu (`CANNOT_PERFORM` albo `EXECUTION_RISK`) i zweryfikowanej referencji dowodu. Zadanie rozliczeniowe powstaje wyłącznie po decyzji koordynatora i tylko wtedy, gdy opłata jest zatwierdzona prawnie, zaakceptowana przez klienta, a kwota zadania jest identyczna z migawką zlecenia.

## Integralność i granice

- Migracja dodaje FK dla mismatch/billing oraz sześć triggerów SQLite. Triggery chronią referencję `visitFeePolicyId` w addytywnie zmienianej tabeli `InstallationOrder`, więc nie można zapisać osieroconej polityki ani usunąć/zmienić ID polityki użytej przez kartę.
- Trigger billingowy odrzuca `MISMATCH_VISIT_FEE` z pustym `mismatchId`, bez zatwierdzenia koordynatora, bez akceptacji klienta albo z inną kwotą.
- Task 5 nie jest udawany: nie powstał upload. Model przyjmuje tylko `evidenceReference`, czyli już zweryfikowane odwołanie do dowodu.

## Checkpoint interfejsu

- Cel: decyzje odpowiedzialności i opłaty są widoczne przy karcie montażu, bez ukrywania ich w osobnym procesie.
- Warstwy: panel opiekunów i panel opłaty używają istniejącej spokojnej powierzchni karty (`--wd-white`, piaskowe statusy, grafit, bursztynowy akcent), z wyraźnym stanem decyzji i komunikatem, że opłata nie jest automatyczna.
- Publiczny formularz pozostał niezależny od dashboardu: spokojna, mobilna karta z checkboxem jako końcową czynnością, bez promowania zdjęć/uploadu.

## RED → GREEN i dowody

1. Unit/integration: walidacja dat odrzuca `null` i pusty string (bez epoch z `z.coerce.date`), właściciele muszą być aktywni i różni, delegacja jest ograniczona czasowo oraz audytowana. Kwoty są kanonicznymi centami tekstowymi (bez `Number`).
2. Integracja SQLite: testuje pełny wybór polityki, akceptację klienta, `PENDING_APPROVAL`, mismatch/billing oraz negatywne zapisy osieroconej polityki i billing bez `mismatchId`.
3. Migracja: test realnego deploy od 20-migracyjnej bazy legacy oraz fresh chain 26 migracji potwierdza `foreign_key_check`, `integrity_check` i komplet triggerów governance.
4. E2E Chromium: administrator wybiera domyślną kwotę, tworzy i kończy delegację, delegat traci dostęp po zakończeniu, zastępca edytuje kartę, a klient nie wyśle formularza bez checkboxa. Drugi link z brakiem zatwierdzenia prawnego nie pokazuje checkboxa.

## Bramka końcowa

- `npm test`: GREEN — 80 plików / 453 testy.
- `npx playwright test e2e/installations-governance.spec.ts`: GREEN — 1 scenariusz Chromium.
- `npm run build`: GREEN — 134 tras, w tym dynamiczne trasy Task 4 z `params: Promise`.
- ESLint plików Task 4: GREEN. Globalne `npm run lint` nadal zgłasza istniejące błędy poza zakresem (m.in. wygenerowany Prisma i komponenty finansowo-HR); nie zostały one ukryte ani zmienione w tym zadaniu.
