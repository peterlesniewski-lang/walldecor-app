# Pilot 01 — backlog świadomie odłożony

Pilot potwierdza wyłącznie wewnętrzny przebieg Tasków 1–5. Nie jest dowodem działania na produkcji, wysyłki wiadomości, połączenia CRM ani wdrożenia środowiska pośredniego.

## Alteracje z ręcznego przeglądu i testów firmowych

Poniższe pozycje są wyłącznie zebranymi uwagami. Nie wdrażamy ich pojedynczo
w trakcie przeglądu. Po zakończeniu testów firmowych ustalamy wspólny zakres,
testy regresji i wykonujemy jeden kontrolowany pakiet zmian.

### ALT-FORM-01 — widoczny pojedynczy wybór zamiast samej listy rozwijanej

**Obecne zachowanie:** pytanie typu `Jedna odpowiedź` jest prezentowane
klientowi jako lista rozwijana. Kreator nie pozwala wybrać wariantu, w którym
wszystkie odpowiedzi są od razu widoczne jako pola pojedynczego wyboru.

**Oczekiwane zachowanie:** pytanie `Jedna odpowiedź` może zostać pokazane jako
czytelne kafelki lub pola radio. Klient widzi wszystkie opcje, może wybrać tylko
jedną, a wybranie kolejnej zastępuje poprzednią odpowiedź. Widok ma działać
równie wygodnie na telefonie i komputerze.

**Kryteria odbioru:**

1. Wszystkie odpowiedzi są widoczne bez otwierania listy.
2. Jednocześnie można zaznaczyć dokładnie jedną odpowiedź.
3. Zmiana wyboru poprawnie aktualizuje autosave i logikę pytań podrzędnych.
4. Sterowanie działa klawiaturą i ma prawidłowe etykiety dostępności.
5. Podgląd kreatora i publiczny formularz klienta pokazują ten sam wariant.

### ALT-FORM-02 — działania przypisane do konkretnej odpowiedzi

**Obecne zachowanie:** pytanie typu `Jedna odpowiedź` pozwala zbudować pytanie
podrzędne dla wybranej opcji, ale poziom ryzyka dotyczy całego pytania. Kreator
nie pozwala oznaczyć tylko wybranych odpowiedzi jako wymagających ustalenia.
Tekst `Nie wiem` wpisany jako zwykła opcja również nie tworzy automatycznie
flagi.

**Oczekiwane zachowanie:** każda opcja odpowiedzi może niezależnie otrzymać:

- ustawienie `Wymaga ustalenia`;
- poziom ważności i komunikat widoczny dla pracownika;
- pytanie podrzędne otwierane wyłącznie po wybraniu tej odpowiedzi.

Nie wolno rozpoznawać działania po samej treści opcji. Konfiguracja musi być
jawna, wersjonowana razem z szablonem i zachowana w migawce formularza
przypiętej do zlecenia.

**Przypadek referencyjny — stan powierzchni:**

| Odpowiedź | Wymaga ustalenia | Dalsze pytanie |
| --- | --- | --- |
| Gładź lub tynk | Nie | — |
| Farba | Nie | — |
| Stara tapeta | Tak | — |
| Surowa płyta gipsowo-kartonowa | Nie | — |
| Beton | Nie | — |
| Inne | Tak | `Opisz powierzchnię` — pole nieobowiązkowe |
| Nie wiem | Tak | — |

**Kryteria odbioru:**

1. `Farba` nie tworzy kwestii do ustalenia.
2. `Stara tapeta` tworzy jedną właściwie opisaną kwestię.
3. `Inne` tworzy kwestię i pokazuje nieobowiązkowe pole `Opisz powierzchnię`.
4. `Nie wiem` tworzy kwestię również w pytaniu typu `Jedna odpowiedź`.
5. Zmiana `Inne` na inną opcję ukrywa i usuwa z aktywnej odpowiedzi wartość
   pytania podrzędnego.
6. Istniejące opublikowane szablony i historyczne migawki zachowują dotychczasowe
   działanie.

## Po pilocie: Task 5 (P2)

- **P2-5A — odpowiedź błędna prywatnej usługi plików:** klient API przy HTTP non-2xx ma jawnie anulować lub odczytać body odpowiedzi. Dodać ograniczone czasowo testy body błędów dla uploadu, podpisania, pobrania i usuwania.
- **P2-5B — odporność parsera uploadu:** rozszerzyć testy multipart o wiele plików, zduplikowane pola, nieprawidłowy multipart oraz backpressure/deadlock/fuzz.

**Warunek środowiska, nie P2 kodu:** launcher pozwala w tym pilocie ocenić UX uploadu/QR wyłącznie na fikcyjnych plikach i lokalnym adapterze testowym. Przed technicznym smoke bezpieczeństwa trzeba uruchomić właściwą prywatną usługę plików z ClamAV; wynik pilota nie jest takim dowodem.

## Kolejne etapy, poza pilotem

| Task | Świadomie poza zakresem |
| --- | --- |
| 6 | Konto instalatora i szczelna nawigacja. |
| 7 | Wizyty, wielu instalatorów i Google Calendar. |
| 8 | Materiały i potwierdzone przekazania. |
| 9 | Raport wizyty, odbiór zakresu, podpis i PDF. |
| 10 | Jedno końcowe zadanie do faktury po pełnym odbiorze zlecenia. |
| 11 | Gmail, przypomnienia, Sheets i niezawodny worker. |
| 12 | Wiki, backup, restore i gotowość produkcyjna. |

Decyzje po pilocie zapisujemy z obserwacji, a nie z założeń: co potwierdzono, co nie było testowane i co wymaga osobnego technicznego sprawdzenia.
