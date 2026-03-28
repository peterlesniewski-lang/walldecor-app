# WallDecor App — Przewodnik użytkownika

> Aplikacja dostępna pod adresem: **https://app.walldecor.pl**

---

## 🔑 Logowanie

Otwórz adres https://app.walldecor.pl — zostaniesz automatycznie przekierowany na stronę logowania.

Wpisz **adres e-mail** i **hasło**, następnie kliknij **Zaloguj się**.

**Domyślne konto administratora (pierwsze uruchomienie):**
- E-mail: `admin@walldecor.pl`
- Hasło: `ChangeMe123!`

> Zmień hasło administratora natychmiast po pierwszym zalogowaniu — przejdź do Ustawienia → Twoje konto.

Jeśli nie pamiętasz hasła, skontaktuj się z administratorem systemu — może je zresetować w Ustawienia → Użytkownicy i dostęp.

---

## 🗺 Nawigacja

Lewy pasek boczny zawiera wszystkie moduły aplikacji:

| Sekcja | Co znajdziesz |
|---|---|
| **Dashboard** | Przegląd KPI, najważniejsze wskaźniki finansowe, alerty |
| **Finanse** | Budżet, wykonanie kosztów, przychody, alerty finansowe |
| **HR** | Pracownicy, czas pracy, urlopy, raporty |
| **Powiadomienia** | Alerty finansowe, oczekujące wnioski urlopowe |
| **Ustawienia** | Konfiguracja aplikacji, zarządzanie użytkownikami |

---

## 👥 Role i uprawnienia

Każdy użytkownik ma przypisaną jedną z trzech ról. Rola decyduje o tym, co widzisz i co możesz edytować.

| Funkcja | Admin | Manager | Pracownik |
|---|---|---|---|
| Ustawianie budżetu | ✅ | ❌ | ❌ |
| Wykonanie kosztów — wszystkie lokale | ✅ | ✅ (widok) | ❌ |
| Wykonanie kosztów — własny lokal | ✅ | ✅ | ✅ (obrót + wybrane koszty) |
| Dane płacowe pracowników | ✅ | ❌ | ❌ |
| Dane HR wszystkich pracowników | ✅ | ✅ (bez płac) | ❌ |
| Własne dane HR | ✅ | ✅ | ✅ |
| Dodawanie i edycja pracowników | ✅ | ❌ | ❌ |
| Wnioski urlopowe — składanie | ✅ | ✅ | ✅ |
| Wnioski urlopowe — zatwierdzanie | ✅ | ✅ | ❌ |
| Ewidencja czasu pracy — edycja | ✅ | ✅ | ❌ |
| Zarządzanie użytkownikami | ✅ | ❌ | ❌ |
| Ustawienia aplikacji | ✅ | ❌ | ❌ |

---

## 💰 Moduł Finansowy

### Dashboard KPI

`Finanse` (strona główna modułu)

Strona pokazuje kluczowe wskaźniki w formie kart z sygnalizacją świetlną:

- **Zielony** — wynik w normie, poniżej progu alarmowego
- **Żółty** — zbliżasz się do limitu budżetu, warto zwrócić uwagę
- **Czerwony** — przekroczony budżet lub próg alarmowy

Widoczne są dane per centrum kosztów: **JAG** (Salon Jagiellońska), **PUL** (Salon Puławska + eCommerce), **GLOBAL** (koszty centralne).

---

### Budżet

`Finanse → Budżet`

Budżet ustalany jest raz na rok przez Administratora, podzielony na 12 miesięcy. Pracownicy i Managerowie mogą go przeglądać, ale nie edytować.

**Jak wpisać lub zaktualizować budżet (Admin):**

1. Przejdź do `Finanse → Budżet`
2. Wybierz **centrum kosztów** (JAG / PUL / GLOBAL) z zakładek u góry
3. Wybierz **rok budżetowy**
4. Kliknij komórkę w siatce przy wybranej kategorii kosztów i miesiącu
5. Wpisz kwotę w PLN i naciśnij Enter lub kliknij poza komórką — dane zapisują się automatycznie

Kategorie kosztów są predefiniowane (np. Customer Acquisition, Cost of Service, Office/General Administrative). Nie możesz ich usunąć, możesz natomiast wpisać 0 dla kategorii nieużywanych.

---

### Wykonanie kosztów

`Finanse → Wykonanie`

Tu wpisuje się rzeczywiste koszty poniesione w danym miesiącu.

**Jak wprowadzić wykonanie (Admin/Manager/Pracownik dla własnego lokalu):**

1. Przejdź do `Finanse → Wykonanie`
2. Wybierz **centrum kosztów** i **miesiąc**
3. Kliknij komórkę przy kategorii kosztów — wpisz kwotę
4. Zmiany zapisują się automatycznie po kliknięciu poza komórkę

Obok każdej wartości widoczne jest porównanie z budżetem (plan vs actual). Przekroczenia budżetu są wyróżnione kolorem.

---

### Przychody

`Finanse → Przychody`

Moduł przychodów działa analogicznie do wykonania kosztów — masz siatkę miesięcy z podziałem na:

- **Plan** — przychód zabudżetowany
- **Actual** — rzeczywisty przychód

Ecommerce jest zawsze przypisany do centrum kosztów **PUL**.

**Jak wpisać przychód:**

1. Przejdź do `Finanse → Przychody`
2. Wybierz centrum kosztów i rok
3. Kliknij komórkę przy odpowiednim miesiącu w wierszu "Actual"
4. Wpisz kwotę i zatwierdź

---

### Alerty finansowe

`Finanse → Alerty`

Alerty informują o przekroczeniu progów budżetowych i zbliżających się terminach płatności.

**Jak skonfigurować próg alertu (Admin):**

1. Przejdź do `Finanse → Alerty`
2. Kliknij przycisk **Dodaj próg** lub ikony ustawień przy istniejącym alercie
3. Wybierz kategorię kosztów, centrum kosztów i wartość progu (w % lub PLN)
4. Zapisz — system będzie generował alerty gdy wykonanie przekroczy próg

Alerty pojawiają się również w sekcji **Powiadomienia** w pasku bocznym oraz na głównym dashboardzie (czerwone lub żółte wskaźniki KPI).

---

## 👔 Moduł HR

### Pracownicy

`HR → Pracownicy`

Lista wszystkich aktywnych pracowników z podstawowymi danymi: imię, nazwisko, stanowisko, centrum kosztów, typ zatrudnienia.

#### Dodawanie pracownika (Admin)

1. Przejdź do `HR → Pracownicy`
2. Kliknij przycisk **Dodaj pracownika** (prawy górny róg)
3. Wypełnij formularz w 3 krokach:
   - **Krok 1 — Dane podstawowe:** imię, nazwisko, e-mail, data zatrudnienia, typ zatrudnienia (UoP / B2B / UZ)
   - **Krok 2 — Przypisanie organizacyjne:** centrum kosztów (JAG / PUL / GLOBAL), oddział, dział, stanowisko
   - **Krok 3 — Dane dodatkowe:** opcjonalne informacje kontaktowe i uwagi
4. Kliknij **Zapisz** — pracownik pojawi się na liście

> Pole "Centrum kosztów" jest wymagane — bez niego formularz nie zostanie zapisany.

#### Podgląd i edycja danych pracownika (Admin)

1. Przejdź do `HR → Pracownicy`
2. Kliknij nazwisko pracownika na liście, aby otworzyć jego kartę
3. Aby edytować — kliknij przycisk **Edytuj** (lub menu `...` → **Edytuj**) w prawym górnym rogu karty
4. Zmień potrzebne pola i kliknij **Zapisz zmiany**

#### Ukrywanie pracownika (Admin)

Ukrycie (dezaktywacja) to **zalecana metoda** zakończenia współpracy — pracownik znika z list aktywnych, ale jego historia (wpisy czasu pracy, wnioski urlopowe) zostaje zachowana w bazie.

Usunięcie jest trwałe — używaj go tylko dla błędnie dodanych wpisów, nie dla byłych pracowników.

Aby ukryć pracownika:
1. Otwórz kartę pracownika (`HR → Pracownicy → kliknij pracownika`)
2. Kliknij menu `...` → **Dezaktywuj pracownika**
3. Potwierdź operację

#### Struktura organizacyjna

`HR → Pracownicy → Struktura`

Widok drzewa pokazuje strukturę oddziałów (Oddział Jagiellońska, Oddział Puławska) z działami i przypisanymi pracownikami.

---

### Ewidencja czasu pracy

`HR → Czas pracy`

Siatka miesięczna: wiersze = pracownicy, kolumny = dni miesiąca. Każda komórka to wpis godzin danego dnia.

#### Dodawanie wpisu (Manager/Admin)

1. Przejdź do `HR → Czas pracy`
2. Wybierz **miesiąc** i **centrum kosztów** (lub widok wszystkich)
3. Kliknij **komórkę** przy pracowniku i wybranym dniu
4. W panelu/dialogu wpisz godzinę **od** i **do** (np. 11:00 – 19:00)
5. Kliknij **Zapisz**

Godziny standardowe: **11:00–19:00** (pon.–pt.), **11:00–14:00** (sobota).

#### Soboty jako nadgodziny

Soboty są automatycznie liczone jako nadgodziny (stawka 2×) i wyróżnione **pomarańczowym kolorem** w siatce.

Aby soboty były dostępne jako klikalne komórki, muszą być włączone w ustawieniach:
`Ustawienia → Moduł HR → Soboty jako dni robocze` — przełącz opcję na aktywną.

#### Zbiorcze zatwierdzanie wpisów

1. Zaznacz checkboxy przy wybranych wpisach (lub pracownikach)
2. Na dole ekranu pojawi się **pływający pasek akcji** (floating action bar)
3. Kliknij **Zatwierdź zaznaczone** — status wpisów zmieni się na "zatwierdzony"

Zatwierdzone wpisy są oznaczone zielonym kolorem i nie mogą być dalej edytowane bez cofnięcia zatwierdzenia.

#### Zestawienie nadgodzin

`HR → Czas pracy → Nadgodziny`

Widok sumaryczny nadgodzin per pracownik za wybrany okres. Nadgodziny są liczone automatycznie gdy dzienna suma godzin przekracza 8h lub gdy wpis dotyczy soboty.

#### Okresy rozliczeniowe

`HR → Czas pracy → Okresy`

Zarządzanie zamkniętymi okresami rozliczeniowymi (miesięcznymi). Zamknięty okres blokuje edycję wpisów.

#### Harmonogram

`HR → Czas pracy → Harmonogram`

Widok kalendarza z zaplanowanymi zmianami i obecnościami.

#### Raporty

`HR → Czas pracy → Raporty`

Dostępnych jest kilka typów raportów:

| Typ raportu | Opis |
|---|---|
| Podsumowanie miesięczne | Godziny per pracownik w danym miesiącu |
| Nadgodziny | Wykaz nadgodzin z podziałem na typ (dobowe / sobotnię) |
| Nieobecności | Zestawienie urlopów i zwolnień |
| Frekwencja | % obecności per pracownik |
| Czas pracy wg projektu | Rozbicie na projekty (jeśli przypisane) |
| Raport PDF | Miesięczny wydruk dla pracownika lub całego zespołu |

**Jak wygenerować raport PDF:**

1. Przejdź do `HR → Czas pracy → Raporty`
2. Wybierz zakładkę **Raport PDF**
3. Wybierz miesiąc i pracownika (lub "Wszyscy")
4. Kliknij **Generuj** — plik PDF zostanie pobrany automatycznie

---

### Urlopy

`HR → Urlopy`

#### Typy urlopów

Aplikacja obsługuje 14 typów absencji, m.in.:

- **Urlop wypoczynkowy (VL)** — limit 26 dni/rok, wymaga zatwierdzenia
- **Urlop na żądanie (VLD)** — do 4 dni/rok, bez zatwierdzenia (pula wliczona w VL)
- **Zwolnienie chorobowe (SL)** — bez limitu, bez zatwierdzenia
- **Praca zdalna (RW)** — wymaga zatwierdzenia
- **Okazjonalna praca zdalna (RWO)** — do 24 dni/rok, bez zatwierdzenia
- **Delegacja (DEL)** — wymaga zatwierdzenia
- **Urlop macierzyński (ML)** i **tacierzyński (PL)** — wymagają zatwierdzenia
- **Urlop opiekuńczy (UO)** — do 5 dni/rok, bezpłatny
- **Czas wolny za nadgodziny (OT)** — wymaga zatwierdzenia

#### Składanie wniosku (Pracownik/Manager/Admin)

1. Przejdź do `HR → Urlopy`
2. Kliknij przycisk **Złóż wniosek**
3. Wybierz **typ urlopu** z listy
4. Wskaż **daty od–do** — system automatycznie policzy dni robocze (z wyłączeniem weekendów i polskich świąt)
5. Opcjonalnie dodaj **komentarz/uwagi**
6. Kliknij **Wyślij wniosek**

Wniosek trafia do statusu **Oczekujący** i widoczny jest dla Managera/Admina.

> Jeśli liczba dni przekracza dostępne saldo, system zablokuje złożenie wniosku.

#### Zatwierdzanie wniosku (Manager/Admin)

1. Przejdź do `HR → Urlopy → Zatwierdzanie` lub kliknij powiadomienie w sekcji **Powiadomienia**
2. Na liście oczekujących wniosków znajdź właściwy wpis
3. Kliknij **Zatwierdź** lub **Odrzuć**
4. W przypadku odrzucenia możesz dodać powód w polu komentarza
5. Pracownik otrzymuje powiadomienie o decyzji, a saldo urlopowe jest automatycznie aktualizowane

#### Ręczne dodanie urlopu (Admin)

Gdy urlop już się odbył lub trzeba wpisać go z datą wsteczną:

1. Przejdź do `HR → Urlopy`
2. Kliknij przycisk **Dodaj urlop** (dostępny tylko dla Admina)
3. Wybierz **pracownika** z listy, typ urlopu i daty
4. Zapisz — wpis pojawi się w historii pracownika bez wymogu zatwierdzenia

#### Saldo urlopowe

`HR → Urlopy → Salda`

Tabela z saldami urlopowymi dla każdego pracownika na dany rok:

- **Łącznie** — przyznany limit na rok (np. 26 dni VL)
- **Wykorzystano** — dni już wzięte (zatwierdzone wnioski)
- **Oczekujące** — dni z wniosków w statusie "Oczekujący"
- **Dostępne** — pozostały limit (Łącznie − Wykorzystano − Oczekujące)
- **Przeniesienie** — dni przeniesione z poprzedniego roku (carryover)

Admin może ręcznie korygować saldo (np. po pomyłce lub na podstawie decyzji właściciela) — kliknij ikonę edycji przy wybranym pracowniku i roku.

#### Moje wnioski

`HR → Urlopy → Moje wnioski`

Każdy pracownik widzi tutaj historię swoich wniosków z aktualnymi statusami (Oczekujący / Zatwierdzony / Odrzucony).

---

## ⚙️ Ustawienia

### Moduł HR

`Ustawienia → Moduł HR`

| Opcja | Opis |
|---|---|
| Soboty jako dni robocze | Włącza/wyłącza sobotę jako klikalny dzień w siatce czasu pracy |
| Standardowy czas pracy | Dzienny limit godzin (domyślnie 8h) — powyżej tej wartości liczą się nadgodziny |
| Próg nadgodzin | Minimalna liczba godzin/dzień od której startują nadgodziny (domyślnie 8h) |
| Godziny standardowe | Domyślne godziny zmian dla salonów (11:00–19:00 pon.–pt., 11:00–14:00 sob.) |

### Użytkownicy i dostęp (Admin)

`Ustawienia → Użytkownicy i dostęp`

**Tworzenie nowego konta użytkownika:**

1. Kliknij **Dodaj użytkownika**
2. Wpisz imię, nazwisko, e-mail i wybierz rolę (Admin / Manager / Pracownik)
3. Ustaw hasło tymczasowe (użytkownik powinien je zmienić po pierwszym logowaniu)
4. Kliknij **Zapisz**

**Zmiana roli użytkownika:**

1. Znajdź użytkownika na liście
2. Kliknij ikonę edycji lub menu `...` → **Edytuj**
3. Zmień wartość pola "Rola" i zapisz

**Blokowanie / odblokowywanie konta:**

1. Znajdź użytkownika na liście
2. Kliknij menu `...` → **Zablokuj konto** lub **Odblokuj konto**
3. Zablokowany użytkownik nie może się zalogować, ale jego dane pozostają w systemie

**Reset hasła:**

1. Znajdź użytkownika na liście
2. Kliknij menu `...` → **Resetuj hasło**
3. Wpisz nowe hasło tymczasowe i wyślij je użytkownikowi poza systemem

---

## ❓ Najczęstsze pytania (FAQ)

**Nie mogę zapisać danych pracownika — pojawia się "Invalid input"**
→ Sprawdź czy pole **"Centrum kosztów"** jest wypełnione (wymagane). Sprawdź też czy adres e-mail nie jest już zajęty przez innego pracownika.

**Nie widzę przycisku "Dodaj pracownika"**
→ Ta funkcja dostępna jest tylko dla Administratora. Jeśli jesteś Adminem i nadal nie widzisz przycisku — odśwież stronę lub skontaktuj się z administratorem systemu.

**Pracownik nie może się zalogować**
→ Admin może sprawdzić status konta w `Ustawienia → Użytkownicy i dostęp`. Upewnij się, że konto istnieje, nie jest zablokowane i że adres e-mail jest poprawny.

**Chcę dodać godziny w sobotę, ale komórka jest nieaktywna**
→ W `Ustawienia → Moduł HR` włącz opcję **"Soboty jako dni robocze"**. Bez tego soboty są wyszarzone i nieaktywne.

**Jak wygenerować raport miesięczny PDF?**
→ `HR → Czas pracy → Raporty` → zakładka **"Raport PDF"** → wybierz miesiąc i pracownika → kliknij **Generuj**.

**Wniosek urlopowy przekracza saldo**
→ System automatycznie blokuje złożenie wniosku. Admin może ręcznie skorygować saldo w `HR → Urlopy → Salda` — kliknij ikonę edycji przy pracowniku i zmień wartość.

**Jak sprawdzić ile urlopu zostało pracownikowi?**
→ Przejdź do `HR → Urlopy → Salda` — widzisz tam aktualne saldo wszystkich pracowników z podziałem na rok i typ urlopu.

**Nie widzę danych finansowych drugiego salonu**
→ Upewnij się, że masz rolę Manager lub Admin. Pracownicy widzą dane tylko swojego lokalu.

**Jak zmienić hasło?**
→ Po zalogowaniu kliknij swoje imię/awatar w prawym górnym rogu → **Twoje konto** → **Zmień hasło**.

**Co oznacza czerwony wskaźnik na dashboardzie?**
→ Przekroczony próg budżetowy lub alerty finansowe wymagające uwagi. Kliknij wskaźnik, aby przejść do szczegółów w `Finanse → Alerty`.

**Praca zdalna — czy wymaga zatwierdzenia?**
→ Tak, "Praca zdalna (RW)" wymaga zatwierdzenia. "Okazjonalna praca zdalna (RWO)" — do 24 dni/rok — nie wymaga zatwierdzenia.

**Gdzie widzę polskie święta w kalendarzu urlopowym?**
→ System ma wbudowane polskie święta na lata 2025–2026. Są automatycznie pomijane przy obliczaniu dni roboczych we wnioskach urlopowych.

---

## 📞 Kontakt i wsparcie

W razie problemów technicznych skontaktuj się z administratorem systemu.

Aplikacja wdrożona na: https://app.walldecor.pl
