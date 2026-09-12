# Faktury spoza KSeF i wspólne AI przez konto ChatGPT

Status: implementacja lokalna; nie wdrożono. Baza wyjściowa: `391518d`.

## Zatwierdzony zakres

- ADMIN dodaje PDF/JPG/PNG/WebP z obecnej listy faktur: do 20 plików, 10 MB na plik, PDF do 10 stron. Jeden plik = jedna faktura; bez e-maili.
- Trwała kolejka szkiców poza `KsefInvoice`/`CostEvent`; sam upload nie wpływa na koszty ani zobowiązania. Prywatne oryginalne bajty na trwałym wolumenie, SHA-256, pobranie tylko przez autoryzowane API.
- Oryginał obok edytowalnych danych, na telefonie przełącznik. Dostawca, pełny identyfikator podatkowy, numer, data, brutto/waluta, termin/status płatności, centrum i tagi; szczegóły: netto, VAT, rachunek, notatka.
- Obce waluty wymagają potwierdzonego brutto PLN i informacji o przeliczeniu. Bez wyboru kursu podatkowego. Brakujące dane nie stają się zerem, dzisiejszą datą ani potwierdzeniem zapłaty.
- Reguły dostawców podpowiadają klasyfikację; zatwierdzenie nie modyfikuje automatycznie reguł.
- Akcje: Zatwierdź i następna, Zapisz szkic, Pomiń na teraz, ponów odczyt, archiwizuj. Korekty, credit notes, proformy i daty przed 2026-04-01 są zatrzymane do osobnej obsługi.
- Zatwierdzenie atomowo sprawdza wersję/duplikaty, tworzy jedną fakturę i zatwierdzony koszt, przypisuje plik oraz audyt. Retry zwraca ten sam dokument. AI nie nadpisuje ręcznych zmian.
- Duplikaty: SHA oraz tożsamość dokumentu, bez utraty liter zagranicznego numeru podatkowego. Późniejszy KSeF zachowuje plik i decyzje administratora; różnice kwot/płatności wymagają rozstrzygnięcia.
- Źródło ręczne pozostaje MANUAL; kwoty nominalne obcych walut nie są PLN, a zagraniczne netto/VAT nie zastępują brakujących kwot PLN.
- Zmiana kompletnego okresu wymaga potwierdzenia i unieważnia kompletność. Korekty danych po zatwierdzeniu: cofnięcie z kosztów, edycja tej samej faktury, ponowne zatwierdzenie. Wycofanie zachowuje historię. Bez przelewu/operacji kasowej.

## AI i granice bezpieczeństwa

- Wszystkie trzy zastosowania (odczyt, czat finansowy, encyklopedia) korzystają ze wspólnej trwałej kolejki i jednej prywatnej sesji oficjalnego Codex CLI.
- Wyłącznie ChatGPT OAuth właściciela w dedykowanym środowisku Coolify; CLI zarządza odświeżaniem. Nie kopiować lokalnej sesji, nie odczytywać tokenów w aplikacji, nie umieszczać ich w repo/CI.
- Model `gpt-5.6-luna`, reasoning `low`, bez zmiany modelu/dostawcy i bez płatnego fallbacku API. Faktyczną dostępność trzeba wykazać przed wdrożeniem.
- Jeden wykonawca; czaty wyprzedzają następną fakturę, ale nie przerywają rozpoczętego odczytu. Restart zachowuje zadania. Utrata autoryzacji/limitu widoczna dla administratora, ręczna obsługa nadal możliwa.
- Proces modelu dostaje tylko przygotowany kontekst i obrazy; żadnej bazy produkcyjnej, repozytorium, powłoki, przeglądarki, MCP, innych sekretów ani odziedziczonych konfiguracji/hooków. Puste dostępne narzędzia wymagają testu, nie deklaracji.
- PDF renderowany deterministycznie do obrazów stron, odpowiedź wymuszona JSON Schema i walidowana ponownie po stronie aplikacji. Dokument jest niezaufanymi danymi, nie instrukcją.
- Czat finansowy używa tego samego modelu danych rzeczywistych co dashboard, z flagami braków/niekompletności. Encyklopedia zachowuje dotychczasowy zakres i uprawnienia. Oba UI obsługują zadania asynchroniczne, oczekiwanie i błędy; odczyt tylko dla właściciela z aktualnymi uprawnieniami.

## Kolejność i dowody odbioru

1. Wspólne AI: granica ZERO-tools; rzeczywisty OAuth i JSON na syntetycznej fakturze; oba czaty; restart i brak dostępu. Mock nie zastępuje dowodu OAuth.
2. Jedna faktura przez UI: upload → odczyt → poprawa → koszt na dashboardzie → pobranie identycznych bajtów → cofnięcie/edycja. Potem paczki.
3. Przypadki ryzykowne: waluty, nieczytelne/brakujące dane, duplikaty i późniejszy KSeF, dwuklik/dwie karty, przerwany upload, restart, kompletny miesiąc, inne role.
4. Czysta baza i mieszana paczka wyłącznie przez UI. Koszty policzone raz; oryginały i historia trwają po restarcie.
5. Unit/integration API, typecheck, produkcyjny build, Playwright. Dowody stanu SQLite, sum dashboardu i pobranych bajtów. Wdrożenie dopiero po backupie bazy/plików i migracji klonu.

## Bramki i dziennik

- [x] Izolowany worktree z bieżącego `origin/main`; istniejące zmiany zachowane.
- [x] Bazowe testy: 191 plików / 1657 testów PASS, 2026-09-10.
- [x] Test rzeczywistego przypiętego CLI na macOS: puste narzędzia, obrazy, schema i wymuszone próby narzędzi, bez sesji właściciela.
- [x] Rzeczywisty obraz Linux ARM64, ZERO-tools i blokada sesji między kontenerami / po SIGKILL nadzorcy (2026-09-11; kontrola negatywna wykryta). Docelowy obraz amd64 wymaga osobnej próby.
- [x] Dedykowane logowanie właściciela i rzeczywisty smoke modelu/OAuth: faktura PNG, finanse i encyklopedia PASS, 2026-09-11. Wcześniejsza próba miała nieodtworzone `VALUE_MISMATCH`; bez deklaracji bezbłędnego OCR.
- [x] Oba rzeczywiste panele czatów, restart i brak autoryzacji wykonawcy; trwałość zadań i widoczny powód w UI, 2026-09-11. Brak OAuth testowany pustym tmpfs, bez cofania sesji właściciela; restart otwartego panelu, bez obietnicy odtwarzania historii po reload.
- [x] Trwała kolejka, wspólny finansowy kontekst, oba API/UI, transport i przygotowany wykonawca — lokalny odbiór z atrapą inferencji.
- [x] Lokalna weryfikacja tej części: 1846/1846 testów, typecheck, build, Playwright i niezależne przeglądy.
- [x] Regresja po bramce Linux, poprawce logowania i przygotowaniu rzeczywistego harnessu UI: 1893/1893 testów, 2026-09-11; wynik historyczny przed rzeczywistym odbiorem UI.
- [x] Poprawka granicy argv i ponowny odbiór obrazu Linux, **1897/1897 testów**, typecheck aplikacji/wykonawcy i build PASS, 2026-09-11. Późniejsze błędy fixture i importu schematu w harnessie poprawiono z RED/GREEN, bez zmian aplikacji/modelu.
- [x] Rzeczywisty odbiór UI/OAuth/restart/uprawnienia oraz osobny brak logowania PASS; końcowa regresja **1949/1949**, 216 plików, bez pominięć. Dowody w raporcie z 11 września.
- [x] Pełny przebieg jednej faktury UI/OAuth na czystej bazie, z pobraniem, cofnięciem/edycją i restartem — 11 września, [dowody](2026-09-11-invoice-single-oauth-acceptance.md).
- [x] Późniejsze dopasowanie KSeF, atomowe wersjonowane decyzje, blokada nierozstrzygniętego zatwierdzenia, HTTP i ekran porównania — SPEC/QUALITY i rzeczywiste testy SQLite PASS, 12 września. Odbiór przeglądarkowy pozostaje osobną bramką.
- [x] [Rzeczywisty odbiór KSeF UI/SQLite](2026-09-12-invoice-ksef-ui-acceptance.md): KEEP, revoke/APPLY/approve, potwierdzenie zamkniętego miesiąca, dashboard, oryginał, restart i telefon PASS. Bez zewnętrznego KSeF i OAuth.
- [x] Rozszerzone ryzyka przeglądarkowe: dwa równoczesne zatwierdzenia/dwuklik, oba zamknięte miesiące przy zmianie daty oraz zerwany multipart i deduplikacja ponowienia; niezależny odczyt SQLite/SHA/zrzutów PASS.
- [x] [Mieszana paczka rzeczywistego OAuth oraz ręczna obsługa AUTH](2026-09-12-invoice-batch-manual-acceptance.md): clean-DB, dwustronicowy PDF EUR, pusta strona/korekta, duplikat/uszkodzony plik, 123+430=553 PLN, akcje szkicu, restart i pobrania; niezależne audyty dowodów PASS.
- [x] Końcowe lokalne dowody / review aplikacji: naprawione duplikaty starszego formularza i automatyczne obrazy Markdown AI, SPEC/QUALITY PASS, 2653/2653 testy, typecheck, 145 stron produkcyjnego buildu oraz ponowny browser/SQLite duplikatów PASS, 12 września. Odbiór docelowego środowiska pozostaje otwarty.
- [ ] Natywny odbiór amd64: lokalny obraz na ARM przeszedł ZERO-tools 4/4, ale próba blokady zatrzymała się przed snapshotem (odbiór niezaliczony). [Końcowy raport i warunki](2026-09-12-invoice-final-local-acceptance.md).
- [x] Osobna zgoda właściciela na commit/push i wdrożenie, 12 września.
- [x] Zabezpieczenia publikacji: wykluczenia prywatnych danych z obrazu, jawny lokalny socket natywnego testu oraz kontrolowane pominięcie seeda istniejącej bazy. Pełna regresja 2729/2729 testów PASS.
- [ ] Kopie, migracja klonu, wdrożenie i weryfikacja publicznego przepływu.

Dokument opisuje zatwierdzony zakres i stan bramek, nie jest deklaracją ukończenia.

## Kontrakty realizacyjne importu — 11 września

Pierwsza bramka obejmowała wąski, pełny przepływ **jednej faktury**, nie sam schemat ani formularz. Fundament bazy, prywatny upload, endpointy i formularz przeszły przeglądy oraz rzeczywisty odbiór UI/OAuth z 11 września. Nie zamyka to jeszcze mieszanej paczki i pozostałych ryzyk.

- Cztery modele: `InvoiceImportBatch`, `InvoiceAttachment`, `InvoiceImportDraft`, `InvoiceDraftAudit`. Szkic ma trwałe `invoiceId` także po cofnięciu kosztu. Załącznik wskazuje fakturę przez szkic — brak drugiego, rozbieżnego przypisania.
- `version` jest wersją danych i stanu. `extractionRevision` identyfikuje zamówiony odczyt. Edycja ręczna nie zmienia rewizji odczytu. Wynik AI scala się z aktualnymi danymi wewnątrz tej samej transakcji co zakończenie zadania; musi zgadzać się szkic, załącznik, rewizja i `latestAiJobId`, a szkic musi być otwarty. Zatwierdzenie i archiwizacja odłączają bieżące zadanie. Zakończenie starego zadania nie otwiera dokumentu ponownie.
- Każde jawnie edytowane pole, również wyczyszczone do `null`, jest chronione przed AI. AI nie ustawia centrum, tagów, potwierdzenia przeliczenia ani kwot raportowych PLN. Ostrzeżenia odczytu pozostają przy zadaniu, poza edytowalnymi polami faktury.
- Przed odczytem decyzyjnym mutacje uzyskują rezerwację zapisu SQLite. Sprawdzenie wersji, duplikatów, zamkniętych miesięcy i utworzenie kosztu muszą być w jednej transakcji. Plik jest już trwale zapisany i `READY` — zatwierdzenie nie przenosi bajtów.
- Klucze idempotencji operacji są niezmiennymi zapisami audytu, nie pojedynczym nadpisywanym polem. Ten sam aktor, klucz i hash żądania zwracają pierwotny rezultat przed kontrolą bieżącej wersji; inny hash oznacza konflikt. Powtórzenie dawnego zatwierdzenia po cofnięciu nie może ponownie utworzyć kosztu.
- Cofnięcie ustawia koszt na `VOID`, odłącza jego unikalne `sourceInvoiceId`, zachowuje części i audyt z identyfikatorami kosztu i faktury. Ponowne zatwierdzenie aktualizuje tę samą fakturę i tworzy jeden nowy aktywny koszt. Żadna z tych operacji nie dotyka rachunków kasowych.
- Potwierdzenie naruszenia kompletnego miesiąca wskazuje dokładne ID bieżącego `FinancePeriodClose`. W transakcji zachowujemy pełny poprzedni rekord w `CostAuditLog` i usuwamy wyłącznie wskazane zamknięcie; istniejący model dashboardu traktuje brak tego rekordu jako okres niekompletny. Powtórne zamknięcie dostaje nowe ID, więc wcześniejsza zgoda nie obejmuje kolejnej zmiany. Sprawdzane są wszystkie dotknięte stare/nowe miesiące dat dokumentów w UTC.
- Importowany dokument ma jeden serwis zapisu danych. Dotychczasowe endpointy klasyfikacji, części, płatności, przeliczenia oraz approve/revoke nie mogą omijać wersji szkicu ani przywracać jego starszych danych. Zmiana reguły dostawcy pozostaje osobną, jawną operacją.
- Duplikat SHA wskazuje istniejący szkic/fakturę z pierwotnej paczki. Ponowny upload nie przenosi szkicu między paczkami. Identyfikator podatkowy zachowuje litery; dopasowanie bez numeru podatkowego wymaga porównania znormalizowanej nazwy dostawcy, numeru i daty, a nie samych cyfr.
- Sumy listy SSR/API, zaległości oraz ostrzeżeń kosztowych używają znanych kwot PLN. Nieprzeliczone faktury pozostają widoczne jako liczba dokumentów i kwoty według waluty. Dla zagranicznego dokumentu bez przeliczonego netto/VAT wartości raportowe pozostają `null`.
- Prywatny magazyn zapisuje oryginalne bajty pod losowym kluczem, z uprawnieniami katalogu `0700` i pliku `0600`. Pobranie weryfikuje typ, rozmiar i SHA-256. Kompensacja błędu usuwa tylko dokładnie wskazany, zweryfikowany plik; nie stosuje kasowania całego katalogu. Ścieżka katalogu jest konfiguracją operatora, nie wejściem użytkownika.
- Wykonawca pobiera wyłącznie oryginał przypisany do aktualnie posiadanego zadania i lease. Klucz wykonawcy nie daje ogólnego dostępu do załączników. Renderowanie PDF jest ograniczone liczbą stron, rozmiarem obrazów i czasem, bez dziedziczenia sekretów przez proces renderujący.

### Dowód wymagany przed zamknięciem importu

Administrator na czystej bazie dodaje syntetyczny plik, widzi wynik rzeczywistego OAuth, poprawia pole, zatwierdza i widzi dokładnie jeden koszt na dashboardzie. Pobiera identyczne bajty, cofa koszt, edytuje tę samą fakturę, ponownie zatwierdza i zachowuje historię. Restart aplikacji/wykonawcy nie gubi pliku ani stanu. Inna rola nie może odczytać ani zmienić szkicu. Dopiero po tym scenariuszu rozszerzamy odbiór na mieszaną paczkę i przypadki ryzykowne wymienione wyżej.

Żaden widoczny przycisk nie może być atrapą. Końcowy odbiór obejmuje kliknięcie wszystkich nowych akcji, edycję, archiwizację, roundtrip plików, odczyt po restarcie i kontrolę dostępu. Zielone testy fundamentu nie zamykają tego etapu.

[Raport lokalnego odbioru](2026-09-10-shared-ai-local-acceptance.md), [uzupełnienie Linux/OAuth](2026-09-11-shared-ai-linux-acceptance.md) i [pełny przebieg jednej faktury](2026-09-11-invoice-single-oauth-acceptance.md) opisują dokładne granice pierwszych dowodów. 12 września dołączyły odebrane lokalnie KSeF UI, rozszerzone ryzyka i mieszana paczka; linki wyżej. Końcowy przegląd, docelowy amd64 oraz wdrożenie pozostają otwarte.

## Kontrakt dopasowania KSeF — 12 września

Poniższy kontrakt uszczegóławia realizację zatwierdzonego zakresu. Serwis, HTTP, integracja synchronizacji i interfejs są zaimplementowane po oddzielnych przeglądach SPEC/QUALITY; lokalny odbiór UI opisano w raporcie z 12 września.

- Obserwacja KSeF jest osobnym, trwale przypisanym rekordem `InvoiceKsefReconciliation`. Nie zastępuje oryginału, źródła MANUAL, klasyfikacji, części ani aktywnego kosztu. Jej snapshot i decyzje mają audyt w tej samej transakcji.
- Pierwszeństwo ma istniejące powiązanie numeru KSeF. Nowe dopasowanie używa tożsamości dokumentu, nie zgodności kwoty: pełny identyfikator podatkowy lub nazwa dostawcy, numer oraz data. Trwałe przypisanie faktury jest ważniejsze niż dodatkowy niezatwierdzony szkic tego samego dokumentu. Niejednoznaczność zatrzymuje zapis; nie tworzy dodatkowego kosztu.
- Synchronizacja pobiera XML poza rezerwacją zapisu, a decyzyjny odczyt, dopasowanie i ewentualny dotychczasowy zapis wykonuje we wspólnej transakcji. Ponownie znaleziony import nigdy nie trafia do starej ścieżki nadpisywania. Ponowienie transakcji nie zwiększa liczników drugi raz. XML pamiętany przy tym samym numerze KSeF nie ginie po pominięciu pobrania.
- Brak terminu lub sama forma płatności nie stanowią dowodu zapłaty. Brakujących wartości i `UNKNOWN` nie stosuje się jako polecenia wyczyszczenia danych administratora. Korekty i nieaktywne dokumenty pozostają zablokowane do osobnej obsługi.
- Administrator widzi aktualne różnice, nie tylko zapamiętany status powiązania. „Zachowaj moje dane” dotyczy określonego snapshotu i bieżących pól porównywanych z KSeF. Edycja klasyfikacji, tagów, notatki lub przeliczenia PLN nie unieważnia tej decyzji; zmiana porównywanych danych wymaga ponownego sprawdzenia.
- „Zastosuj dane KSeF do szkicu” jest dostępne wyłącznie dla OPEN. Zatwierdzoną fakturę trzeba najpierw cofnąć z kosztów. Zastosowanie chroni przyjęte pola przed AI, odłącza stary odczyt i cofa potwierdzenie przeliczenia po zmianie podstawy kwotowej. Samo zastosowanie nie tworzy kosztu.
- Rozstrzygnięcie sprawdza aktualne prawa ADMIN, wersję szkicu i wersję obserwacji; ma odrębny klucz idempotencji w trwałym audycie. Zatwierdzenie ponownie sprawdza nierozwiązane różnice w swojej transakcji. Ten sam zapis z dwóch kart, spóźniony wynik AI i ponowienie po utracie odpowiedzi nie mogą ominąć tych bramek.
- Dowód odbioru: zgodny i konfliktowy KSeF po zatwierdzeniu pliku; zachowanie kosztu/oryginału/klasyfikacji; obie jawne decyzje przez UI; cofnięcie, zastosowanie i ponowne zatwierdzenie z jednym aktywnym kosztem; restart; odmowa innym rolom; dwie karty i awaria końcowego audytu.
