# Responsywna karta pytania formularza klienta — projekt

## Cel

Poprawić wspólny wygląd pytań w publicznym formularzu klienta tak, aby długie
nagłówki zawsze mieściły się wewnątrz karty, a działanie czyszczące nie było
mylone z odpowiedzią. Zatwierdzony kierunek to wariant A: spokojna karta z
nagłówkiem, pomocą, odpowiedziami i dyskretną akcją czyszczenia ułożonymi w
jednej pionowej hierarchii.

Zmiana dotyczy desktopu i urządzeń mobilnych oraz wszystkich typów pytań
renderowanych przez wspólny komponent. Nie zmienia treści pytań, logiki
warunkowej ani sposobu zapisywania odpowiedzi.

## Checkpoint interfejsu

```text
Intent: klient opisuje stan powierzchni na telefonie albo komputerze; ma szybko
rozumieć pytanie i odpowiedzieć bez wrażenia wypełniania technicznego protokołu.
Interfejs ma być spokojny jak konsultacja w showroomie.

Palette: plaster jako tło, paper jako karta, sand jako odpowiedź nieaktywna,
graphite jako tekst i masking-tape jako jedyny akcent wybranej odpowiedzi.

Depth: subtelny cień wyłącznie pod kartą pytania; bez dodatkowego cienia pod
akcją czyszczenia.

Surfaces: strona na plaster, karta na paper, odpowiedzi na sand, aktywna
odpowiedź na masking-tape. Akcja czyszczenia pozostaje przezroczysta.

Typography: istniejący Bricolage Grotesque pozostaje dla nagłówków ekranów i
sekcji, a tytuł pytania, pomoc i kontrolki zachowują Spline Sans. Ta poprawka
nie wprowadza zmiany kroju pisma w pytaniach.

Spacing: wielokrotności 4 px; główne odstępy 8, 12, 16 i 24 px.
```

## Zakres komponentów

Zmiana obejmuje:

- `ClientQuestionRenderer` w trybie interaktywnym i tylko do odczytu;
- wspólne style karty pytania, nagłówka, treści, odpowiedzi i czyszczenia;
- zachowanie `YES_NO_UNKNOWN`, `MULTI`, `SINGLE`, `TEXT`, `NUMBER` oraz
  `DIMENSION` na małych i dużych szerokościach;
- testowy podgląd szablonu, ponieważ korzysta z tego samego renderera.

Typ `FILE` zachowuje własny komponent uploadu. Jego kontener może odziedziczyć
spójne odstępy, ale zadanie nie przebudowuje uploadu ani przekazania zdjęcia z
telefonu.

## Struktura karty

Każda karta ma następującą kolejność:

1. nagłówek pytania;
2. opcjonalny tekst pomocy;
3. kontrolka lub zestaw odpowiedzi;
4. opcjonalna akcja czyszczenia.

Nagłówek nie może wykorzystywać domyślnego pozycjonowania `legend` na ramce
`fieldset`. Zachowujemy semantyczny `fieldset` i `legend`, ale legenda otrzymuje
własną klasę i jest układana jako pełnoszerokościowy element wewnątrz karty.
Treść pytania znajduje się w osobnym kontenerze, który rozpoczyna się poniżej
legendy. Dla pozostałych typów pytań etykieta korzysta z tego samego wizualnego
wzorca nagłówka.

Karta oraz każdy jej element otrzymują `min-inline-size: 0`. Nagłówek ma
`max-inline-size: 100%`, naturalne zawijanie i awaryjne łamanie bardzo długiego
ciągu. Tekst nie może wystawać poza obramowanie nawet przy powiększeniu strony.

## Nagłówek i pomoc

- tytuł pozostaje wewnątrz 16-pikselowego paddingu karty;
- tytuł używa zwartego, czytelnego line-height i nie jest absolutnie
  pozycjonowany;
- odstęp między tytułem a pomocą wynosi 8 px;
- jeżeli pytanie nie ma pomocy, kontrolki zaczynają się po 12–14 px;
- pomoc zachowuje spokojny kolor tekstu drugorzędnego oraz line-height
  odpowiedni do czytania kilku wierszy;
- długi tytuł i długa pomoc zwiększają wysokość karty zamiast nachodzić na
  kolejne elementy.

## Odpowiedzi

`Tak / Nie / Nie wiem` zachowuje trzy równe kolumny na szerokim ekranie. Przy
szerokości do 430 px odpowiedzi tworzą jedną kolumnę. Każda odpowiedź ma co
najmniej 44 px wysokości i pełne stany `default`, `hover`, `pressed`,
`focus-visible` oraz `disabled`, jeżeli dany przepływ go wymaga.

Lista wielokrotnego wyboru, pole tekstowe, liczba, wymiar i pojedynczy wybór
pozostają funkcjonalnie bez zmian. Otrzymują jedynie wspólną hierarchię
nagłówka, treści i czyszczenia.

## Akcja czyszczenia

Akcja jest renderowana wyłącznie wtedy, gdy pytanie nie jest obowiązkowe i ma
już odpowiedź. Zachowujemy dotychczasową logikę usuwania wartości.

Wizualnie akcja:

- znajduje się w osobnym wierszu pod kontrolkami, z odstępem 8 px;
- jest wyrównana do prawej;
- nie ma wypełnienia, obramowania ani wymiarów właściwej odpowiedzi;
- wygląda jak spokojny link-akcja z podkreśleniem i czytelnym focus ringiem;
- zachowuje dotykowy obszar działania o wysokości co najmniej 44 px;
- nie porusza się w górę przy hover.

Dla pytań wyboru etykieta widoczna brzmi `Wyczyść wybór`. Dla tekstu, liczby i
wymiaru brzmi `Wyczyść odpowiedź`. Dostępna etykieta zawiera pełną treść
pytania, aby czytnik ekranu jednoznacznie wskazywał usuwaną wartość.

## Zachowanie responsywne

### Desktop i tablet

- karta wykorzystuje pełną dostępną szerokość formularza;
- tytuł i pomoc pozostają w jednej kolumnie nad odpowiedziami;
- trzy podstawowe odpowiedzi mają równe szerokości;
- akcja czyszczenia jest dyskretna i wyrównana do prawego brzegu treści.

### Telefon

- karta zachowuje wewnętrzny padding bez wysuwania tytułu nad ramkę;
- odpowiedzi układają się pionowo;
- długi tytuł zawija się w obrębie szerokości karty;
- opis pomocy nie zmniejsza czcionki automatycznie i nie jest ucinany;
- akcja czyszczenia pozostaje oddzielona od ostatniej odpowiedzi i ma pełny
  obszar dotykowy.

## Dostępność

- `fieldset` i `legend` pozostają semantycznym opisem grup odpowiedzi;
- przyciski zachowują `aria-pressed`;
- kolejność fokusu odpowiada kolejności wizualnej;
- focus ring nie jest przycinany przez kartę;
- tekst działa przy powiększeniu 200%;
- poziomy kontrastu dotychczasowych tokenów nie są osłabiane;
- zmiana nie usuwa istniejących etykiet formularza ani komunikatów autosave.

## Testy i kryteria odbioru

### Testy komponentu

1. Opcjonalne pytanie bez odpowiedzi nie pokazuje działania czyszczącego.
2. Opcjonalne pytanie z odpowiedzią pokazuje właściwą etykietę czyszczenia.
3. Pytanie obowiązkowe nie pokazuje działania czyszczącego.
4. Kliknięcie czyszczenia przekazuje `null` bez zmiany logiki autosave.
5. `YES_NO_UNKNOWN` zachowuje `fieldset`, `legend` i `aria-pressed`.
6. Tryb tylko do odczytu korzysta z nagłówka mieszczącego się w karcie i nie
   pokazuje czyszczenia.

### Testy przeglądarkowe

Sprawdzamy szerokości 360, 430, 768 i szeroki desktop. Scenariusz wykorzystuje
pełny tytuł o gruntowaniu oraz wielowierszowy tekst pomocy.

Na każdej szerokości:

1. nagłówek znajduje się w obramowaniu karty;
2. strona nie ma poziomego overflow;
3. pomoc nie nachodzi na przyciski;
4. czyszczenie jest w osobnym wierszu i nie przypomina odpowiedzi;
5. wybrana odpowiedź nadal jest jednoznacznie widoczna;
6. focus ring jest widoczny dla odpowiedzi i czyszczenia;
7. po wyczyszczeniu znika stan wybranej odpowiedzi i sama akcja czyszczenia.

Test na 360 px wykonujemy dodatkowo przy powiększeniu tekstu, aby sprawdzić
łamane polskie nagłówki i brak wyjścia poza kartę.

## Poza zakresem

- zmiana treści istniejących pytań i pomocy;
- przebudowa logiki warunkowej, flag ryzyka lub autosave;
- wdrożenie alteracji `ALT-FORM-01` i `ALT-FORM-02` z backlogu pilota;
- dodawanie materiałów pomocniczych, linków i grafik do pytań;
- przebudowa uploadu zdjęć;
- zmiana stylów panelu pracownika.

## Definicja ukończenia

Zmiana jest ukończona dopiero, gdy testy komponentu i testy przeglądarkowe są
zielone, obrazy kontrolne potwierdzają wariant A na desktopie i telefonie, a
realny formularz nie ma poziomego overflow ani tytułu przecinającego ramkę.
Samo przejście kompilacji albo poprawny wygląd jednego pytania nie wystarcza.
