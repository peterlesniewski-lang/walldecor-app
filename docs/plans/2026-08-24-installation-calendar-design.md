# Integracja kart montażu z Google Calendar — projekt

**Status:** zaakceptowany przez właściciela produktu 2026-08-24  
**Gałąź:** `feature/installation-calendar`  
**Baza:** `feature/installation-operations` (`e4af584`)

## Cel

Moduł ma zamienić terminy zapisane przy karcie montażu w kontrolowane wydarzenia
firmowego Google Calendar. Aplikacja WallDecor pozostaje źródłem prawdy, a kalendarz
jest zsynchronizowaną kopią operacyjną dla pracowników i instalatorów.

Rozwiązanie musi obsłużyć:

- wiele wizyt w jednym zleceniu;
- różnych instalatorów przypisanych do różnych zakresów prac;
- kilka osób uczestniczących w tej samej wizycie;
- wizytę bez ustalonego terminu;
- zmianę terminu bez tworzenia duplikatu wydarzenia;
- anulowanie z zachowaniem historii w aplikacji;
- awarie i konflikty Google bez utraty zmiany użytkownika;
- czytelne linki oraz statusy na liście kart i na szczegółach zlecenia.

## Poza zakresem

- synchronizacja zmian z Google Calendar z powrotem do aplikacji;
- wysyłka Gmail i historia korespondencji — ten zakres zostaje przy przyszłej
  integracji z Twenty CRM;
- zapraszanie klienta do wydarzenia;
- automatyczne planowanie terminu na podstawie dostępności instalatorów;
- wdrożenie produkcyjne bez wcześniejszego testu na oddzielnym kalendarzu.

## Decyzje produktowe

1. Termin tworzy i zmienia pracownik w aplikacji WallDecor.
2. Jedna wizyta odpowiada dokładnie jednemu wydarzeniu Google.
3. Zmiana daty, godzin, zakresów lub uczestników aktualizuje to samo wydarzenie.
4. Ręczna zmiana wydarzenia w Google nie zmienia danych aplikacji.
5. Konflikt po ręcznej zmianie nie jest nadpisywany po cichu. Użytkownik otrzymuje
   akcję `Przywróć dane z aplikacji do Google`.
6. Wizyta może istnieć bez daty jako szkic organizacyjny. Nie trafia wtedy do Google.
7. Zaproszenia otrzymują tylko instalatorzy przypisani do zakresów tej wizyty i
   posiadający adres e-mail.
8. Organizatorem wydarzenia jest `info@walldecor.pl`.

## Model interfejsu

### Lista kart montażu

Każda karta na `/installations` pokazuje:

- najbliższą aktywną wizytę albo stan `Termin nieustalony`;
- skrócony status kalendarza: `Nie wysłano`, `Oczekuje`, `Zsynchronizowano` lub
  `Wymaga uwagi`;
- widoczny link `Wizyty i terminy`, prowadzący do sekcji wizyt na szczegółach karty.

Link nie może zależeć od ręcznego wpisania adresu podstrony. Musi być dostępny
zarówno na desktopie, jak i w układzie mobilnym.

### Szczegóły karty

Na stronie zlecenia powstaje sekcja z trwałym identyfikatorem kotwicy `visits` i
nagłówkiem `Wizyty i terminy`. Nawigacja karty zawiera link do tej sekcji.

Lista wizyt pokazuje:

- datę oraz godziny początku i końca w czasie polskim;
- status wizyty: `Szkic`, `Potwierdzona`, `Anulowana`, `Zakończona`;
- wybrane zakresy prac;
- instalatorów wynikających z przypisań do tych zakresów;
- status synchronizacji i ostatnią udaną synchronizację;
- link `Otwórz w Google Calendar`, gdy Google zwróci adres wydarzenia;
- ostrzeżenie przy instalatorze bez adresu e-mail;
- czytelny komunikat i akcję naprawczą w stanie `Wymaga uwagi`.

Akcje użytkownika:

- `Dodaj wizytę`;
- `Zapisz szkic`;
- `Potwierdź i wyślij zaproszenia`;
- `Zmień termin lub ekipę`;
- `Anuluj wizytę`;
- `Otwórz w Google Calendar`;
- `Ponów synchronizację`;
- `Przywróć dane z aplikacji do Google` po konflikcie.

## Model danych

Nazwy są projektowe; ostateczna migracja może dopasować je do istniejących
konwencji Prisma bez zmiany zachowania.

### `InstallationVisit`

- relacja do `InstallationOrder`;
- status domenowy;
- opcjonalne `startsAt` i `endsAt` przechowywane w UTC;
- prezentacyjna strefa `Europe/Warsaw`;
- notatka organizacyjna;
- numer rewizji służący do odrzucania starych zadań synchronizacji;
- daty potwierdzenia, anulowania i zakończenia.

### `InstallationVisitScope`

Relacja wiele-do-wielu między wizytą i zakresem zlecenia. Pozwala rozdzielić
tapety, sztukaterię lub inne prace na osobne wizyty.

### `InstallationScopeAssignment`

Przypisanie instalatora do zakresu. Uczestnicy wydarzenia są unią aktywnych
przypisań dla zakresów wybranych w danej wizycie. Ten sam adres e-mail jest
wysyłany do Google tylko raz.

### Stan integracji

Stan synchronizacji przechowuje co najmniej:

- identyfikator wydarzenia Google;
- link HTML wydarzenia;
- ostatni znany `etag`;
- status: `NOT_REQUESTED`, `PENDING`, `SYNCED`, `ATTENTION`;
- datę ostatniej próby i ostatniego sukcesu;
- bezpieczny kod błędu oraz komunikat dla pracownika bez sekretów.

### Trwały outbox

Zmiana domenowa i zadanie integracyjne powstają w jednej transakcji. Zadania
obejmują `CALENDAR_UPSERT` oraz `CALENDAR_CANCEL`. Outbox posiada dzierżawę,
licznik prób, termin kolejnej próby i stan końcowy. Ponowienie tego samego zadania
nie może tworzyć drugiego wydarzenia.

## Przepływ synchronizacji

1. Szkic bez terminu zapisuje się wyłącznie w bazie.
2. Potwierdzenie kompletnej wizyty zapisuje rewizję wizyty i `CALENDAR_UPSERT`.
3. Worker pobiera zadanie po commicie transakcji.
4. Adapter Google działa przez konto techniczne z delegowaniem dostępu i
   podszyciem wyłącznie pod `info@walldecor.pl`.
5. Utworzone wydarzenie otrzymuje stabilny identyfikator oraz prywatną właściwość
   zawierającą identyfikator wizyty WallDecor.
6. Google zwraca identyfikator, link i `etag`; aplikacja zapisuje je w stanie
   synchronizacji.
7. Kolejne zmiany używają aktualizacji istniejącego wydarzenia i pełnej,
   zduplikowanej listy uczestników.
8. Anulowanie pozostawia wizytę w historii aplikacji i wysyła anulowanie
   uczestnikom w Google.

Tytuł wydarzenia powinien być krótki i rozpoznawalny, np.
`Montaż MON-… — Klient`. Opis zawiera adres, zakresy i link do karty montażu.
Nie zawiera odpowiedzi formularza klienta, kwot ani prywatnych notatek.

## Autoryzacja i konfiguracja

Wybrany wariant to konto techniczne Google Cloud z delegowaniem w całej domenie.
Konto `info@walldecor.pl` ma potwierdzoną rolę Superadministratora Google
Workspace.

Sekrety są przechowywane wyłącznie jako chronione zmienne środowiskowe Coolify.
Baza danych może przechowywać tylko niesekretne identyfikatory konfiguracji.

Minimalna konfiguracja obejmuje:

- identyfikator projektu i konta technicznego Google;
- prywatny klucz konta technicznego;
- użytkownika delegowanego `info@walldecor.pl`;
- identyfikator aktywnego kalendarza;
- przełącznik funkcji;
- wybór adaptera `fake` albo `google`.

Delegacja otrzymuje najmniejszy potrzebny zakres Calendar API. Klucze, tokeny,
pełne odpowiedzi API i kolekcje zmiennych środowiskowych nie mogą trafiać do
logów, bazy ani repozytorium.

## Błędy i konflikty

- Błędy przejściowe i limity Google są ponawiane z narastającym opóźnieniem.
- Błąd uprawnień przechodzi do `ATTENTION` bez nieskończonych prób.
- Nieaktualny `etag` oznacza konflikt. Worker nie nadpisuje zmiany po cichu.
- Akcja `Przywróć dane z aplikacji do Google` pobiera aktualny stan wydarzenia i
  wykonuje świadome nadpisanie najnowszą rewizją aplikacji.
- Stare zadanie outboxa nie może nadpisać nowszej rewizji wizyty.
- Brak adresu e-mail instalatora nie blokuje potwierdzenia, ale jest widocznym
  ostrzeżeniem na formularzu i zapisanym ostrzeżeniem wizyty.
- Brak odpowiedzi Google nie może cofać poprawnie zapisanej zmiany domenowej.

## Testy akceptacyjne

### Testy domenowe i integracyjne

- szkic bez daty nie tworzy zadania Google;
- potwierdzenie tworzy dokładnie jedno zadanie;
- ponowienie oraz podwójne kliknięcie nie tworzą duplikatu;
- zmiana terminu aktualizuje identyczny `eventId`;
- anulowanie zapisuje historię i wysyła właściwe zadanie;
- uczestnicy są wyliczani z wielu zakresów i deduplikowani;
- brak e-maila daje ostrzeżenie, lecz nie blokuje pozostałych osób;
- czas polski jest poprawny przed i po zmianie czasu letniego;
- błędy przejściowe są ponawiane, a brak uprawnień kończy się `ATTENTION`;
- konflikt `etag` wymaga świadomej akcji pracownika;
- testowy adapter nie wykonuje żadnego połączenia z Google.

### E2E

Scenariusz referencyjny tworzy jedno zlecenie, dwa terminy i trzy osoby przypisane
do różnych zakresów. Użytkownik potwierdza wizyty, zmienia pierwszy termin i
sprawdza, że:

- karta na liście pokazuje najbliższy termin i link do sekcji;
- szczegóły pokazują oba terminy, uczestników i statusy;
- pierwsza wizyta nadal ma jeden, ten sam identyfikator wydarzenia;
- link `Otwórz w Google Calendar` pochodzi z zapisanego wyniku adaptera;
- anulowanie nie usuwa historii aplikacji.

## Uruchomienie

1. Kod powstaje z domyślnym adapterem `fake` i wyłączoną integracją Google.
2. Po zielonych testach tworzony jest pod kontem `info@walldecor.pl` dodatkowy
   kalendarz `TEST – Montaże`.
3. Konto techniczne i delegacja są konfigurowane wyłącznie dla potrzebnego zakresu.
4. Test dymny tworzy, zmienia i anuluje wydarzenie z testowymi uczestnikami.
5. Sprawdzamy stronę Google, zaproszenia, brak duplikatów, ponowienie oraz zapis
   stanu po restarcie aplikacji.
6. Dopiero po zapisaniu dowodów działania administrator zmienia identyfikator na
   firmowy kalendarz montaży i włącza integrację.

Samo przejście testów, status kontenera lub odpowiedź endpointu zdrowia nie jest
dowodem zakończenia integracji. Dowód końcowy obejmuje rzeczywiste wydarzenie,
aktualizację tego samego `eventId`, anulowanie, uczestników oraz stan widoczny w
interfejsie i bazie po restarcie.

