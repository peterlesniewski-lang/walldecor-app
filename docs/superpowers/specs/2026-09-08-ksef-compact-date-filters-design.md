# KSeF — zwarta lista i daty wystawienia

Zakres zaakceptowany w rozmowie: dwa usprawnienia i wdrożenie na produkcję. Eksport CSV wykluczony; raportowanie zostaje w Subiekcie.

## Zachowanie

- Domyślnie w wierszu widać tylko przypisane tagi, bez całego katalogu.
- „Edytuj tagi” rozwija istniejący edytor TagChips dla jednego wiersza. „Zwiń” nie usuwa roboczego wyboru. Zmiany nadal zapisuje istniejący przycisk klasyfikacji; niezapisany wybór jest oznaczony.
- Faktury zatwierdzone pokazują etykiety bez możliwości edycji. Brak tagów ma czytelny stan pusty. Nie zmieniamy API klasyfikacji, automatycznych reguł dostawców ani rozbicia faktur.
- Obok pozostałych filtrów dodajemy miesiąc wystawienia oraz datę wystawienia od/do. Miesiąc wypełnia obie granice; ręczna zmiana granicy zeruje wybór miesiąca. Domyślnie brak ograniczenia dat.
- Zakres jest domknięty po obu stronach i odnosi się do daty na fakturze. Daty źródłowe aplikacja zapisuje jako UTC date-only; zapytanie obejmuje od początku pierwszego dnia do końca ostatniego dnia UTC.
- Można użyć tylko jednej granicy. Niepoprawne daty i odwrócony zakres są odrzucane, nie mogą prowadzić do pokazania nieograniczonej listy.
- Filtr działa w bazie przed paginacją i obliczeniem sum. Zachowuje się przy sortowaniu, zmianie strony i zapisie faktury. Nowy filtr resetuje stronę i zaznaczenie. „Wyczyść” usuwa także daty.

## Kierunek UI

Intent: Piotr szybko przegląda i klasyfikuje faktury oraz wybiera okres; spokojny, gęsty rejestr.
Palette: istniejące --wd-dark, --wd-text-muted, --wd-border, ciepłe powierzchnie panelu; etykiety nie konkurują z kwotami i statusami.
Depth: brak nowych cieni; edytor ma subtelny separator i pozostaje w kontekście wiersza.
Surfaces: istniejąca powierzchnia tabeli, delikatne tło rozwiniętej edycji.
Typography: istniejący Plus Jakarta Sans, kwoty i daty z cyframi tabularnymi.
Spacing: rytm 4 px, etykiety zawijane, katalog montowany tylko po rozwinięciu.

## Warunki odbioru

Testy zakresu obejmują granice dni, rok przestępny, zakres jednostronny, puste wartości, błąd kolejności, sumy i paginację na rzeczywistej izolowanej SQLite. Testy UI obejmują zwijanie tagów, zachowanie wyboru, blokadę zatwierdzonych, miesiąc i zakres, reset oraz utrzymanie filtrów. Test przeglądarkowy zapisuje klasyfikację na izolowanych danych i sprawdza trwałość po odświeżeniu. Produkcja: backup, zakończone wdrożenie, odczyt tagów i filtrów bez modyfikacji rzeczywistych faktur.
