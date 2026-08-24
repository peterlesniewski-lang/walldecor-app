export type InstallationGuideAudience = 'COORDINATOR' | 'INSTALLER' | 'ADMIN'

export type InstallationGuideSection = {
  title: string
  introduction?: string
  steps: string[]
  attention?: string
}

export type InstallationGuide = {
  slug: 'opiekun-karty' | 'zastepca-przejecie-karty' | 'instalator' | 'admin'
  title: string
  summary: string
  audience: InstallationGuideAudience
  audienceLabel: string
  updatedAt: string
  sections: InstallationGuideSection[]
}

/**
 * Instalacyjne instrukcje są celowo przechowywane w kodzie: są dostępne po
 * wdrożeniu, nie zależą od seedów ani od uprawnień Business Wiki. Gdy proces
 * dojrzeje, mogą zostać ręcznie przeniesione do Wiki jako osobny projekt.
 */
export const INSTALLATION_GUIDES: readonly InstallationGuide[] = [
  {
    slug: 'opiekun-karty',
    title: 'Opiekun karty montażu',
    summary: 'Od utworzenia karty, przez formularz klienta i planowanie, po kontrolę realizacji ustalonego zakresu.',
    audience: 'COORDINATOR',
    audienceLabel: 'Opiekun karty',
    updatedAt: '2026-08-24',
    sections: [
      {
        title: '1. Załóż kartę z odpowiedzialnością',
        introduction: 'Każde zlecenie ma jednego opiekuna i jednego zastępcę. Nie zostawiaj karty bez obu ról.',
        steps: [
          'W Montaże wybierz „Nowa karta” i wpisz klienta oraz pełny adres montażu.',
          'Wybierz dwóch różnych aktywnych pracowników: opiekuna i zastępcę. Jako opiekun odpowiadasz za kompletność ustaleń.',
          'Dodaj pokoje, a w nich zakresy, produkty, wymiary i pliki projektu. Dla tapet zapisuj przede wszystkim szerokość × wysokość; dodatkowy wymiar dodaj tylko, gdy jest potrzebny.',
        ],
        attention: 'Nie wpisuj w notatkach haseł, danych kart płatniczych ani innych informacji, których nie potrzebuje montaż.',
      },
      {
        title: '2. Przygotuj i wyślij formularz klienta',
        steps: [
          'Na karcie wybierz opublikowany szablon formularza i przypnij dokładnie jedną jego wersję do zlecenia.',
          'Wygeneruj bezpieczny link, ustaw jego ważność i wyślij klientowi zwykłym firmowym e-mailem. Sama wysyłka e-maila pozostaje po stronie zespołu.',
          'Sprawdź status formularza na liście kart: gotowy do wysłania, oczekuje, w trakcie albo wypełniony.',
          'Jeśli odpowiedź jest „nie wiem” albo wynika z niej ryzyko (np. glify, drzwi ukryte), utwórz lub zamknij ustalenie przed terminem. Nie traktuj braku odpowiedzi jako „nie”.',
        ],
        attention: 'Wizytę planuj dopiero po zamknięciu blokujących ustaleń. Przy niezgodności na miejscu obowiązuje kwota podjazdu ustawiona na tej karcie i zaakceptowana przez klienta w formularzu.',
      },
      {
        title: '3. Zaplanuj zakresy i ekipę',
        steps: [
          'W sekcji „Wizyty i terminy” utwórz szkic wizyty, zaznacz konkretne zakresy i zapisz ekipę dla każdego zakresu.',
          'Dodaj początek i koniec wizyty w czasie warszawskim. Potwierdzenie wizyty przekazuje ją do kolejki Google Calendar.',
          'W jednym zleceniu można rozdzielić zakresy pomiędzy kilku instalatorów i kilka wizyt. Instalator nie jest koordynatorem karty.',
          'Po zmianie terminu aplikacja aktualizuje istniejące wydarzenie; nie twórz ręcznie drugiego wydarzenia dla tej samej wizyty.',
        ],
        attention: 'Status „Wymaga uwagi” przy kalendarzu oznacza, że trzeba sprawdzić błąd i świadomie zdecydować o ponowieniu albo nadpisaniu konfliktu.',
      },
      {
        title: '4. Czynności poza obecnym modułem',
        steps: [
          'Przekazanie towaru, raport z wizyty, zdjęcia, odbiór prac i informację do fakturowania obsługuj obecnie dotychczasowym firmowym kanałem poza tym ekranem.',
          'Nie oczekuj na karcie przycisków raportu ani odbioru — nie są częścią tej wersji modułu montaży.',
          'Systemowy moduł protokołów i odbiorów będzie osobnym wdrożeniem. Do tego czasu nie traktuj samego statusu wizyty jako potwierdzenia odbioru albo podstawy faktury.',
          'Historia formularza, zaplanowanych wizyt i odpowiedzialności pozostaje na karcie; pozostałe dokumenty zachowuj zgodnie z aktualnym procesem firmy.',
        ],
      },
    ],
  },
  {
    slug: 'zastepca-przejecie-karty',
    title: 'Zastępca i przejęcie karty',
    summary: 'Bezpieczne zastępstwo bez uzależniania dostępu od wpisanego urlopu albo pamięci zespołu.',
    audience: 'COORDINATOR',
    audienceLabel: 'Zastępca',
    updatedAt: '2026-08-24',
    sections: [
      {
        title: '1. Co daje rola zastępcy',
        steps: [
          'Zastępca jest przypisany już przy tworzeniu karty i widzi ją niezależnie od tego, czy opiekun zgłosił urlop.',
          'Może kontynuować ustalenia, planować wizyty i obsługiwać dokumenty w granicach standardowych uprawnień pracownika.',
          'Na początku sprawdź aktualny status formularza, otwarte ustalenia, najbliższe wizyty, ekipę zakresów i status synchronizacji z kalendarzem.',
        ],
        attention: 'Zastępca nie powinien zakładać, że brak komentarza oznacza brak ryzyka. Otwórz historię odpowiedzi i sprawdź sprawy „wymaga ustalenia”.',
      },
      {
        title: '2. Przejmij zadanie na czas nieobecności',
        steps: [
          'Jeżeli zastępca wystarcza, pracuje na tej samej karcie — nie zakładaj kopii zlecenia.',
          'Gdy potrzebna jest trzecia osoba, administrator lub manager może w sekcji „Odpowiedzialność” ustanowić czasową delegację z początkiem, końcem i krótkim powodem.',
          'Po powrocie opiekuna delegację można zakończyć wcześniej. Historia zachowuje kto i kiedy zmienił odpowiedzialność.',
          'Jeżeli zmienia się stała odpowiedzialność, administrator lub manager ustawia nowego opiekuna oraz nowego zastępcę; obie osoby muszą być aktywne i różne.',
        ],
      },
      {
        title: '3. Przekaż kontekst bez zgadywania',
        steps: [
          'Przed planowaną wizytą sprawdź: zakresy, pomiary, pliki, wymagania klienta, otwarte ustalenia i przypisaną ekipę.',
          'Zmianę terminu wykonaj wyłącznie w aplikacji. Stare wydarzenie Calendar jest aktualizowane przez kolejkę synchronizacji.',
          'Jeżeli kalendarz pokaże konflikt, nie nadpisuj go automatycznie. Najpierw sprawdź stan faktyczny oraz zapis na karcie.',
        ],
        attention: 'Nie przekazuj danych klienta poza kartą i firmowymi kanałami. Instalator ma dostęp wyłącznie do informacji niezbędnych dla jego zakresów.',
      },
    ],
  },
  {
    slug: 'instalator',
    title: 'Instalator: zakres i termin wizyty',
    summary: 'Widok tylko do odczytu dla przypisanych zakresów i wizyt, z terminem oraz bez dostępu do prywatnych ustaleń klienta.',
    audience: 'INSTALLER',
    audienceLabel: 'Instalator',
    updatedAt: '2026-08-24',
    sections: [
      {
        title: '1. Co widzisz w aplikacji',
        steps: [
          'Po zalogowaniu otwórz Montaże. Widzisz wyłącznie karty, na których przypisano Ci konkretny zakres lub wizytę.',
          'Karta instalatora jest tylko do odczytu. Sprawdź adres, nazwę klienta, przypisane Ci zakresy oraz datę i godziny własnej wizyty.',
          'Jeżeli przy wizycie jest dostępny link do wydarzenia Google Calendar, możesz go otworzyć. Brak linku nie zmienia terminu zapisanego na karcie.',
          'Jeżeli nie widzisz zlecenia albo zakresu, skontaktuj się z opiekunem dotychczasowym firmowym kanałem i poproś o prawidłowe przypisanie w karcie.',
        ],
        attention: 'Nie masz dostępu do formularza klienta, jego odpowiedzi, e-maila, telefonu, notatek koordynatora ani danych technicznych synchronizacji. To celowe ograniczenie prywatności.',
      },
      {
        title: '2. Przed wyjazdem i na miejscu',
        steps: [
          'Przed wyjazdem potwierdź na karcie własny termin, pomieszczenie i zakres wskazany przy Twojej wizycie.',
          'Ustalenia o materiale i przekazaniu towaru pozostają obecnie poza tym ekranem — sprawdzaj je dotychczasowym firmowym kanałem.',
          'Jeżeli stan na miejscu różni się od przypisanego zakresu albo bezpieczne wykonanie jest niemożliwe, przerwij decyzję o dalszej pracy i skontaktuj się z opiekunem poza aplikacją. Nie rozstrzygaj samodzielnie opłaty za podjazd.',
        ],
      },
      {
        title: '3. Czego ten ekran jeszcze nie obsługuje',
        steps: [
          'Raportowanie wizyty, zdjęcia, potwierdzenie towaru, odbiór prac i informacja do fakturowania pozostają obecnie poza aplikacją i wykonujemy je dotychczasowym firmowym kanałem.',
          'Systemowy moduł protokołów i odbiorów będzie osobnym wdrożeniem; w tej wersji nie ma przycisku raportu ani formularza odbioru.',
          'Jeżeli opiekun potrzebuje potwierdzenia po wizycie, przekaż je poza aplikacją zgodnie z aktualnym procesem firmy.',
        ],
      },
    ],
  },
  {
    slug: 'admin',
    title: 'Administrator modułu montaży',
    summary: 'Katalogi, konta instalatorów, gotowość Calendar oraz bezpieczne rozwiązywanie konfliktów synchronizacji.',
    audience: 'ADMIN',
    audienceLabel: 'Administrator',
    updatedAt: '2026-08-24',
    sections: [
      {
        title: '1. Katalogi i szablony',
        steps: [
          'W Montaże → Katalogi zarządzaj typami produktów i ich pozycjami. Dodawaj nowe pozycje, zamiast wpisywać je na stałe w kodzie lub w nazwach pokoi.',
          'W kreatorze pytań przygotuj formularze z warunkami. Każdy warunek wskazuje istniejące pytanie nadrzędne i konkretną odpowiedź uruchamiającą pytanie podrzędne.',
          'Opublikowany szablon jest wersją historyczną; zmiana wymaga nowego szkicu. Karta zachowuje przypięty snapshot, więc późniejsza zmiana szablonu nie zmienia historii klienta.',
        ],
      },
      {
        title: '2. Konta i aktywni pracownicy',
        steps: [
          'Konto z rolą INSTALATOR musi być połączone dokładnie z jednym aktywnym pracownikiem. Bez aktywnego powiązania nie powinno otrzymać dostępu.',
          'Dezaktywacja pracownika musi oznaczać blokadę konta instalatora albo zmianę jego roli/powiązania zgodnie z polityką kont.',
          'Administrator widzi wszystkie karty. Może czasowo delegować pracownika lub przepiąć stałego opiekuna i zastępcę, zachowując historię audytową.',
        ],
        attention: 'Nie używaj wspólnych kont instalatorów. To uniemożliwia przypisanie zakresu i audyt działań do właściwej osoby.',
      },
      {
        title: '3. Google Calendar i worker',
        steps: [
          'W ustawieniach sprawdź wyłącznie gotowość Calendar: czy synchronizacja jest włączona, adapter to Google, są poświadczenia, kalendarz firmowy i impersonacja info@walldecor.pl.',
          'Sekrety konfigurujemy wyłącznie w środowisku wdrożeniowym (Coolify). Ekran ustawień nie pokazuje klucza prywatnego, identyfikatora kalendarza ani treści sekretów.',
          'Worker pobiera kolejkę synchronizacji, rejestruje próby i stosuje retry. Uruchamiaj go przez skonfigurowaną usługę/komendę, nie przez ręczne wywołanie z kluczem w terminalu.',
          'Przed włączeniem Google przeprowadź test na wydzielonym wydarzeniu i potwierdź, że zmiana wizyty aktualizuje to samo wydarzenie.',
        ],
      },
      {
        title: '4. Konflikty i wymuszenie',
        steps: [
          'Przy statusie „Wymaga uwagi” odczytaj bezpieczny komunikat błędu oraz porównaj termin, zakres i uczestników z kartą.',
          'W przypadku konfliktu wersji najpierw odśwież dane. Wymuszenie jest wyjątkiem dla administratora/managera po potwierdzeniu, że zapis w aplikacji jest właściwy.',
          'Nie używaj wymuszenia do omijania braku konfiguracji, błędu uprawnień Google albo nieznanego stanu wydarzenia. Te przypadki wymagają naprawy konfiguracji i ponowienia kolejki.',
        ],
        attention: 'Worker nie może logować ani zwracać sekretów. W zgłoszeniu błędu podawaj identyfikator wizyty i czas zdarzenia, nie dane dostępowe.',
      },
    ],
  },
] as const

export function findInstallationGuide(slug: string): InstallationGuide | null {
  return INSTALLATION_GUIDES.find((guide) => guide.slug === slug) ?? null
}
