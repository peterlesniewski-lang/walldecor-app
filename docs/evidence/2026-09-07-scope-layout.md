# Czytelność mapy zlecenia — lokalny podgląd

Zakres: wizualna korekta `RoomScopeEditor`, bez zmian API, bazy, payloadów i uprawnień. Bez wdrożenia produkcyjnego.

## Zmiany

- Zachowane Plus Jakarta Sans i istniejąca paleta pracowniczej aplikacji.
- Piaskowy nagłówek pomieszczenia, biała karta zakresu; odstępy 24 px między grupami i 16 px między polami.
- Mniejsze boczne paddingi na telefonie; układ dopasowany do rzeczywistej szerokości sekcji za pomocą container queries.
- Usunięte duże piaskowe tło formularzy pomiaru; zachowany kolor samych pól.
- Krótsze widoczne etykiety i przyciski, zachowane kontekstowe nazwy dostępności.
- Szerokość i wysokość obok siebie także na telefonie, zarówno przy dodawaniu, jak i edycji.
- Wyraźne wskazanie aktywnego trybu pomiaru przez tło, obramowanie i wagę tekstu.

## Weryfikacja

- Nowy test krótkich etykiet: najpierw prawidłowe RED (stara długa etykieta), potem GREEN.
- `npm test -- --run __tests__/unit/installations/room-scope-editor.test.tsx`: 7/7.
- `npm test -- --run __tests__/unit/installations`: 524/524, 69 plików.
- `npm run typecheck:app`: exit 0.
- ESLint dla zmienionego komponentu i testu: exit 0.
- `git diff --check`: exit 0.
- Chromium na lokalnym podglądzie: 360, 430, 768, 1280 px. Automatyczne sprawdzenie położenia szerokości i wysokości oraz braku wychodzenia kontrolek poza viewport.
- Sprawdzone zachowanie szkicu po zmianie szerokości, przejście klawiszem Tab z szerokości do wysokości i przełączenie na pojedynczy wymiar. Test przeglądarkowy nie zapisywał zmian w zleceniu.
- Obejrzane zrzuty desktop i mobile. Pliki `installation-card-2026-09-07/scope-header-*.png` oraz `scope-layout-*.png`.

Nie powtarzano pełnego buildu ani pełnego przebiegu E2E z poprzedniego etapu: powyższe wyniki dotyczą tej lokalnej korekty wizualnej. Nie restartowano podglądu użytkownika.
