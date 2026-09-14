# Faktury EUR: przeliczenie PLN i czytelne kwoty

Status: zakres zatwierdzony przez użytkownika 2026-09-14; implementacja i odbiór w toku.
Data: 2026-09-14.

## Cel i zakres

Użytkownik płaci faktury EUR w EUR. W tym ekranie potrzebuje wartości PLN
według kursu sprzed daty faktycznej zapłaty, z możliwością ręcznej korekty.
Nie budujemy rozliczenia różnic kursowych ani automatycznego rozliczenia WNT.
Przeliczenie zasila istniejące pola raportowe; nie deklarujemy, że zastępuje
wycenę kosztu przyjętą przez księgowość.

Rekomendacja: niewielka integracja oficjalnego API NBP i zawsze dostępny kurs
ręczny. Alternatywa zaakceptowana przez użytkownika: sam kurs ręczny i
automatyczne mnożenie, jeżeli integracja wymagałaby nieproporcjonalnego zakresu.
API NBP nie wymaga klucza, więc na podstawie obecnego rozpoznania rekomendujemy
wariant NBP z ręcznym fallbackiem.

## Zachowanie formularza

- Dla EUR główne pole nazywa się „Kwota do zapłaty (EUR)”. Wartość nadal trafia
  do istniejącego pola `gross`; zmiana etykiety nie przepisuje starych danych.
- Netto i VAT opisują kwoty na dokumencie, nie VAT naliczony przez aplikację.
  EUR nie oznacza automatycznie braku VAT. Jeżeli dokument nie zawiera VAT,
  operator może potwierdzić netto równe kwocie do zapłaty i VAT równy zero.
  Nie dzielimy ani nie mnożymy kwoty przez 1,23. Nie zamieniamy braku danych w zero.
- Dla EUR pojawia się kurs „1 EUR = … PLN”, tryb NBP / ręczny oraz informacja
  o dacie kursu i numerze tabeli, jeśli źródłem jest NBP.
- Po wskazaniu daty zapłaty tryb NBP pobiera ostatni dostępny kurs średni tabeli A
  o dacie ściśle wcześniejszej niż data zapłaty, uwzględniając weekendy i święta.
  Bez daty zapłaty nie podstawiamy automatycznie daty dzisiejszej ani wystawienia.
- Po wpisaniu własnego dodatniego kursu kwoty EUR przeliczają się na PLN.
  Akceptujemy przecinek i kropkę dziesiętną. Zero, wartości ujemne, nieskończone
  i niepoprawne zapisy nie mogą utworzyć ważnego przeliczenia.
- Ręczna zmiana kursu lub końcowej kwoty PLN wyłącza automatyczne nadpisywanie.
  Powrót do NBP wymaga świadomej akcji. Opóźniona odpowiedź NBP nie zastępuje
  ręcznej korekty ani wyniku dla nowszej daty.
- Netto i VAT przeliczamy tylko wtedy, gdy są znane. Zaokrąglenie dziesiętne
  do groszy ma być deterministyczne i zgodne z istniejącą polityką zatwierdzania.
- Zmiana kwot źródłowych, waluty, daty zapłaty, kursu lub ręcznych kwot PLN
  unieważnia wcześniejsze potwierdzenie przeliczenia. W trybie ręcznych kwot PLN
  zachowujemy wpisane wartości, ale wymagamy ponownej weryfikacji użytkownika.
- Zapis szkicu jest nadal możliwy bez ukończonego przeliczenia. Zatwierdzenie
  kosztu wymaga kompletnych, świadomie potwierdzonych danych zgodnie z obecną polityką.

## Dane, API i granice odpowiedzialności

Obecne `reportingGross`, `reportingNet`, `reportingVat`, `conversionNote` oraz
`conversionConfirmed` pozostają zgodne wstecznie. Metadane przeliczenia
(tryb, kurs, data bazowa zapłaty, data kursu i numer tabeli NBP) otrzymują
ustrukturyzowany zapis w danych szkicu i historii, a nie tylko w opisie tekstowym.
AI nie może nadpisywać tych metadanych ani ręcznych korekt.

Osobny moduł odpowiada za walidację kursu i rachunek dziesiętny. Moduł NBP
odpytuje wyłącznie ustalony host `https://api.nbp.pl`, bez przesyłania dokumentu,
dostawcy czy kwot. Chroniony endpoint aplikacji obsługuje wyłącznie EUR i
zweryfikowaną datę. Zapytanie obejmuje ograniczony przedział historyczny,
ma timeout i walidację odpowiedzi. Brak kursu lub niedostępność NBP pokazują
czytelny komunikat i pozostawiają działające wpisanie kursu ręcznego.
Data przyszła nie daje prawa użycia dzisiejszego kursu jako kursu sprzed płatności.

Zapis i zatwierdzanie zachowują kontrolę wersji, istniejące uprawnienia,
ochronę zamkniętych okresów i historię. Serwer kontroluje spójność przeliczenia,
nie ufa samemu checkboxowi z przeglądarki. Stare szkice z ręcznymi kwotami PLN
pozostają czytelne i nie są masowo przeliczane. Zatwierdzone koszty nie zmieniają
się od nowego kursu, pobrania tabeli ani wdrożenia.

## Sprawdzenie przed uznaniem funkcji za gotową

Testy obejmą: zwykły dzień, poniedziałek, święto, brak daty, datę przyszłą,
niedostępność NBP, ręczny kurs, ręczną kwotę PLN, spóźnioną odpowiedź,
zaokrąglenia, nieznane netto/VAT, brak VAT na dokumencie, zmianę podstawy po
potwierdzeniu, zapis i ponowne otwarcie oraz zgodność zapisanego kosztu w PLN.
Istniejący flow PLN, stare szkice i ochrona zatwierdzonych kosztów mają pozostać
bez regresji. Testy automatyczne i build poprzedzają test całej ścieżki na
izolowanych danych. Wdrożenie i działanie na produkcji są odrębnymi stanami.

## Równoległa diagnoza podglądu oryginału — bez wdrożonej poprawki

Kontrola produkcyjna wykazała zgodność rozmiaru i SHA-256 oryginału z metadanymi;
PDF otwiera się bezpośrednio w osobnej karcie. Odczyt konfiguracji wykazał
włączone middleware kompresji na routerze HTTPS aplikacji.

W `src/lib/invoice-import/client.ts` podgląd wymaga dokładnego `Content-Length`
przed odczytem treści. Lokalny test rzeczywistego HTTP na sztucznym PDF-ie
wykazał: bez kompresji PASS; gzip bez `Content-Length` daje `INVALID_ORIGINAL`,
chociaż rozpakowane dane mają zgodny rozmiar i SHA-256. To potwierdzony defekt
zgodności transportu i mocna hipoteza przyczyny produkcyjnego objawu.
Nie odczytano nagłówków konkretnego błędnego żądania użytkownika.

Proponowana naprawa do zatwierdzenia: weryfikować typ dokumentu, ograniczony
strumień rozkodowanych danych, jego dokładny rozmiar i SHA-256; nie wymagać
`Content-Length` równego rozmiarowi oryginału dla skompresowanego transportu
ani nie odrzucać poprawnego strumienia tylko dlatego, że tego nagłówka brak.
Nie wyłączać kontroli integralności ani nie upubliczniać plików. Dodać test
transportu gzip/chunked, uszkodzonego i uciętego pliku oraz test realnego podglądu
przez proxy. Sama ta specyfikacja nie naprawia ani nie wdraża podglądu.

## Źródła

- Oficjalne API NBP: https://api.nbp.pl/
- Dokumentacja kompresji Traefik:
  https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/compress/
