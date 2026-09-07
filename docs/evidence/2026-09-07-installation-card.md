# Uproszczona karta montażu — raport podglądu

Zakres: lokalny podgląd do oceny przez pracowników. Bez wdrożenia, zmiany kont lub wysyłania rzeczywistych zaproszeń/e-maili.

## Zmiany

- Jedna strona: podsumowanie → sprawy do ustalenia → zakres → formularz klienta → wizyty → załączniki → zwinięte ustawienia.
- Edycja kontaktu otwierana na żądanie. Zapis odświeża podsumowanie; anulowanie zmienionych pól wymaga potwierdzenia. Telefon/e-mail mają odnośniki `tel:`/`mailto:`.
- Otwarte kwestie na górze, osobne komunikaty o formularzu i akceptacji opłaty; zamknięte kwestie w historii. Brak otwartych kwestii nie jest deklaracją gotowości montażu.
- Szablon, link i odpowiedzi w jednej sekcji. Najnowsze odpowiedzi otwierane jednym przyciskiem. Starsze wersje i zarządzanie linkiem rozwijane osobno.
- Świeży adres klienta pozostaje po oznaczeniu wysyłki, zwinięciu i odświeżeniu danych tej samej karty. Znika po potwierdzonym unieważnieniu/zastąpieniu przez inne okno. Pełne przeładowanie lub opuszczenie karty nadal usuwa sekret URL z pamięci ekranu.
- Załączniki domyślnie dla całego zlecenia; wybór pomieszczenia/zakresu i dokumentacja istniejących zgłoszeń na żądanie. Zachowano chronione pobrania i ponawianie usuwania.
- Odświeżenie danych nie zeruje szkiców kontaktu, wizyty, plików i ustaleń. Równoległa zmiana edytowanej wizyty wymaga jawnego wczytania aktualnych danych.
- Instalator korzysta z ograniczonych zapytań już na poziomie bazy, a nie dopiero prezentera. Chroni to również diagnostyczne odpowiedzi RSC trybu developerskiego.
- Instrukcja koordynatora zaktualizowana w katalogu wiki montaży.

## Zatwierdzony wyjątek: migracja

Użytkownik dopuścił małą migrację po wykryciu sprzeczności: istniejący CHECK w SQLite wymagał dodatkowej notatki lub dowodu, mimo planowanej opcjonalności.

`20260907000000_installation_resolution_optional_note` usuwa wyłącznie ten dodatkowy wymóg dla stanu `RESOLVED`. Treść ustalenia, autor i czas pozostają wymagane. Stan `WAIVED` nadal wymaga uzasadnienia. Migracja w transakcji kopiuje wszystkie kolumny, odtwarza klucze i indeksy. Nie zmienia pytań ani reguł ryzyka.

Test migracji porównuje wszystkie wcześniejsze rekordy OPEN/RESOLVED/WAIVED przed i po zmianie, sprawdza indeksy, ograniczenia, klucze obce i integralność SQLite. Uruchomiono wyłącznie na izolowanych bazach. Przed przyszłym wdrożeniem wymagany jest backup i standardowe `prisma migrate deploy`; nie używać `db push` do zastąpienia tej migracji.

## Weryfikacja

Końcowe wyniki (7 września 2026). Testy korzystają z syntetycznych kont i danych.

| Bramka | Wynik |
| --- | --- |
| Testy jednostkowe i integracyjne modułu | 85 plików, **645/645** |
| `npm run typecheck:app` | OK, kod wyjścia 0 |
| `npm run build` | OK, kod wyjścia 0 |
| ESLint zmienionych komponentów, helperów i nowego E2E | OK, kod wyjścia 0 |
| Regresja przeglądarkowa: karta, formularz, governance, kalendarz | **7/7**, ok. 1 min |
| Prywatność na uruchomionym produkcyjnym buildzie | HTML i API instalatora: HTTP 200, bez kontaktu klienta i treści ustaleń |
| Szerokości 360 / 430 / 768 / 1280 px | Testy i kontrola zrzutów OK; poprawiono szerokość wyboru szablonu przy 360 px |
| Restart procesu i pliki | Dane karty oraz identyczne bajty PNG dostępne po restarcie; usunięcie sprawdzone |
| Migracja z istniejącymi danymi | Historia identyczna, indeksy/FK/CHECK zachowane, `integrity_check=ok` |

Podczas wcześniejszego uruchomienia testów modułu równolegle z E2E wystąpiły dwa niepowodzenia czasowych testów dzierżawy Calendar. Dwa końcowe wykonania modułu bez równoległego E2E zakończyły się 645/645. Nie zmieniano implementacji Calendar ani tych testów; warto uwzględnić tę wrażliwość przy obciążonym lokalnym runnerze.

Scenariusz `e2e/installations-card.spec.ts` tworzy kartę i zakres przez UI, wybiera formularz, generuje link, wysyła odpowiedź klienta „Nie wiem”, zamyka kwestię samą treścią ustalenia, planuje i zmienia wizytę. Operacje pracownika nie wymagają ręcznego odświeżania strony. Obejmuje też błędy sieci/409, zachowanie szkiców, pobranie dokładnych bajtów PNG, anonimową odmowę dostępu, widok zastępcy i ograniczony HTML instalatora.

Restart procesu testowego jest wyzwalany prywatnym plikiem w zweryfikowanym katalogu `/tmp/walldecor-installations-e2e-*`, nigdy publicznym endpointem. Po restarcie ten sam test ponownie odczytuje kartę i bajty pliku, następnie usuwa plik.

Integracje w E2E: lokalny adapter prywatnych plików oraz testowy Calendar. Wynik nie stanowi potwierdzenia działania produkcyjnego Google ani zewnętrznej usługi plików; istniejące zabezpieczenia zabraniają tych adapterów w produkcji.

Odtworzenie:

```sh
npm test -- __tests__/unit/installations __tests__/integration/installations
npm run typecheck:app
npm run build
npm run test:e2e -- e2e/installations-card.spec.ts e2e/installations-order.spec.ts e2e/installations-client-form.spec.ts e2e/installations-governance.spec.ts e2e/installations-calendar-ui.spec.ts
```

Testy E2E domyślnie usuwają własny katalog po zakończeniu. Opcja `WALLDECOR_E2E_KEEP_FOR_PREVIEW=1` zachowuje izolowany katalog do podglądu i wypisuje jego ścieżkę. Nie wskazywać bazy produkcyjnej. Tryb developerski służy wyłącznie zaufanemu lokalnemu testowi, nie do publicznego udostępniania.

## Zrzuty

- [Podsumowanie — desktop](installation-card-2026-09-07/card-1280.png)
- [Rozwinięta edycja — produkcyjny build lokalny](installation-card-2026-09-07/card-edit-clean.png)
- [Edycja po symulowanym konflikcie 409 — wpisy zachowane](installation-card-2026-09-07/card-edit.png)
- [Mobile 360 px](installation-card-2026-09-07/card-360.png)
- [Mobile 430 px](installation-card-2026-09-07/card-430.png)
- [Tablet 768 px](installation-card-2026-09-07/card-768.png)

## Lokalny podgląd pracowniczy

- Adres karty: `http://localhost:3000/installations/cmtr9v4e2002oh5jqf0p2zssb`.
- Konto testowe: `cardowner`; hasło syntetycznego fixture: `Card-Test-2026!`.
- Baza: `/tmp/walldecor-installations-e2e-fjqmPA/calendar.db`; prywatne pliki: podkatalog `media`.
- Proces jest związany tylko z `127.0.0.1`, a więc dostępny na tym komputerze. To nie jest wdrożenie na `app.walldecor.pl` ani podgląd dostępny z innych komputerów firmy.
- Testowy Calendar nie wysyła rzeczywistych zaproszeń. Nie wprowadzać prawdziwych danych klientów do tego środowiska. Katalog `/tmp` służy do podglądu, nie trwałego przechowywania danych operacyjnych.
- Zmiany pozostają w worktree `walldecor-app-calendar`, na gałęzi `feature/installation-order-products`; bez push, merge i wdrożenia produkcyjnego.
