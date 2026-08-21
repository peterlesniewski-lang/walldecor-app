# WallDecor Montaże — system interfejsu

## Dwa świadomie różne środowiska

### Formularz klienta

Klient zwykle otwiera link wiele dni po zakupie, na telefonie albo komputerze.
Ma opisać prawdziwy stan pomieszczeń bez poczucia, że wypełnia dokumentację
techniczną. Interfejs ma być spokojny jak konsultacja w showroomie, prowadzić
małymi krokami i wyraźnie pokazywać kwestie, które WallDecor musi ustalić przed
montażem.

### Panel pracownika i instalatora

Pracownik ma szybko rozpoznać stan zlecenia, odpowiedzialność, terminy i blokady.
Instalator ma zobaczyć własny zakres oraz wykonać działania terenowe bez danych
finansowych. Panel zachowuje istniejącą nawigację aplikacji, ale karta zlecenia
organizuje informacje wokół przebiegu montażu, nie wokół generycznych kafelków.

## Domena

- pomieszczenia, ściany, sufity i glify;
- próbki tapet, profile sztukaterii i paczki materiału;
- miarka, wymiary, rzut mieszkania i oznaczenia na planie;
- taśma malarska, notatki wykonawcze i lista przygotowania;
- kolejne wizyty, przekazanie materiału i odbiór wykonanych zakresów.

## Świat kolorów

- `--plaster`: ciepła biel gładzi — główne tło;
- `--paper`: kremowy papier tapety — powierzchnie podniesione;
- `--sand`: piaskowy tynk — powierzchnie pomocnicze i pola wejściowe;
- `--graphite`: grafit narzędzi — tekst główny i nawigacja;
- `--masking-tape`: bursztynowa taśma — jedyny akcent działania;
- `--site-green`: stonowana zieleń — stan zakończony;
- `--site-red`: ceglasty czerwony — błąd albo realna blokada;
- `--attention`: ochra — informacja wymagająca ustalenia.

Kolor służy statusowi albo działaniu. Nie używamy dekoracyjnych gradientów,
fioletowych akcentów ani kilku równorzędnych kolorów marki.

## Element rozpoznawczy: Mapa zlecenia

Mapa zlecenia jest przestrzennym indeksem pomieszczeń i zakresów. Pokazuje
ukończenie, nierozwiązane kwestie, materiały i wizyty w kontekście konkretnego
pomieszczenia. W formularzu zastępuje generyczny pasek kroków; w panelu zastępuje
siatkę oderwanych kart KPI; na telefonie staje się przewijalną listą miejsc.

Sygnatura pojawia się co najmniej w:

1. ekranie startowym klienta;
2. przełączaniu pomieszczeń w formularzu;
3. podsumowaniu przed wysłaniem;
4. szczegółach karty dla koordynatora;
5. briefie wizyty instalatora.

## Odrzucone domyślne wzorce

- długi jednopłaszczyznowy formularz → małe grupy pytań w kontekście pokoju;
- zwykły liniowy progress bar → Mapa zlecenia z realnymi pomieszczeniami;
- dashboard z kafelkami statystyk → oś pracy: przygotowanie, wizyty, odbiory;
- dominujący upload zdjęć → zdjęcia jako pomocnicza odpowiedź, z QR na komputerze;
- modal do całego procesu → pełne, spokojne strony z zachowaniem postępu.

## Typografia

- nagłówki: `Bricolage Grotesque`, skrajne wagi 700–800, zwarte tracking;
- treść i kontrolki: `Spline Sans`, 400–600;
- identyfikatory zleceń, wymiary i daty techniczne: dostępny krój mono z cyframi
  tabularnymi, tylko gdy poprawia skanowanie danych;
- fonty muszą zawierać komplet polskich znaków i być serwowane lokalnie albo
  przez istniejący mechanizm Next Font.

## Głębia, powierzchnie i obramowania

Strategia: subtelne cienie. Cień podkreśla tylko warstwę znajdującą się nad
inną powierzchnią; nie dekoruje każdej karty.

- poziom 0: `plaster`, tło strony;
- poziom 1: `paper`, główna powierzchnia treści;
- poziom 2: jaśniejszy `paper`, menu, QR i wysuwane podsumowanie;
- pola wejściowe: lekko ciemniejszy `sand`, aby wyglądały jak miejsce na dane;
- obramowania: ciepły grafit o małym kryciu, osobne natężenie dla separatora,
  elementu aktywnego i focus ring.

Promienie są umiarkowane: małe dla kontrolek, średnie dla grup pytań, większe
tylko dla głównego arkusza. Nie łączymy miękkich kart z ostrymi przypadkowymi
kontrolkami.

## Rytm i ruch

- bazowa jednostka odstępu: 4 px;
- kontrolki dotykowe klienta mają co najmniej 44 px wysokości;
- sekcje używają wielokrotności 4 px, najczęściej 8/12/16/24/32;
- autosave sygnalizuje krótkie przejście `Zapisywanie…` → `Wszystko zapisane`;
- przejście do kolejnej grupy pytań używa jednego spokojnego wejścia treści;
- bez bounce, parallaxu i rozproszonych animacji dekoracyjnych;
- `prefers-reduced-motion` wyłącza ruch niepotrzebny do zrozumienia stanu.

## Wzorce zachowania

- `Nie wiem` nigdy nie blokuje wysłania formularza, lecz tworzy czytelny stan
  `Ustalimy przed montażem` widoczny klientowi i opiekunowi;
- pytania warunkowe ujawniają się bez utraty wcześniejszych odpowiedzi;
- zdjęcia nie są obowiązkowe, chyba że opublikowany szablon jawnie tak stanowi;
- na urządzeniu mobilnym upload obrazu może zaoferować aparat i bibliotekę;
- na komputerze QR otwiera dokładnie dane pytanie, a postęp synchronizuje się;
- każdy widoczny przycisk, link, ikona i menu ma działanie albo nie jest renderowany;
- wszystkie kontrolki mają stany default, hover, active, focus, disabled,
  loading, empty i error odpowiednio do swojej funkcji.

## Checkpoint przed napisaniem komponentu UI

Przed kodem komponentu wykonawca zapisuje w raporcie zadania:

```text
Intent: kto używa komponentu, co ma wykonać i jak ma się czuć
Palette: które tokeny domenowe są użyte i dlaczego
Depth: subtelny cień albo brak podniesienia i dlaczego
Surfaces: poziomy powierzchni rodzica, kontrolki i nakładki
Typography: rola Bricolage/Spline/mono
Spacing: wielokrotności bazowych 4 px
```

