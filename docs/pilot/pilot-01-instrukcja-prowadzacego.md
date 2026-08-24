# Pilot 01 — instrukcja prowadzącego

**Cel:** w 10–15 minut sprawdzić prostą ścieżkę od karty do odpowiedzi osoby wypełniającej formularz i jej obsługi. To test wyłącznie firmowy — nie zapraszamy klienta: **A** jest opiekunem, **B** jest pracownikiem symulującym klienta na komputerze i telefonie, **C** jest pracownikiem obserwującym. Używamy wyłącznie fikcyjnych danych i plików; link przekazujemy B ręcznie. Nie wysyłamy e-maili, nie używamy CRM ani produkcyjnych danych klientów.

## Przed spotkaniem (poza czasem testu)

1. Uzgodnij jedno środowisko dostępne dla A i B: lokalne albo wspólna sieć/LAN. Nie zakładamy ani nie komunikujemy istnienia stagingu.
2. A ma konto administratora lub managera oraz dwóch różnych aktywnych pracowników do roli opiekuna i zastępcy. Przygotuj mały, fikcyjny plik JPG/PNG/PDF, bez danych osobowych.
3. Na ekranie **Katalog i formularze** (`/installations/catalog`) utwórz i opublikuj `Pilot 01`. Dodaj trzy pytania: `Czy są glify?` (`YES_NO_UNKNOWN`), `Ile cm ma glif?` (`DIMENSION`, warunek: klucz `glify`, wartość `YES`) oraz opcjonalne `Zdjęcie/plik testowy` (`FILE`). Pytanie o plik nie może blokować wysłania formularza.
4. W **Montaże** utwórz fikcyjną kartę: klient `Pilot 01`, testowy e-mail/telefon/adres, opiekun i zastępca. Dodaj pomieszczenie `Salon`, przypnij opublikowany formularz, następnie w sekcji **Formularz klienta** wybierz **Wygeneruj link** i przekaż go B ręcznie.

Launcher pilota udostępnia pliki wyłącznie przez lokalny adapter testowy. Możemy więc sprawdzić wygodę dodawania fikcyjnego zdjęcia i przekazania go z telefonu, ale ten wynik **nie potwierdza** skanowania ClamAV ani bezpieczeństwa produkcyjnego magazynu plików. Jeżeli pilot jest uruchamiany bez launchera lub opcja plików nie działa, pomiń upload i QR; nie blokuje to zasadniczego testu formularza.

## Przebieg

| Minuty | Osoba | Czynność | Co powinno się wydarzyć |
| --- | --- | --- | --- |
| 0–1 | C | Wyjaśnia, że testujemy ekran, nie ludzi; nie podpowiada. | B zna cel i może mówić na głos. |
| 1–5 | B, komputer | Otwiera przekazany link, przegląda mapę zlecenia i odpowiada na pytania. Przy pytaniu o glify wybiera **Nie wiem**. | Widać `Ustalimy przed montażem`; pole centymetrów nie jest widoczne; po chwili jest `Wszystko zapisane`. |
| 5–7 | B, telefon | Otwiera ten sam link na telefonie i sprawdza, czy zrozumiale widzi formularz oraz wcześniejszą odpowiedź. | Układ jest czytelny bez bocznego panelu; odpowiedź jest zachowana. |
| 7–9 | B, komputer + telefon | **Tylko gdy prowadzący potwierdzi działanie plików testowych:** na komputerze wybiera **Dodaj z telefonu**, a na telefonie dodaje fikcyjny plik przez kod. | Telefon potwierdza dodanie, a komputer pokazuje nazwę pliku. Gdy opcja nie działa: zapisz `nie testowano — brak usługi`, bez oceny UX jako błędu. Wynik dotyczy tylko UX, nie zabezpieczeń produkcyjnych. |
| 9–11 | B, komputer | Wysyła formularz. | Komunikat `Formularz został wysłany.` i przycisk `Zgłoś korektę`. |
| 11–13 | A | Na karcie widzi `Wymaga ustalenia przed terminem montażu`, zapisuje krótkie ustalenie dla glifów i wybiera **Oznacz jako ustalone**. | Stan zmienia się na `Gotowe do planowania`. |
| 13–15 | B, komputer | Wybiera **Zgłoś korektę**, zmienia jedną odpowiedź i ponownie wysyła. | Widoczne potwierdzenie wersji 2; A widzi historię odpowiedzi w karcie. |

## Zakończenie

C zbiera kartę obserwacji. A nie usuwa ani nie archiwizuje danych w trakcie rozmowy. Po teście można zarchiwizować wyłącznie testową kartę; nie jest to część pilota.
