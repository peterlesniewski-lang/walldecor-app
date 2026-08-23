# Projektant ścieżek formularza — projekt

## Cel

Pracownik WallDecor ma układać kilka wielokrotnie używanych formularzy
przygotowania montażu bez znajomości technicznych kluczy pytań ani wartości
`YES`, `NO` i `UNKNOWN`. Edytor ma przypominać projektowanie formularza z
perspektywy klienta: pracownik widzi pytanie, możliwe odpowiedzi i rozwijające
się pod nimi pytania podrzędne.

Wybrany wariant to uproszczone „Ścieżki odpowiedzi”. Przejmuje czytelność
edytorów dokumentowych, ale nie wprowadza ogólnego silnika automatyzacji.

## Zakres MVP

Projektant obsługuje:

- pytania główne ułożone w kolejności formularza;
- pytania podrzędne dodawane pod konkretną odpowiedzią wcześniejszego pytania;
- dowolnie głęboki, acykliczny łańcuch pojedynczych warunków;
- zwijanie i rozwijanie gałęzi;
- zmianę kolejności strzałkami góra/dół w obrębie tej samej gałęzi;
- edycję i usuwanie pytania;
- lokalny tryb `Testuj formularz`, który pokazuje wyłącznie pytania wynikające z
  udzielonych odpowiedzi;
- dotychczasowe wersjonowanie: szkic można edytować, a opublikowana wersja jest
  niemutowalna.

MVP nie zawiera drag-and-drop, warunków AND/OR, skoków między stronami,
obliczeń, przekierowań ani ogólnego mechanizmu akcji.

## Zachowanie kreatora

### Lista pytań

Każde pytanie jest kartą zawierającą treść pytania, polską nazwę typu, poziom
ryzyka oraz działania `Edytuj`, `Przenieś wyżej`, `Przenieś niżej` i `Usuń`.
Techniczny klucz nie jest pokazywany w podstawowym widoku.

Pytania główne stoją przy lewej krawędzi. Pytanie zależne jest umieszczone pod
odpowiedzią, która je ujawnia, i połączone z rodzicem spokojną linią gałęzi.
Wcięcie rośnie maksymalnie przez trzy poziomy, aby głębsze formularze nadal
mieściły się na ekranie. Dalsze poziomy są oznaczone numerem poziomu, ale model
nie ma sztucznego limitu głębokości.

Pod każdym pytaniem typu `Tak / Nie / Nie wiem` znajdują się trzy czytelne
odpowiedzi. Pod odpowiedzią jest działanie `+ Dodaj pytanie po tej odpowiedzi`.
Jeżeli odpowiedź nie ma potomków, klient po jej wybraniu przechodzi do
następnego widocznego pytania głównego lub następnego pytania w aktywnej gałęzi.

Pytanie `Pojedynczy wybór` działa analogicznie: pytanie podrzędne można dodać
pod jedną z jego opcji. Pozostałe typy nie mogą być rodzicami warunku równości.

### Dodawanie i edycja

Kliknięcie `+ Następne pytanie główne` albo `+ Dodaj pytanie po tej odpowiedzi`
otwiera tę samą prostą kartę edycji we właściwym miejscu drzewa. Pracownik
uzupełnia:

- treść pytania;
- typ wybrany z polskiej listy;
- opcjonalną pomoc dla klienta;
- poziom ryzyka;
- opcje odpowiedzi, gdy wymaga ich typ;
- informację, czy odpowiedź jest obowiązkowa.

System nadaje nowemu pytaniu stabilny, niewidoczny identyfikator. Zmiana treści
pytania później nie zmienia identyfikatora ani zapisanych zależności. Istniejące
szablony zachowują swoje dotychczasowe klucze.

Usunięcie pytania mającego potomków wymaga potwierdzenia i usuwa cały jego
podzbiór z bieżącego szkicu. Edytor pokazuje liczbę usuwanych pytań. Nie
promujemy automatycznie potomków do poziomu głównego, ponieważ zmieniłoby to
znaczenie formularza.

### Tryb testowy

Przełącznik `Edytuj / Testuj` nie publikuje formularza i nie zapisuje odpowiedzi
klienta. Tryb testowy używa aktualnego szkicu oraz tego samego silnika
widoczności co formularz publiczny. Pracownik może przejść ścieżki `Tak`, `Nie`
i `Nie wiem`, wyzerować próbę i wrócić do edycji bez utraty szkicu.

Tryb pokazuje ostrzeżenie, jeśli nie istnieje żadna droga do pytania albo gdy
szkic jest niepoprawny. Publikacja jest zablokowana do czasu usunięcia błędu.

## Logika wielopoziomowa

Każde pytanie ma najwyżej jeden bezpośredni warunek:

```text
Pokaż to pytanie, gdy [pytanie nadrzędne] = [konkretna odpowiedź]
```

Widoczność jest liczona rekurencyjnie. Pytanie jest widoczne tylko wtedy, gdy:

1. jego bezpośredni warunek jest spełniony;
2. pytanie nadrzędne samo jest widoczne;
3. wszystkie wcześniejsze warunki w całym łańcuchu są spełnione.

Przykład:

```text
Czy na tapetowanej ścianie są okna?
└── Tak → Czy tapetujemy glify?
    └── Tak → Podaj głębokość glifów
```

Zmiana odpowiedzi `Okna: Tak` na `Okna: Nie` natychmiast ukrywa oba pytania
potomne. Odpowiedzi z nieaktywnej gałęzi nie są uznawane za odpowiedzi
formularza, nie trafiają do finalnego zgłoszenia i nie mogą ponownie ujawnić
głębszego pytania przez nieaktualną wartość.

## Architektura i model danych

Zmiana nie wymaga migracji bazy. Obecny zapis pytania oraz pojedynczego warunku
`questionKey + equals` pozostaje źródłem prawdy.

Powstaje jeden współdzielony, czysty moduł widoczności, możliwy do użycia w
przeglądarce i na serwerze. Odpowiada za:

- obliczenie widocznych pytań na podstawie całego łańcucha rodziców;
- uporządkowanie płaskiej listy jako drzewa ścieżek;
- wykrycie potomków pytania;
- odfiltrowanie odpowiedzi z nieaktywnych gałęzi.

Publiczny formularz i serwis zapisu nie mogą mieć dwóch niezależnych wersji tej
logiki. Oba używają wspólnego modułu, aby podgląd pracownika, formularz klienta
i walidacja serwerowa zawsze pokazywały ten sam wynik.

Warstwa kreatora jest wydzielona z obecnego komponentu szablonów na mniejsze
elementy:

- lista/drzewo pytań;
- karta edycji pytania;
- lokalny podgląd testowy;
- istniejąca obsługa tworzenia szkicu, publikacji i kolejnej wersji.

API nadal otrzymuje całą uporządkowaną listę pytań w szkicu. Przesunięcie
pytania zmienia kolejność tylko wśród rodzeństwa mającego ten sam warunek.

## Błędy i zabezpieczenia

- cykl warunków, brak rodzica albo niedozwolona odpowiedź są blokowane zarówno
  w interfejsie, jak i przez istniejącą walidację serwerową;
- karta nie pozwala wybrać pytania jako własnego rodzica ani wskazać jego
  potomka jako rodzica;
- pytanie zależne od usuniętego elementu nie może pozostać samotnym rekordem;
- błąd zapisu pozostawia lokalny szkic na ekranie i pokazuje komunikat po
  polsku;
- publikacja niepoprawnego albo pustego szkicu pozostaje niedostępna;
- opublikowane wersje i historyczne snapshoty zleceń nie są przepisywane.

## Wygląd i dostępność

Kreator pozostaje częścią panelu pracownika, dlatego zachowuje `Plus Jakarta
Sans` i istniejącą ciepłą paletę panelu. Powierzchnie używają ciepłej bieli,
piaskowych pól wejściowych i bursztynowego akcentu działania. Linie drzewa są
subtelne i służą wyłącznie pokazaniu relacji.

Hierarchia nie opiera się wyłącznie na kolorze: poziom jest pokazany również
wcięciem, linią, etykietą `Jeśli „…”` i kolejnością DOM. Wszystkie działania są
dostępne z klawiatury, mają widoczny focus i polskie etykiety dla czytnika
ekranu. Na telefonie drzewo nie wymaga przewijania poziomego.

## Testy i kryteria akceptacji

1. Pracownik tworzy pytanie główne i dodaje pod odpowiedzią `Tak` pytanie
   podrzędne bez wpisywania technicznego klucza.
2. Można utworzyć co najmniej trzy poziomy: `Okna → Glify → Głębokość`.
3. Tryb testowy i formularz klienta pokazują identyczny zestaw pytań dla tych
   samych odpowiedzi.
4. Zmiana odpowiedzi rodzica ukrywa wszystkich potomków niezależnie od
   wcześniej zapisanych wartości pośrednich.
5. Odpowiedzi z ukrytej gałęzi nie są walidowane jako wymagane, zapisywane jako
   aktywne ani uwzględniane w zgłoszeniu.
6. Nie można utworzyć cyklu, wskazać brakującego rodzica ani użyć
   niedozwolonego typu pytania jako rodzica.
7. Przeniesienie góra/dół nie przenosi pytania do innej gałęzi.
8. Usunięcie rodzica po potwierdzeniu usuwa cały podzbiór tylko z bieżącego
   szkicu.
9. Edycja etykiety nie zmienia stabilnego identyfikatora pytania.
10. Istniejące szkice i opublikowane formularze nadal się otwierają, a stare
    linki klienta zachowują historyczny snapshot.
11. Kreator działa z klawiatury i na wąskim ekranie bez poziomego przewijania.
12. Testy jednostkowe, komponentowe, scenariusz przeglądarkowy i pełny build są
    zielone.

## Poza zakresem

- drag-and-drop;
- wiele warunków dla jednego pytania;
- grupy logiczne AND/OR;
- skoki między stronami i warunkowe zakończenia;
- obliczenia, punktacja i przekierowania;
- import lub eksport formularzy Tally;
- zmiana wyglądu publicznego formularza klienta poza poprawną widocznością
  wielopoziomowych pytań.
