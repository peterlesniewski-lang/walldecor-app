# Pomiar szerokość × wysokość — projekt

## Cel

Na mapie zlecenia pracownik zapisuje powierzchnię do tapetowania jako jeden
czytelny rekord, np. `Ściana przy oknie — 500 × 260 cm`. Szerokość i wysokość
nie mogą być dwoma niezależnymi wpisami, ponieważ przy wielu ścianach łatwo je
błędnie sparować.

Jednocześnie system zachowuje pomiary jednowymiarowe, potrzebne m.in. dla
głębokości glifu, długości listwy albo obwodu.

## Zachowanie interfejsu

Formularz dodawania pomiaru otrzyma przełącznik typu:

- `Powierzchnia (szerokość × wysokość)` — typ domyślny;
- `Pojedynczy wymiar`.

Dla powierzchni użytkownik podaje:

- nazwę elementu, np. `Ściana przy oknie`;
- szerokość;
- wysokość;
- jedną wspólną jednostkę: `mm`, `cm` albo `m`;
- opcjonalne przypisanie do zakresu w pomieszczeniu.

Oba wymiary są wymagane i muszą być dodatnimi liczbami dziesiętnymi. Lista
pokazuje jeden wpis: `Ściana przy oknie — 500 × 260 cm`. Edycja zachowuje ten
sam układ dwóch pól.

Dla pojedynczego wymiaru pozostaje obecny układ: nazwa, wartość, jednostka i
przypisanie do zakresu. Jednostka `m²` jest dostępna tylko dla pomiaru
pojedynczego; dla szerokości i wysokości dozwolone są wyłącznie jednostki
liniowe.

Nie obliczamy ani nie zapisujemy automatycznie powierzchni w m² w tym zadaniu.
Pozwala to uniknąć niejawnych zaokrągleń i rozbudowy zakresu pilota.

## Model danych i zgodność

`InstallationMeasurement` otrzyma:

- `kind`: `SINGLE` albo `RECTANGLE`, domyślnie `SINGLE`;
- `secondaryValue`: opcjonalną drugą wartość.

Istniejące pole `value` pozostaje pierwszą wartością. Dla `RECTANGLE` oznacza
szerokość, a `secondaryValue` wysokość. Dla `SINGLE` używane jest wyłącznie
`value`.

Migracja jest addytywna. Wszystkie istniejące pomiary automatycznie pozostają
typem `SINGLE`; żaden zapis historyczny nie jest przepisywany ani usuwany.

## API i walidacja

Tworzenie i edycja używają dwóch jawnych wariantów danych:

- `SINGLE`: `elementName`, `value`, `unit`, opcjonalny `scopeId`;
- `RECTANGLE`: `elementName`, `width`, `height`, jednostka liniowa i opcjonalny
  `scopeId`.

Serwis zapisuje `width` jako `value`, a `height` jako `secondaryValue`.
Niekompletna para, zero, liczba ujemna, notacja wykładnicza lub `m²` dla
prostokąta zwracają błąd pola w języku polskim.

Zmiana typu podczas edycji jest dozwolona:

- przejście na `RECTANGLE` wymaga podania obu wymiarów;
- przejście na `SINGLE` usuwa `secondaryValue` w tej samej transakcji.

Każda zmiana nadal zapisuje autora i pełny ślad audytowy. Snapshot audytu
zawiera typ oraz obie wartości.

## Wygląd i dostępność

Zmiana pozostaje częścią istniejącej „Mapy zlecenia” i korzysta z jej ciepłych
powierzchni, bursztynowego koloru działania, subtelnych obramowań oraz kroju
`Plus Jakarta Sans`. Wymiary są prezentowane cyframi tabularnymi.

Na szerokim ekranie szerokość i wysokość stoją obok siebie z widocznym znakiem
`×`. Na telefonie pola układają się pionowo, ale nadal należą do jednej grupy
opisanej jako powierzchnia. Każde pole ma własną etykietę, komunikat błędu oraz
minimum 44 px wysokości.

## Odnajdywalność katalogu i formularzy

Ekran `/installations` otrzyma w nagłówku przycisk `Katalog i formularze`,
umieszczony obok `Nowa karta`. Przycisk prowadzi do `/installations/catalog` i
jest widoczny wyłącznie dla administratora oraz managera, czyli tych samych ról,
które mogą zarządzać katalogiem. Pozostali pracownicy nie zobaczą martwego
odnośnika do strony, do której nie mają dostępu.

Na karcie zlecenia komunikat o braku przypiętego formularza przestanie być
samym ostrzeżeniem. Otrzyma działanie `Wybierz lub utwórz formularz`:

- gdy istnieje opublikowany formularz, prowadzi do panelu wyboru formularza na
  tej samej karcie;
- gdy nie ma żadnej opublikowanej wersji i użytkownik może zarządzać katalogiem,
  prowadzi do `/installations/catalog`;
- użytkownik bez uprawnień administracyjnych otrzymuje jasną informację, że
  formularz musi opublikować administrator lub manager.

Oba wejścia używają istniejącej hierarchii przycisków: `Nowa karta` pozostaje
głównym działaniem, a `Katalog i formularze` działaniem drugorzędnym. Nie
dodajemy nowej pozycji do globalnego sidebara w tym zadaniu.

## Testy i kryteria akceptacji

1. Integracja zapisuje i odczytuje `500 × 260 cm` jako jeden pomiar
   `RECTANGLE` przypisany do pokoju lub zakresu.
2. Stare pomiary po migracji pozostają `SINGLE` i zachowują wartość, jednostkę,
   autora oraz historię.
3. API odrzuca brak szerokości lub wysokości, wartości niedodatnie i jednostkę
   `m²` dla prostokąta.
4. Edycja prostokąta aktualizuje oba wymiary i zapisuje poprzedni oraz nowy stan
   w audycie.
5. Zmiana na pomiar pojedynczy usuwa drugą wartość.
6. Interfejs dodaje, wyświetla i edytuje jeden rekord w formacie
   `szerokość × wysokość` na komputerze i telefonie.
7. Administrator i manager widzą na `/installations` działający przycisk
   `Katalog i formularze`; pozostałe role go nie widzą.
8. Ostrzeżenie o braku przypiętego formularza prowadzi do panelu wyboru albo do
   katalogu zależnie od dostępnych formularzy i uprawnień użytkownika.
9. Pełne testy aplikacji, build oraz migracja świeżej i istniejącej bazy są
   zielone.

## Poza zakresem

- automatyczne obliczanie zapotrzebowania na bryty tapety;
- odejmowanie drzwi, okien i innych otworów;
- automatyczne obliczanie powierzchni netto lub liczby rolek;
- modyfikowanie pytań wymiarowych w publicznym formularzu klienta.
