# Produkty zlecenia i pomiary w zakresach — projekt

## Status i cel

Projekt opisuje zatwierdzony układ „Mapy zlecenia”:

`pomieszczenie → zakres prac → produkty → pomiary`.

Celem jest proste zapisanie faktycznego zakresu montażu bez tworzenia w
aplikacji katalogu tysięcy SKU. Karta ma od razu odpowiadać na pytania: gdzie
pracujemy, co robimy, jaki produkt montujemy i jakie wymiary dotyczą danego
zakresu. Brak danych produktu lub pomiaru nie blokuje dalszej obsługi zlecenia.

Projekt rozwija zasady pomiarów opisane w
`2026-08-23-rectangle-measurements-design.md`. W razie różnicy dotyczącej
położenia pomiarów w interfejsie obowiązuje niniejszy dokument: nowy pomiar
tworzymy przede wszystkim wewnątrz konkretnego zakresu prac.

## Docelowy model biznesowy

### Słownik zakresów zamiast katalogu SKU

Konfiguracja globalna przechowuje wyłącznie niewielki, edytowalny słownik
rodzajów prac, np.:

- `Tapetowanie`;
- `Sztukateria`;
- w przyszłości inne zakresy dodane przez administratora.

Rodzaje prac nie są zakodowane na stałe. Administrator lub manager może je
dodać, zmienić nazwę i zarchiwizować. Zmiana nazwy nie modyfikuje historycznych
zleceń, ponieważ zakres na karcie zachowuje własną migawkę nazwy.

Globalny katalog nie służy do wpisywania nazwy produktu, producenta, kolekcji,
SKU ani partii. Dane te należą do konkretnego zlecenia. Istniejące historyczne
rekordy katalogowych produktów zostają zachowane w bazie, ale interfejs nie
oferuje dodawania kolejnych produktów globalnych.

Ekran `/installations/catalog` pozostaje punktem wejścia do konfiguracji, ale
sekcja `Materiały i usługi` zostaje zastąpiona prostszą sekcją `Rodzaje prac`.
Kreator formularzy pozostaje osobną częścią tej strony. Pytania przygotowawcze,
np. `Czy ściana jest zagruntowana?`, należą do szablonu formularza, a nie do
produktu ani słownika zakresów.

### Jedna karta, jedna czytelna hierarchia

Przykładowy zapis na karcie:

```text
Salon
└── Tapetowanie
    ├── Produkt: Archipel / Casamance / SKU 70070070
    │   Kolekcja: Archipel / partia: 000392829
    └── Ściana za sofą: 400 × 320 cm
```

Pomieszczenie może mieć wiele zakresów. Zakres może mieć wiele produktów i
wiele pomiarów. W przypadku samej usługi zakres może nie mieć żadnego produktu.

## Interfejs karty montażu

### Pomieszczenie i zakres

Wewnątrz pomieszczenia pracownik dodaje zakres z aktywnego słownika. Nazwa
zakresu jest widoczna jako nagłówek sekcji, np. `Tapetowanie` albo
`Sztukateria`.

Zachowujemy możliwość obsługi istniejących, ręcznie nazwanych zakresów. Nowe
zakresy powstają jednak przez wybór rodzaju pracy, aby uniknąć wariantów typu
`tapeta`, `tapetowanie` i `Tapety` w raportach.

### Produkty przypisane do zakresu

Pod nagłówkiem zakresu znajduje się spokojna, nieobowiązkowa sekcja `Produkty`.
Pracownik może rozwinąć `Dodaj produkt` i wpisać:

- nazwę produktu;
- producenta;
- kod lub SKU;
- kolekcję lub serię;
- numer partii / batch.

Pola nie mają gwiazdek wymagania. Cała sekcja może pozostać pusta i karta nadal
da się zapisać, zaplanować oraz wysłać klientowi formularz. Jeżeli wszystkie
pola nowego wiersza są puste, zapis jest neutralny: pusty rekord nie powstaje i
użytkownik nie dostaje blokującego błędu. Do utworzenia produktu wystarczy
wartość w dowolnym z pól.

W jednym zakresie można dodać kilka produktów, np. dwie tapety na dwóch
ścianach. Zapisany produkt jest prezentowany w zwartym wierszu z możliwością
edycji i usunięcia. Nazwa jest główną etykietą; gdy jej brak, interfejs używa w
kolejności kodu/SKU, producenta, a następnie neutralnej etykiety
`Produkt bez nazwy`.

Produkt jest danymi zlecenia, nie odnośnikiem do centralnego SKU. Późniejsza
zmiana słownika zakresów ani archiwizacja starego katalogowego produktu nie
zmienia treści zapisanej na karcie.

### Pomiary przypisane do zakresu

Sekcja `Pomiary` znajduje się bezpośrednio pod produktami tego samego zakresu.
Domyślnie nie pokazujemy już jednego niejednoznacznego pola pomiarowego na dole
całego pomieszczenia.

Pracownik wybiera jeden z dwóch formatów:

1. `Szerokość × wysokość` — dla ściany, wnęki lub innej powierzchni
   prostokątnej. Nazwa elementu, szerokość, znak `×`, wysokość i wspólna
   jednostka tworzą jeden rekord. Obie wartości są wymagane, dodatnie i zapisują
   się razem.
2. `Długość / ilość` — dla listwy, gzymsu, pasa, obwodu albo liczby ramek.
   Rekord ma nazwę, jedną dodatnią wartość i jednostkę.

Dla prostokąta dostępne są `mm`, `cm` i `m`. Dla pojedynczego pomiaru dostępne
są `mm`, `cm`, `m`, `m²`, `mb` oraz `szt.`. Przykłady zapisu:

- `Ściana za sofą — 400 × 320 cm`;
- `Listwa ścienna — 18 mb`;
- `Gzyms — 24 mb`;
- `Ramki ścienne — 6 szt.`.

Nie zapisujemy szerokości i wysokości jako dwóch oddzielnych pozycji. Nie
tworzymy też jednego wspólnego formularza, w którym użytkownik celowo zostawia
jedno z tych pól puste. Typ pomiaru jasno określa oczekiwany komplet danych.

W MVP nie obliczamy automatycznie powierzchni w m². Pozwala to uniknąć
niejasności dotyczących otworów, zapasu, zaokrągleń i sposobu rozliczenia.

Istniejące pomiary przypisane do zakresu pojawiają się w jego sekcji. Starsze
pomiary przypisane tylko do pomieszczenia nie mogą zniknąć — karta pokazuje je
na końcu pomieszczenia w osobnej sekcji `Pomiary ogólne pomieszczenia` i pozwala
je edytować albo przypisać do zakresu.

### Zachowanie na telefonie

Na szerokim ekranie pola produktu oraz para szerokość/wysokość mogą stać w
jednym wierszu. Na telefonie układają się pionowo w tej samej karcie. Znak `×`,
etykiety pól i obramowanie grupy muszą nadal jasno pokazywać, że szerokość i
wysokość tworzą jeden pomiar.

Pola i działania mają minimum 44 px wysokości, widoczny fokus klawiatury oraz
polskie komunikaty błędów. Sekcje produktów i pomiarów są wizualnie
drugorzędne wobec nazwy pomieszczenia i zakresu, aby karta pozostawała czytelna
przy wielu pozycjach.

## Wizyty i formularz klienta

Zakres wizyty pozostaje prosty. Pracownik przypisuje do wizyty gotowe zakresy,
np. `Salon — Tapetowanie` i `Salon — Sztukateria`. Wybór zakresu automatycznie
oznacza, że instalator otrzyma wszystkie zapisane pod nim produkty i pomiary;
nie wybiera ich ponownie w terminie wizyty.

Publiczny formularz przygotowawczy pozostaje jednym formularzem dla całego
zlecenia. Brak produktu, SKU, partii lub pomiaru nie blokuje wysłania linku ani
odpowiedzi klienta. Klient nie uzupełnia danych katalogowych produktu w
formularzu przygotowawczym. Jeżeli obecny widok pokazuje kontekst produktu, ma
on charakter tylko informacyjny i korzysta z danych zapisanych na karcie.

Logika pytań warunkowych, wersjonowanie odpowiedzi oraz wewnętrzne flagi
`Do ustalenia przed montażem` pozostają bez zmian.

## Model danych i zgodność wsteczna

### Rodzaje prac

Istniejący `InstallationCatalogCategory` pełni rolę konfigurowalnego rodzaju
pracy. `InstallationScope` otrzymuje opcjonalne wskazanie kategorii, natomiast
jego istniejąca nazwa pozostaje migawką historyczną.

Dotychczasowe poziomy `InstallationCatalogType` i
`InstallationCatalogProduct` nie są usuwane w tej migracji. Zachowują relacje i
historię starych kart, ale nie są używane do tworzenia nowych produktów
zlecenia w podstawowym interfejsie.

### Produkty zlecenia

`InstallationScopeProduct` staje się właściwym rekordem produktu na karcie:

- powiązanie `catalogProductId` staje się opcjonalne i służy wyłącznie zgodności
  ze starszymi rekordami;
- nazwa, producent, kod/SKU i kolekcja pozostają migawkami zapisanymi przy
  zleceniu, ale każde z tych pól może być puste;
- dochodzi opcjonalne pole numeru partii / batch;
- serwis wymaga co najmniej jednej niepustej wartości tylko wtedy, gdy ma
  faktycznie utworzyć rekord produktu.

Takie podejście nie wymaga centralnego produktu i jednocześnie zachowuje
wszystkie dotychczasowe przypisania. Usunięcie produktu z bieżącego zakresu jest
odwracalną zmianą biznesową zapisaną w audycie; nie usuwa historycznego
katalogu ani danych innych kart.

### Pomiary

`InstallationMeasurement` używa modelu `SINGLE | RECTANGLE` i opcjonalnego
`secondaryValue` opisanego w projekcie pomiarów prostokątnych. Nowe pomiary
tworzone wewnątrz zakresu zawsze otrzymują jego `scopeId`. Pole `roomId`
pozostaje dla integralności i szybkiego odczytu pomieszczenia.

Walidacja sprawdza, że wskazany zakres należy do tego samego pokoju i zlecenia.
Jednostki `MB` oraz `SZT` dochodzą do dozwolonego słownika pomiarów
pojedynczych. Dane istniejące zachowują dotychczasowe wartości i jednostki.

## API, audyt i błędy

API produktu przyjmuje pola tekstowe po przycięciu białych znaków. Puste ciągi
są zamieniane na `null`. Żądanie zawierające wyłącznie puste pola nie tworzy
rekordu i zwraca przewidywalną odpowiedź sukcesu bez zmiany danych.

Tworzenie, edycja i usunięcie produktu zapisują użytkownika, czas oraz stan
przed i po zmianie w dzienniku audytowym. To samo obowiązuje zakresy i pomiary.

API nie pozwala przypisać produktu lub pomiaru do zakresu z innego zlecenia.
Przy konflikcie edycji użytkownik otrzymuje informację, że karta została
zmieniona i należy ją odświeżyć; serwis nie nadpisuje cicho nowszych danych.

Usunięcie zakresu z produktami lub pomiarami wymaga obecnego potwierdzenia w
interfejsie i pozostawia pełny ślad audytowy. Archiwizacja rodzaju pracy nie
usuwa żadnego zakresu ze starych zleceń.

## Migracja

Migracja jest addytywna i wykonywana najpierw na kopii bazy:

1. dodaje opcjonalne powiązanie zakresu z rodzajem pracy;
2. luzuje obowiązkowe powiązanie produktu zakresu z produktem katalogowym;
3. pozwala na puste pola migawki produktu i dodaje pole partii;
4. dodaje model prostokątnego pomiaru oraz nowe jednostki walidacji;
5. zachowuje wszystkie istniejące rekordy, identyfikatory i relacje.

Po migracji sprawdzamy liczbę kart, zakresów, produktów i pomiarów przed oraz po
zmianie, integralność SQLite i odczyt przykładowej starej karty. Nie usuwamy
starych tabel ani rekordów w ramach tego wdrożenia.

## Kryteria akceptacji

1. Administrator dodaje do słownika `Tapetowanie` i `Sztukateria` bez tworzenia
   produktów globalnych.
2. Pracownik tworzy `Salon → Tapetowanie`, a karta zapisuje migawkę nazwy
   zakresu.
3. Do jednego zakresu można dodać kilka produktów z dowolną kombinacją pól,
   w tym numerem partii.
4. Pozostawienie całej sekcji produktu pustej nie blokuje zapisu karty,
   planowania wizyty ani formularza klienta i nie tworzy pustego rekordu.
5. Karta zapisuje `Ściana za sofą — 400 × 320 cm` jako jeden pomiar
   `RECTANGLE` z obiema wartościami.
6. Karta zapisuje `Listwa ścienna — 18 mb` i `Ramki — 6 szt.` jako pomiary
   `SINGLE`.
7. Niepełny prostokąt, wartość zerowa i wartość ujemna są odrzucane przy polu,
   ale nie powodują utraty innych danych karty.
8. Pomiary zakresu są widoczne pod właściwym zakresem, a stare pomiary ogólne
   pozostają dostępne w osobnej sekcji.
9. Wizyta pokazuje zakresy w formacie `Pomieszczenie — zakres` i po otwarciu
   daje instalatorowi dostęp do należących do nich produktów i pomiarów.
10. Historyczna karta korzystająca z katalogowego produktu otwiera się po
    migracji z niezmienioną nazwą, kodem, producentem i kolekcją.
11. Widoki dodawania i edycji działają na komputerze i telefonie bez poziomego
    przewijania, z pełną obsługą klawiatury.
12. Testy serwisów, tras API, audytu, uprawnień, migracji świeżej i istniejącej
    bazy oraz produkcyjny build przechodzą pomyślnie.

Scenariusz końcowy na czystej bazie obejmuje utworzenie użytkowników, dwóch
rodzajów prac, karty z pokojem, dwóch zakresów, produktu tapetowego, pomiaru
prostokątnego, pomiaru w metrach bieżących, wizyty i linku klienta. Dane muszą
przetrwać ponowne uruchomienie aplikacji i być widoczne zgodnie z uprawnieniami
opiekuna, zastępcy, administratora oraz instalatora przypisanego do wizyty.

## Poza zakresem MVP

- statusy produktu i zamówienia, np. `zamówiony`, `dostarczony`, `przekazany
  montażyście`;
- osobna karta zamówienia widoczna klientowi po wysłaniu formularza;
- synchronizacja SKU z IdoSell, ERP, Airtable lub CRM;
- automatyczne obliczanie m², liczby brytów, rolek, zapasu i odjęcia otworów;
- specjalistyczny konfigurator ramek, pasa biodrowego i układów sztukaterii;
- usuwanie historycznych tabel katalogu produktów.

Model produktu zlecenia i jego audyt mają umożliwić dodanie statusów oraz
widoku klienta w kolejnej wersji bez przenoszenia danych z powrotem do katalogu
globalnego.
