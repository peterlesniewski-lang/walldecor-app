# Pulpit główny: podsumowanie zamkniętego miesiąca i dane z mostka Subiekt GT

> Status: **plan, bez kodu**. Przegląd pulpitu `/` i `/dashboard` (ADMIN). Gałąź robocza: `dashboard-review-subiekt-7fb92dad`.
> Format loopów wg skilla `plany-bez-atrap`. Każdy loop = jedno zachowanie użytkownika, bramka, dowód.
> Uwaga na nazwę: „zamknięcie miesiąca” z `2026-10-02-month-closing-ux.md` to checklista operacyjna (moduł Wykonania). Tu chodzi o **zamknięcie okresu finansowego** (`FinancePeriodClose`). To dwie osobne rzeczy.

## 1. Stan obecny (ustalenia z przeglądu)

1. **Zamknięty miesiąc nie może istnieć.** `complete = kanały complete && costsConfirmed && !partial && !future`, a `costsConfirmed = periodClosed && pendingDocumentCount === 0`. `periodClosed` pochodzi z tabeli `FinancePeriodClose`, którą zapisuje tylko `POST /api/finance/period-closes`. Żaden ekran go nie woła, więc `complete` jest praktycznie zawsze `false` i pulpit nie ma czego podsumować.
2. **„Zastosuj” z Subiekta kopiuje tylko brutto** do `Revenue` (`upsertRevenueEntry`). Nie zapisuje podstawy netto (`BreakEvenRevenueBasis`), więc po zastosowaniu break-even może zostać bez netto.
3. **Pulpit nie korzysta z dostępnych danych.** Break-even i plan są tylko linkiem. Należności i zobowiązania są ręczne, mimo że mostek ma `receivables_open` i `unfiscalized_invoices`.
4. **Różnica „mostek vs wpis ręczny” to artefakt porównania**, a nie błąd danych. Siatka (`revenue-actuals-grid.tsx`, ok. l.200) porównuje sumę ręczną z samym TOWAR per komórka kanału. Po rozdzieleniu sprzedaży i montażu (TOWAR→SALON, USLUGA→MONTAZ) wpis ręczny w SALON porównuje się tylko z towarem.
   - Weryfikacja Codexa: razem marzec–październik wpisy ręczne 3 138 957,61 zł vs nagłówki 3 144 240,02 zł (0,17%). Różnice miesięczne: mar −1 467, kwi +909, maj +556, cze −3 090, paź −2 190; lip, sie, wrz i lis ≤ 1 zł. Mapowanie magazynów poprawne (PUŁ→PUL, MAG→JAG, INT→PUL/ECOMMERCE), 0 zł nieprzypisanych.
   - Szum INNE: 0,01 zł/mies., wrz 245,50 zł (opakowania), lip −200 zł (korekta KFS). Listopad = „stan na 17.11”.
5. **Liczba dokumentów jest zawyżona.** `documentCount` jest zapisywane per rodzaj i sumowane per komórka (`subiekt-revenue.ts` l.158, 218–230) oraz jeszcze raz w siatce (l.74). Jeden dokument może leżeć w kilku wierszach rodzajów (59–172 mies.). Poprawnie: `total.documents`.
6. **Klient mostka gubi pola jakości danych:** `salesSummarySchema` (`subiekt-bridge-client.ts` ok. l.58–64) nie ma `reconciliation`, `date_basis`, `doc_types`; `excluded` i rozbicie dokumentów dzielonych wg zamówienia znikają.
7. **Czytelność:** ostrzeżenia rozproszone, brak jednej liczby nagłówkowej, gdy cokolwiek jest niekompletne. Wydajność niezmierzona.
8. **VAT wg stawek: rodzaj ≠ stawka.** Październik: usługi 67 082 zł przy 8% i 29 899 zł przy 23%; towar 82 026 zł przy 8% i 292 tys. przy 23%. Mostek `sales_summary` nie ma podziału na stawki.
   - Źródło: `dbo.dok_Vat`. Zgodne z nagłówkami co do 0,00 zł we wszystkich 22 parach miesiąc × magazyn.
   - **Nie sumować `dok_Pozycja.ob_VatProc`**: przy zaliczkach pozycje opisują całe zamówienie i zawyżają brutto października o 474 tys. zł.
   - Październik: 8% netto 138 062,86 / VAT 11 045,02 / brutto 149 107,88; 23% netto 261 799,36 / VAT 60 213,87 / brutto 322 013,23; 5% (korekta w PUŁ) brutto −50,52; razem brutto 471 070,59.

## 2. Zasady (z kodu, nie łamać)

- „Brak nie jest zerem”: brak danych ≠ 0 zł, brak pokazujemy wprost.
- Netto nigdy z brutto/1,23. Przychód netto tylko przez `BreakEvenRevenueBasis`, ważną, gdy `grossAmountSnapshot` = bieżąca suma brutto.
- Migracje to pliki SQL stosowane przez `prisma migrate deploy` (reguła `db push` w CLAUDE.md jest nieaktualna dla tego repo).
- Brak endpointu `month_close_control` w mostku (zwraca 404). Fazy zależne od niego są oznaczone.

## 3. Decyzje do podjęcia przed startem

| # | Pytanie | Domyślnie |
| --- | --- | --- |
| D1 | Zamknięte miesiące marzec–październik: przepisać z mostka (różnice do ~3,1 tys. zł) czy zostawić wpisy ręczne? | Zostawić; mostek jako porównanie |
| D2 | Czy `RevenueBudget` jest faktycznie prowadzony? Jeśli nie, karta „plan vs wykonanie” nie ma sensu | do sprawdzenia w Loopie 0 |
| D3 | Czy „VAT do zapłaty” ma być na pulpicie? | Tak, jako szacunek z podpisem |
| D4 | INNE mapować do SALON czy porównywać z nagłówkiem? | Porównywać z nagłówkiem |
| D5 | Kolejność względem niezmergowanej gałęzi `plan/month-close-control` (dotyka `subiekt-bridge-client.ts` i kodu operacji) | Najpierw ona, potem Loop 1 |

## 4. Zasady globalne planu (kopiować do każdego loopa)

- Żaden widoczny element interaktywny nie jest atrapą: działa albo nie istnieje.
- Zakaz placeholderów: dane na ekranie z bazy lub z mostka, nie z hardcode i nie z `demo-data`; akcja zatwierdzająca zmienia stan w bazie, nie tylko pokazuje toast.
- Brak danych pokazujemy jako brak, nie jako 0.
- Logika domenowa w `src/lib/finance`, nie w komponentach.
- Każdy loop kończy się pytaniem „Czy mam zrobić commit i push na git?” (bez automatycznego pusha).
- Limit 5 iteracji naprawczych; po przekroczeniu STOP i opis problemu.
- Bramka każdego loopa: `npm run test && npx tsc --noEmit && npm run build && walidator && npm run test:e2e` zielone.
- Raport bez sekcji DOWÓD (komendy + output + zrzut/response) nie oznacza ukończenia.

---

## Loop 0: Pomiary na produkcji (tylko odczyt, bez zmian w kodzie)

**Cel:** wiemy, co faktycznie leży w produkcyjnej bazie, zanim cokolwiek zmienimy.

Zadania:
1. `SELECT` z `FinancePeriodClose` (czy są jakiekolwiek wiersze, dla których miesięcy).
2. `SELECT` z `Revenue` za marzec–październik wg kanału. Czy ręczna suma leży w SALON?
3. `SELECT` z `RevenueBudget`: czy są budżety na 2026? (decyzja D2).
4. Pomiar czasu `loadActualDashboardData` na kopii bazy zbliżonej do prod (liczba zapytań, czas, rozmiar odpowiedzi).

Poza zakresem: jakakolwiek zmiana kodu lub danych.

DoD:
- [ ] Raport zawiera wynik każdego z 4 pomiarów z komendą i outputem.
- [ ] Raport rozstrzyga D2 (są/nie ma budżetów 2026) i podaje czas ładowania pulpitu w ms.
- [ ] Baza produkcyjna niezmieniona (tylko `SELECT`).

## Loop 1: Porównanie przychodu mostek vs wpis poprawione (szybki zysk)

**Cel:** Admin na `/finance/revenue` widzi sensowną różnicę: „towar X + montaż Y = Z vs wpis W”, a „Zastosuj” zapisuje brutto i podstawę netto razem.

Zadania:
1. Porównanie na poziomie miesiąca i firmy (suma kanałów vs nagłówek `total`), nie per komórka.
2. „Zastosuj” zapisuje brutto do `Revenue` i `BreakEvenRevenueBasis` w jednej transakcji.
3. Liczba dokumentów z `total.documents` zamiast sumy po rodzajach.
4. Rozszerzyć `salesSummarySchema` o `reconciliation`, `excluded`, `date_basis`; panel „jakość danych” (dokumenty dzielone wg zamówienia, nierozdzielone, zaokrąglenia).
5. INNE zgodnie z D4.

Poza zakresem: VAT wg stawek, zamykanie okresu, zmiana danych historycznych (D1).

DoD:
- [ ] Admin otwiera marzec 2026 i widzi jedno porównanie miesiąca: suma kanałów mostka vs suma wpisów ręcznych, z różnicą −1 467 zł (z fixture odpowiadającego Codexowi).
- [ ] Admin klika „Zastosuj” dla miesiąca; w bazie `Revenue` ma brutto, a `BreakEvenRevenueBasis` ma netto z `grossAmountSnapshot` równym zapisanej sumie.
- [ ] Po „Zastosuj” break-even dla tego miesiąca pokazuje przychód netto z podstawy (nie „brak”).
- [ ] Liczba dokumentów miesiąca firmy równa `total.documents` z mostka, nie sumie wierszy rodzajów.
- [ ] Odpowiedź mostka z `reconciliation` pokazuje się w panelu jakości; przy braku pola panel pokazuje „brak danych”, nie 0.
- [ ] MANAGER i EMPLOYEE dostają odmowę (403) na „Zastosuj”.

Walidator: wywołuje „Zastosuj” na fixture, czyta rekordy `Revenue` i `BreakEvenRevenueBasis` z bazy i porównuje kwoty; test jednostkowy: różnica miesiąca, `amount = 0`, `amount < 0`, brak danych (null), przełom roku.

## Loop 2: Zamknięcie okresu i podsumowanie miesiąca

**Cel:** Admin zamyka miesiąc z pulpitu i od tej chwili widzi stałe podsumowanie tego miesiąca.

Zadania:
1. Przycisk „Zamknij miesiąc” z listą warunków (kanały kompletne, koszty potwierdzone, brak dokumentów oczekujących) i wywołaniem `POST /api/finance/period-closes`; „Otwórz ponownie”.
2. Zamrożony `MonthSummarySnapshot` zapisywany przy zamknięciu (przychód brutto/netto, koszty, wynik, break-even, liczby dokumentów, data danych z mostka).
3. Karta „Podsumowanie miesiąca” na pulpicie: liczba nagłówkowa, porównanie z poprzednim miesiącem i rokiem.
4. Baner „Zmiany po zamknięciu”, gdy mostek zwraca inne kwoty niż zamrożone (przykład: FS5 1 295,80 zł w październiku).
5. Data „stan na” przy każdym porównaniu z mostkiem.

Poza zakresem: automatyczne zamykanie, plan vs wykonanie (zależne od D2).

DoD:
- [ ] Admin klika „Zamknij miesiąc” dla miesiąca z kompletnymi danymi; w bazie jest wiersz `FinancePeriodClose` i `MonthSummarySnapshot`; pulpit pokazuje kartę podsumowania.
- [ ] Przy niespełnionym warunku przycisk jest nieaktywny i pokazuje, którego warunku brakuje.
- [ ] Admin „Otwórz ponownie”; karta wraca do trybu roboczego, a snapshot jest oznaczony jako zastąpiony.
- [ ] Po zmianie danych z mostka po zamknięciu pulpit pokazuje baner z różnicą kwotową; zamrożone liczby się nie zmieniają.
- [ ] Po restarcie aplikacji zamknięty miesiąc nadal jest zamknięty.
- [ ] MANAGER i EMPLOYEE nie mogą zamknąć miesiąca (403) i nie widzą pulpitu ADMIN.

Walidator: wykonuje zamknięcie przez API, odczytuje oba wiersze z bazy, symuluje zmianę kwoty w snapshotcie mostka i sprawdza wykrycie różnicy.

## Loop 3: VAT wg stawek (zmiana w mostku i w aplikacji)

**Cel:** Admin na podsumowaniu miesiąca widzi sprzedaż w 8%, 23% i „inne”, zgodną z nagłówkami co do 1 gr.

Zadania (mostek, osobne repo i wdrożenie):
1. Nowe grupowanie, np. `group_by=month_warehouse_vat`, z `dok_Vat`: netto, VAT, brutto per miesiąc × magazyn × stawka. Test zgodności z nagłówkami (0,00 zł).
2. Test zakazu sumowania `dok_Pozycja.ob_VatProc`.

Zadania (aplikacja):
3. Osobny snapshot `SubiektVatSnapshot` (rok, miesiąc, magazyn, stawka, netto, VAT, brutto); nie dokładamy stawki do klucza `SubiektRevenueSnapshot`.
4. Koszyk „inne stawki” (np. 5% w PUŁ, −50,52 zł brutto). Kontrola: suma stawek = nagłówek ± 1 gr, inaczej ostrzeżenie.
5. Karta VAT na podsumowaniu miesiąca; „VAT do zapłaty” jako szacunek z podpisem (data wystawienia ≠ data obowiązku podatkowego).

Poza zakresem: macierz rodzaj × stawka (dokument o mieszanych stawkach i alokacja zaliczek 25–40% to model, nie dane).

DoD:
- [ ] Admin otwiera październik 2026 i widzi 8%: 138 062,86 netto / 149 107,88 brutto, 23%: 261 799,36 netto / 322 013,23 brutto, inne: −50,52 brutto; suma brutto 471 070,59.
- [ ] Gdy suma stawek różni się od nagłówka o więcej niż 1 gr, karta pokazuje ostrzeżenie z kwotą różnicy.
- [ ] Po synchronizacji snapshot VAT w bazie ma wiersze dla każdej pary miesiąc × magazyn × stawka.
- [ ] „VAT do zapłaty” ma podpis „szacunek” i jest porównany z JPK dla 2 miesięcy (raport z różnicami).
- [ ] Brak danych VAT dla miesiąca pokazuje „brak”, nie 0.

Walidator: pobiera `month_warehouse_vat` z mostka i zestawia z `sales_summary` (0,00 zł); sprawdza, że w kodzie nie ma sumowania pozycji dokumentów.

## Loop 4: Należności i dokumenty z mostka na pulpicie

**Cel:** Admin widzi należności i faktury bez fiskalizacji z mostka zamiast wpisów ręcznych.

Zadania:
1. Token aplikacji z zakresem `finance:read` (dziś tylko `sales:read`, `purchases:read`); komunikat błędu klienta (l.31) uwzględnia nowy zakres.
2. Karta „Należności” z `receivables_open` (przeterminowane, dni po terminie) i „Niefiskalizowane faktury” z `unfiscalized_invoices`.
3. „Top 5 produktów” miesiąca z `top_products` na podsumowaniu.
4. „Płatności w 14 dni” z KSeF (niezależne od mostka).

Zależne od niewdrożonego `month_close_control` (404): kontrola WZ/PZ, kas, rejestru VAT, korekt do okresów wcześniejszych. Zostaje poza tym loopem do wdrożenia endpointu.

DoD:
- [ ] Admin widzi na pulpicie sumę należności z mostka równą `total.remaining_total` odpowiedzi.
- [ ] Przy braku zakresu `finance:read` karta pokazuje „brak uprawnień tokena”, a nie 0.
- [ ] Lista niefiskalizowanych faktur odpowiada liczbie z mostka dla wybranego miesiąca.
- [ ] Top 5 produktów zgadza się z odpowiedzią `top_products` dla tego miesiąca.

## Loop 5: Wydajność i porządki (po pomiarze z Loopa 0)

**Cel:** Pulpit ładuje się w czasie ustalonym z pomiaru i kod ma jedną ścieżkę ostrzeżeń.

Zadania:
1. Optymalizacja tylko tych miejsc, które pomiar wskazał jako wąskie gardło.
2. Jeden panel kompletności zamiast ostrzeżeń rozproszonych po kartach; jedna liczba nagłówkowa także przy niekompletności (z wyraźnym oznaczeniem).

DoD:
- [ ] Czas ładowania pulpitu na kopii prod jest niższy od wyniku z Loopa 0 o ustalony próg (do ustalenia po pomiarze), z porównaniem „przed/po” w ms.
- [ ] Przy niekompletnym miesiącu pulpit pokazuje liczbę nagłówkową z oznaczeniem „niekompletne” i listą braków w jednym panelu.

## Loop 6 (finał): dzień z życia właściciela

Na czystej bazie z danymi z października: Admin loguje się, otwiera pulpit, widzi niekompletny miesiąc z listą braków; stosuje przychód z mostka; potwierdza koszty; zamyka miesiąc; widzi kartę podsumowania z VAT 8%/23%, należnościami i top produktami; po zmianie danych z mostka widzi baner „zmiany po zamknięciu”; po restarcie aplikacji wszystko jest na miejscu. Bez dotykania bazy i bez martwego elementu. Suma zielonych loopów nie jest dowodem, dopiero ten scenariusz.

## Audyt atrap (przed każdym „done”)

- [ ] Kliknięty każdy widoczny element na zmienionych ekranach.
- [ ] Utworzony rekord (zamknięcie, snapshot) da się cofnąć przez UI.
- [ ] Restart aplikacji, dane przetrwały.
- [ ] Druga rola nie widzi danych ADMIN.
- [ ] Brak danych nigdzie nie jest pokazany jako 0.

## Ryzyka i zależności

- Loop 3 i 4 wymagają zmian w repo mostka (`walldecor-bridge`) i wdrożenia na SERWER; kolejność scalania względem `plan/month-close-control` (D5).
- Przepisywanie historii (D1) zmienia podział SALON/MONTAŻ; pojedyncze „Zastosuj” dla samego SALON gubi kwotę montażu, więc stosować tylko na poziomie miesiąca.
