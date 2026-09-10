# Finanse rzeczywiste i kasa salonu — zatwierdzony kierunek

Użytkownik zatwierdził realizację 10.09.2026 po interaktywnej makiecie trzech widoków i dodaniu konfigurowalnej kasy stałej. Ten dokument konkretyzuje kontrakt wdrożenia. Zmiany lokalne; publikacja i uruchomienie kas wymagają osobnego odbioru.

## 1. Przychody

- Jeden miesięczny przychód rzeczywisty brutto po korektach na salon/kanał. Kolejny zapis **zastępuje** dotychczasową kwotę. Jawne zero nie oznacza braku danych; ujemna korekta jest dopuszczalna.
- Usunięcie planu sprzedaży z czynnych ekranów, importu i eksportu. Historycznych `RevenueBudget` nie kasujemy. Budżety kosztów pozostają bez zmian. Żądania zapisania planu są jawnie odrzucane, nigdy interpretowane jako wykonanie.
- Opcjonalne `Revenue.asOfDate` (ISO YYYY-MM-DD) opisuje stan narastający w danym miesiącu. Data musi należeć do miesiąca i nie wyprzedzać dzisiejszej daty w Warszawie. Stare wpisy pozostają bez daty; import bez daty nie zachowuje nieaktualnej daty poprzedniego wpisu.
- Edycja, odczyt, import, eksport dostępne administratorowi (zachować istniejący klucz integracyjny importu). Pusta kwota to brak, nie zero.

## 2. Dashboard

- `/` i `/dashboard` korzystają z jednego źródła i tego samego wyboru roku/miesiąca. Wynik orientacyjny brutto = zapisane rzeczywiste przychody minus rozpoznane rzeczywiste koszty danego okresu. Nigdy zastępowanie wykonania planem.
- Widoczne brakujące kanały, nieznane daty aktualności i bieżący niepełny miesiąc. Brak danych nie daje zielonego wyniku. Zapisane zero i strata nie uruchamiają żadnego fallbacku.
- Porównanie r/r wyłącznie z rzeczywistymi, porównywalnymi okresami. Nie porównujemy części bieżącego miesiąca z całym zeszłorocznym miesiącem. Sumy narastające tylko do wybranego miesiąca.
- Pełny miesiąc i porównanie wyniku r/r wymagają jawnego istniejącego potwierdzenia `FinancePeriodClose`, pełnych dat przychodów oraz braku aktywnych oczekujących faktur/zdarzeń kosztowych. Jeden koszt nie dowodzi kompletności. Zamknięcie z rzeczywiście zerowymi kosztami nie wymaga dopisywania fikcyjnego kosztu. Dashboard nie zamyka okresów automatycznie.
- Rozbicie PUL/JAG/GLOBAL wykorzystuje istniejące alokacje; brak nowego arbitralnego podziału kosztów wspólnych. Koszty oczekujące pokazane osobno, poza wynikiem.
- Stany rachunków są bieżącym stanem zarejestrowanych środków, nie wynikiem wybranego miesiąca. Depozyt salonu nie jest nowym przychodem ani dodatkowym rachunkiem.

## 3. Kasa salonu

### Dostęp i start

- Nowy ekran `/cashier`. Administrator widzi oba salony. Pracownik widzi wyłącznie PUL/JAG przypisany przez aktualny rekord `User.employeeId -> Employee.costCenterId`. Nieaktywni, nieprzypisani, GLOBAL, MANAGER i INSTALLER nie dostają dostępu. Każdy odczyt i zapis sprawdza aktualną bazę, nie samą rolę JWT.
- Ręczne uruchomienie per salon: data startu, policzona gotówka początkowa, docelowa kasa stała oraz jawne powiązanie z aktywnym rachunkiem gotówkowym PLN. Istniejący rachunek musi mieć saldo równe saldu otwarcia; nowy wymaga potwierdzenia, że środki nie są już wykazane gdzie indziej. Brak automatycznego przypisywania nazw sejfów lub importu Sheets.
- Nowe kwoty w bazie jako całkowite grosze. Integracja z dotychczasowym `CashAccount.balance` zaokrąglana do dwóch miejsc, z historią zmian w tej samej transakcji.

### Dzień pracy

- Jeden raport na salon i datę, najwyżej jeden otwarty na salon. Raporty chronologiczne, nie z przyszłości, od daty startu. Pominięte dni nie stają się raportami zerowymi.
- Otwarcie = faktycznie pozostawiona gotówka z ostatniego zamknięcia, a dla pierwszego raportu saldo uruchomienia.
- Pracownik wpisuje wpływy sprzedażowe gotówka/karta **przed osobno wpisanymi zwrotami i bez kaucji**, zgodnie z raportem źródłowym. Nie są one automatycznie dopisywane do miesięcznych przychodów. Przed uruchomieniem trzeba potwierdzić właściwe pola raportu Subiekta, aby nie odjąć zwrotów dwukrotnie.
- Operacje: zwrot sprzedaży, przyjęcie kaucji, zwrot kaucji; metoda gotówka/karta, dodatnia kwota, wymagany numer dokumentu/referencja. W otwartym raporcie można dodawać, edytować i anulować; historia zachowana, bez fizycznego kasowania.
- Oczekiwana gotówka = otwarcie + sprzedaż gotówkowa − zwroty gotówkowe + kaucje przyjęte gotówką − kaucje oddane gotówką.
- Niezależnie policzona gotówka; różnica = policzona − oczekiwana. Depozyt = max(policzona − cel kasy stałej, 0); pozostaje = min(policzona, cel); niedobór kasy stałej = max(cel − policzona, 0).
- Przykład: otwarcie 270, wpływy 1500, zwrot 200, kaucja +100 → 1670. Cel 300 → depozyt 1370, cel 250 → 1420. Zmiana celu nie zmienia fizycznej gotówki ani wyniku firmy.
- Zamknięcie wymaga obu kwot wpływów (zero wpisane jawnie), policzonej gotówki, potwierdzenia faktycznie pozostawionej kwoty i depozytu. Przy różnicy lub niedoborze wymagane wyjaśnienie. Nie wolno sztucznie podnieść gotówki do celu.
- Wersjonowanie zapobiega nadpisaniu cudzej zmiany. Zmiana celu otwartego raportu podbija wersję i wymaga ponownego potwierdzenia. Zamknięcie ma unikalny klucz idempotencji i najwyżej jeden depozyt.
- Zamknięcie zwiększa powiązane saldo rachunku o policzona minus otwarcie. Depozyt oczekujący pozostaje częścią tego salda. Następny dzień zaczyna się od faktycznie pozostawionej gotówki, nie od całości rachunku zawierającego paczki.

### Depozyty, ustawienia i korekty

- Administrator ustala kasę stałą niezależnie dla salonów. Cel zmienia otwarty raport lub obowiązuje od następnego; nie przepisuje zamkniętych raportów. Audyt zawiera stare/nowe wartości, aktora, czas i powód.
- Depozyt: `WAITING` → `RECEIVED` → `VERIFIED` albo `DISCREPANCY`. Potwierdzenie odbioru zaplombowanej paczki jest oddzielone od przeliczenia zawartości. `VOID` oznacza wycofanie wskutek audytowanej korekty, nie usunięcie.
- Odbiór wymaga administratora, fizycznego potwierdzenia oraz wyboru docelowego aktywnego rachunku gotówkowego PLN niepowiązanego z kasą salonu. Przenosi zadeklarowaną kwotę między rachunkami atomowo; suma środków nie rośnie.
- Przeliczenie zawartości aktualizuje rachunek docelowy tylko o różnicę faktyczna minus deklarowana. Wyjaśnienie obowiązkowe przy różnicy. Operacje powtórzone nie mogą ponownie zmienić sald.
- Administrator może skorygować ostatni zamknięty raport, wyłącznie przed utworzeniem późniejszego raportu i przed odbiorem depozytu: wpływy, policzona gotówka, wymagany powód i wersja. Przeliczenie rachunku/depozytu w jednej transakcji; poprzednie wartości w niezmiennym audycie. Nieodebrany depozyt `VOID` po kolejnej korekcie może wrócić do `WAITING` pod tym samym identyfikatorem i z kolejną wersją. Po granicy odbioru/późniejszego raportu blokada z jawnym komunikatem, bez przepisywania dalszej historii.
- Rachunek zarządzany przez kasę salonu nie pozwala na ręczną zmianę salda lub dezaktywację przez dotychczasowe API rachunków.
- Poza zakresem tej wersji: automatyczne księgowanie kart/banku, płatności KSeF, pełna ewidencja zobowiązań klienta z kaucji, przenoszenie gotówki między salonami, import historycznych arkuszy i ogólne korekty dawnych zamkniętych okresów. Nie dodajemy przycisków bez działającego procesu.

## 4. Dowody odbioru

- Czysta baza z pełnego łańcucha migracji; konfiguracja i operacje przez UI/API, bez ręcznego dopisywania danych domenowych SQL. Oddzielny test uaktualnienia zachowuje stare przychody, plany i koszty.
- Przychód 100 → 150 → 120 daje końcowo 120; zero, brak, ujemna korekta, import/eksport, nieznana data, rok bez wykonania.
- Pełny przebieg admin/pracownik: inicjalizacja, dzień, operacje dodaj/edytuj/anuluj, cel 300 i 250, zamknięcie 1370, kolejny dzień, odbiór i osobne przeliczenie, niedobór, korekta, kolizja wersji i ponowienie żądania.
- Próby 401/403 i odczytu/zapisu innego salonu, stara rola w sesji, brak aktywnego pracownika. Odświeżenie i restart zachowują wyniki.
- Testy jednostkowe/integracyjne, pełny zestaw regresji, `next build`, browser desktop/mobile i ręczny odczyt faktycznych sald. Zielony test pomocniczej funkcji nie zastępuje pełnego przebiegu.
- Bez automatycznego commit/push/deploy. Produkcja: kopia SQLite, sprawdzenie migracji na kopii, wdrożenie i odczyt po wdrożeniu dopiero po zgodzie.
