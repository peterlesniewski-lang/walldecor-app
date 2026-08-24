# Formularz przygotowania tapetowanej powierzchni — projekt pytań

## Cel i zakres

Dokument opisuje zatwierdzony zestaw pytań przygotowawczych dla powierzchni
przeznaczonych do tapetowania. Jest to specyfikacja treści i logiki formularza,
nie plan wdrożenia ani zmiana kodu aplikacji.

Jeden formularz nadal obejmuje całe zlecenie pod jednym adresem, ale poniższy
blok pytań powtarza się oddzielnie dla każdej zleconej powierzchni. Powierzchnie
tworzy i nazywa wcześniej pracownik przygotowujący kartę, np.:

- `Salon — ściana za sofą`;
- `Salon — ściana z telewizorem`;
- `Sypialnia — ściana za łóżkiem`;
- `Hol — fronty zabudowy`.

Klient odpowiada tylko na gotowe sekcje. Nie dodaje ani nie nazywa nowych
powierzchni.

## Reguły wspólne

1. Każdy blok rozpoczyna się nazwą pomieszczenia i powierzchni oraz tekstem:
   `Odpowiedz na pytania wyłącznie w odniesieniu do tej powierzchni.`
2. Odpowiedź `Nie wiem` nigdy nie blokuje wysłania formularza.
3. `Nie wiem` tworzy wewnętrzną flagę `Do ustalenia przed montażem`, jeżeli
   niewiedza wpływa na zakres, dostęp, przygotowanie podłoża lub wycenę pracy.
4. Pytania podrzędne pokazują się tylko po odpowiedzi, która ich wymaga.
5. Pola liczbowe, opis i zdjęcia są nieobowiązkowe, chyba że dokument wyraźnie
   stanowi inaczej. Brak tych danych może utworzyć flagę, ale nie blokuje
   klienta.
6. Zdjęcia są pomocnicze. Interfejs nie wyróżnia ich bardziej niż pytań i na
   komputerze nie sugeruje, że klient musi wykonać zdjęcie na miejscu.
7. Odpowiedzi zapisują się jako wersja historyczna. Późniejsza zmiana jest
   korektą, a nie nadpisaniem wysłanej wersji.

## Kolejność pytań

Pytania przechodzą od stanu podłoża przez geometrię i otwory do elementów
nietypowych. Klient, którego powierzchnia jest prosta, szybko odpowiada na
pytania główne. Dodatkowe pola widzi wyłącznie wtedy, gdy są potrzebne.

## 1. Stan powierzchni

### 1.1. Co obecnie znajduje się na powierzchni?

**Typ:** pojedynczy wybór.

**Odpowiedzi:**

- gładź lub tynk;
- farba;
- stara tapeta;
- surowa płyta gipsowo-kartonowa;
- beton;
- inne;
- nie wiem.

**Pomoc dla klienta:**

> Wybierz warstwę, która jest obecnie widoczna na powierzchni.

**Logika wewnętrzna:** `Stara tapeta`, `Inne` i `Nie wiem` tworzą flagę do
sprawdzenia. Po `Inne` pojawia się nieobowiązkowe pole `Opisz powierzchnię`.

### 1.2. Czy osoba przygotowująca powierzchnię potwierdziła, że została ona zagruntowana pod tapetę?

**Typ:** `Tak / Nie / Nie wiem`.

**Pomoc dla klienta:**

> Gruntowanie to przygotowanie podłoża odpowiednim preparatem przed montażem
> tapety. Zwykłe pomalowanie ściany nie zawsze oznacza, że została prawidłowo
> zagruntowana.

**Logika wewnętrzna:** `Nie` i `Nie wiem` tworzą flagę `Do ustalenia przed
montażem` o wysokim znaczeniu.

### 1.3. Czy na powierzchni występują widoczne uszkodzenia lub problemy?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` pojawia się pytanie wielokrotnego wyboru `Co występuje?`:

- pęknięcia;
- ubytki lub otwory;
- nierówności;
- łuszcząca się farba;
- wilgoć lub przebarwienia;
- odspojenia tynku albo gładzi;
- inne.

Dostępne są również nieobowiązkowe pola `Krótki opis` i `Dodaj zdjęcie`.

**Logika wewnętrzna:** każda wskazana wada tworzy flagę. Wilgoć, przebarwienia
i odspojenia otrzymują wysokie znaczenie. `Nie wiem` także wymaga sprawdzenia.

## 2. Wysokość i geometria

### 2.1. Czy wysokość tej powierzchni przekracza 280 cm?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` pojawia się nieobowiązkowe pole:

`Podaj przybliżoną wysokość: ___ cm`.

**Objaśnienie wewnętrzne:** wysokość wpływa na czas pracy i możliwość użycia
drabiny albo rusztowania. `Tak` bez wysokości oraz `Nie wiem` tworzą flagę do
ustalenia.

### 2.2. Czy powierzchnia ma skosy, łuki albo inne niestandardowe kształty?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` klient może zaznaczyć:

- skos;
- łuk;
- wnękę;
- kolumnę;
- zaokrąglenie;
- inny kształt.

Pojawiają się nieobowiązkowe pola `Krótki opis` i `Dodaj zdjęcie`.

**Logika wewnętrzna:** `Tak` i `Nie wiem` tworzą flagę do oceny przez opiekuna.

## 3. Drzwi

### 3.1. Czy w obrębie tej powierzchni znajdują się drzwi?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` pojawia się pytanie `Jakiego rodzaju są to drzwi?`:

- standardowe;
- ukryte;
- oba rodzaje;
- nie wiem.

Klient może opcjonalnie podać liczbę drzwi.

### 3.2. Drzwi standardowe — czy tapeta ma zostać zamontowana również w glifach/ościeżach wokół drzwi?

Pytanie pokazuje się po wskazaniu drzwi standardowych.

**Typ:** `Tak / Nie / Nie wiem`.

**Pomoc dla klienta:**

> Glif lub ościeże to wewnętrzna powierzchnia wnęki wokół drzwi.

Po `Tak` pojawia się nieobowiązkowe pole:

`Przybliżona głębokość glifu: ___ cm`.

**Logika wewnętrzna:** `Tak` bez głębokości oraz `Nie wiem` tworzą flagę do
ustalenia.

### 3.3. Drzwi ukryte — czy tapeta ma zostać zamontowana również na skrzydle drzwi?

Pytanie pokazuje się po wskazaniu drzwi ukrytych.

**Typ:** `Tak / Nie / Nie wiem`.

Następnie pojawia się pytanie:

`Czy drzwi ukryte są już zamontowane i przygotowane do tapetowania?`

**Typ:** `Tak / Nie / Nie wiem`.

**Logika wewnętrzna:** obecność drzwi ukrytych zawsze jest widocznie oznaczona
na karcie. `Nie` albo `Nie wiem` w pytaniu o przygotowanie tworzy flagę o
wysokim znaczeniu.

## 4. Okna

### 4.1. Czy w obrębie tej powierzchni znajdują się okna?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` klient może opcjonalnie podać liczbę okien. Następnie pojawia się:

`Czy tapetujemy glify/wnęki wokół okien?`

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` pojawia się nieobowiązkowe pole:

`Przybliżona głębokość glifu: ___ cm`.

**Logika wewnętrzna:** `Tak` bez głębokości oraz `Nie wiem` tworzą flagę do
ustalenia. Zdjęcie jest dostępne, ale nieobowiązkowe.

## 5. Zabudowy stałe

### 5.1. Czy powierzchnia styka się z zabudową stałą?

**Typ:** `Tak / Nie / Nie wiem`.

**Pomoc dla klienta:**

> Na przykład z szafą w zabudowie, meblami kuchennymi, lamelami, panelami,
> kominkiem albo innym elementem, którego nie można łatwo przesunąć.

Po `Tak` pojawia się pytanie `W jaki sposób ma zostać wykończona tapeta?`:

- do krawędzi zabudowy;
- za zabudową;
- zabudowa zostanie zdemontowana;
- inne;
- nie wiem.

Dostępne są nieobowiązkowe pola `Krótki opis` i `Dodaj zdjęcie`.

**Logika wewnętrzna:** `Za zabudową`, `Inne` oraz `Nie wiem` wymagają
potwierdzenia zakresu przed montażem.

## 6. Tapetowanie mebli

### 6.1. Czy zakres obejmuje tapetowanie mebli lub elementów meblowych?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` klient może wskazać:

- fronty;
- boki mebli;
- drzwi szafy;
- półki;
- panele meblowe;
- inne.

Dostępne są nieobowiązkowe pola:

- liczba elementów;
- przybliżone wymiary;
- materiał powierzchni;
- krótki opis;
- zdjęcie.

**Logika wewnętrzna:** `Tak` zawsze oznacza niestandardowy zakres i wymaga
sprawdzenia. `Nie wiem` także tworzy flagę.

## 7. Dostęp do powierzchni

### 7.1. Czy na powierzchni lub bezpośrednio przy niej znajdują się elementy utrudniające montaż?

**Typ:** wielokrotny wybór.

**Odpowiedzi:**

- grzejnik;
- klimatyzator;
- telewizor lub uchwyt;
- kinkiety;
- liczne gniazdka lub włączniki;
- karnisz;
- półki;
- inne;
- nic z powyższych;
- nie wiem.

`Nic z powyższych` oraz `Nie wiem` są odpowiedziami wyłącznymi i nie mogą być
zaznaczone razem z konkretnym elementem.

Jeżeli wskazano element, pojawia się pytanie:

`Czy te elementy zostaną zdemontowane przed montażem?`

**Typ:** `Tak / Nie / Częściowo / Nie wiem`.

**Logika wewnętrzna:** `Nie`, `Częściowo` i `Nie wiem` tworzą flagę dotyczącą
dostępu i zakresu odpowiedzialności.

## 8. Pytanie końcowe

### 8.1. Czy jest jeszcze coś nietypowego w tej powierzchni, o czym powinniśmy wiedzieć przed montażem?

**Typ:** `Tak / Nie / Nie wiem`.

Po `Tak` pojawiają się nieobowiązkowe pola `Opis` i `Dodaj zdjęcie`.

Na końcu sekcji widoczna jest spokojna informacja:

> Jeśli masz zdjęcie tej powierzchni, możesz je dodać. Zdjęcie nie jest
> obowiązkowe, ale może pomóc nam właściwie przygotować montaż.

`Tak` i `Nie wiem` tworzą flagę do przeglądu.

## Reguły prezentacji i podsumowania

- Formularz ma osiem krótkich sekcji tematycznych. Dla prostej powierzchni
  klient odpowiada na jedenaście pytań głównych bez pól szczegółowych.
- Odpowiedzi szczegółowe rozwijają się bez przeładowania strony i bez
  technicznych nazw kluczy.
- Po ukończeniu powierzchni klient widzi jej nazwę i stan `Uzupełniono` albo
  `Wymaga odpowiedzi`, ale nie widzi wewnętrznych poziomów ryzyka.
- Wewnętrzna karta pokazuje odpowiedzi w formacie `pełne pytanie — odpowiedź`,
  nie w formacie technicznego klucza i kodu `YES/NO`.
- Flagi są przypisane do konkretnego zlecenia, pomieszczenia i powierzchni.
- Zamknięcie flagi wymaga komentarza pracownika lub zapisanej korekty klienta.
- Ogólne oświadczenie o możliwej opłacie za bezskuteczny podjazd pozostaje
  jedno dla całego formularza i nie powtarza się po każdej powierzchni.

## Przykładowy przebieg

Dla `Salon — ściana za sofą` klient odpowiada:

- podłoże: farba;
- gruntowanie: nie wiem;
- wysokość ponad 280 cm: tak, około 310 cm;
- drzwi: ukryte, tapetujemy skrzydło;
- okna: nie;
- zabudowa: nie;
- meble: nie;
- przeszkody: grzejnik, nie będzie zdemontowany.

Wewnętrzne podsumowanie tworzy trzy kwestie:

1. potwierdzić przygotowanie i gruntowanie powierzchni;
2. uwzględnić wysokość około 310 cm;
3. potwierdzić dostęp przy niedemontowanym grzejniku.

Drzwi ukryte są dodatkowo widocznie oznaczone jako element niestandardowy.

## Kryteria jakości treści

1. Każde pytanie odnosi się do jednej, jednoznacznie nazwanej powierzchni.
2. Klient nie musi znać terminologii branżowej; terminy takie jak `glif` mają
   krótkie objaśnienie.
3. Prosta powierzchnia nie otwiera pytań o głębokość glifów, rodzaj drzwi ani
   demontaż elementów.
4. Brak zdjęcia, dokładnej wysokości lub głębokości nie blokuje wysłania.
5. `Nie wiem` nigdy nie znika bez śladu i zawsze prowadzi do właściwego
   wewnętrznego działania.
6. Pytania o wilgoć, odspojenia, przygotowanie podłoża i drzwi ukryte są
   odpowiednio widoczne w podsumowaniu ryzyka.
7. Klient może wrócić do wcześniej uzupełnionej powierzchni przed wysłaniem
   całego formularza.
8. Po wysłaniu odpowiedzi pozostają historycznie niezmienne; późniejsza zmiana
   jest zapisana jako kolejna wersja lub korekta.
