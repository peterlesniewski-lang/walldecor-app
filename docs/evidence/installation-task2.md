# Task 2 — katalog, formularze i zakresy montaży

## Checkpoint interfejsu przed implementacją

### CatalogManager

- **Intent:** administrator lub manager utrzymuje prawdziwy katalog bez edycji kodu; widzi strukturę kategoria → typ → produkt i może ją spokojnie rozszerzyć, przestawić lub zarchiwizować.
- **Palette:** `--plaster` jako tło, `--paper` jako pojedyncza powierzchnia edycji, `--sand` dla pól oraz `--masking-tape` tylko dla zapisu/dodawania. Ceglasty czerwony jest zarezerwowany dla archiwizacji i błędów.
- **Depth:** grupy katalogu są na poziomie 1 z bardzo subtelnym cieniem; zagnieżdżone typy i produkty nie dostają osobnych dekoracyjnych kart.
- **Surfaces:** rodzic `plaster`, sekcja `paper`, pola `sand`, komunikat błędu bez dodatkowej nakładki; menu kolejności działa przez jawne przyciski góra/dół.
- **Typography:** panel pozostaje przy istniejącym `Plus Jakarta Sans`; identyfikatory kodów produktów używają wyłącznie istniejącej klasy numerycznej.
- **Spacing:** 4 px jako baza, najczęściej 8/12/16/24 px; przyciski mają co najmniej 44 px wysokości.

### TemplateBuilder

- **Intent:** administrator buduje i publikuje wersję formularza bez kodu, ze świadomym rozróżnieniem szkicu od opublikowanej, niemutowalnej wersji.
- **Palette:** te same tokeny operacyjne; bursztyn oznacza zapis szkicu/publikację, ochra jest przeznaczona dla pytania wysokiego ryzyka, nie dla ozdoby.
- **Depth:** jedna powierzchnia `paper` na builder, bez modala całego procesu.
- **Surfaces:** pola `sand`, publikacja jest wyraźnie odseparowana ciepłym obramowaniem; komunikaty walidacji pozostają przy polu.
- **Typography:** `Plus Jakarta Sans`, a klucze pytań w mono tylko dla łatwego skanowania.
- **Spacing:** grupy pytania w rytmie 8/12/16 px; loading i disabled są widoczne na akcji zapisu/publikacji.

### RoomScopeEditor

- **Intent:** opiekun widzi mapę zlecenia jako listę realnych miejsc i może dodać pokoje, zakresy, produkty oraz poprawialne pomiary bez mieszania danych innych kart.
- **Palette:** `plaster` jako mapa tła, `paper` dla pokojów, `sand` dla formularzy; `masking-tape` wyłącznie dla dodawania, `site-red` dla trwałego usunięcia.
- **Depth:** pokój jest jedyną podniesioną powierzchnią; zakresy są rozdzielone linią, aby nie tworzyć stosu kart KPI.
- **Surfaces:** zakres i pomiary pozostają wewnątrz pokoju; historia snapshotu produktu jest czytelna po archiwizacji katalogu.
- **Typography:** istniejący krój panelu, mono tylko dla wymiaru i kodu.
- **Spacing:** 8/12/16/24 px; wszystkie działania mają stany loading, empty, error, disabled i focus.

## RED/GREEN

- RED walidatora pytań: brak modułu `@/lib/installations/question-schema`.
- GREEN walidatora pytań: `8/8` w `__tests__/unit/installations/question-schema.test.ts`.
- RED integracji katalogu: brak modułu `@/lib/installations/catalog-service`.
- GREEN integracji katalogu: realna świeża SQLite i pełen dotychczasowy łańcuch migracji, `11/11` wspólnie z testem walidatora.
- RED E2E panelu: po prawdziwym logowaniu `404 /installations/catalog`; serwer i izolowana baza wystartowały poprawnie.

## GREEN i bramki

- `npm test -- __tests__/unit/installations __tests__/integration/installations` — **GREEN**, 7 plików / 67 testów. Integracja `catalog-template.test.ts` uruchamia pełny, świeży łańcuch migracji na osobnej SQLite i sprawdza normalizację nazw, kolejność, v1/v2/snapshot, snapshot katalogowy oraz trzy zdarzenia audytu pomiaru.
- `node scripts/validate-installation-catalog.mjs` — **GREEN**. Skrypt tworzy tymczasową SQLite, aplikuje wszystkie committed migracje, loguje administratora i nieuprawnionego pracownika, wywołuje prawdziwe HTTP dla katalogu, template v1, snapshotu, pokoju, zakresu, produktu i pełnego CRUD pomiaru, archiwizuje produkt, restartuje serwer i odczytuje stan przez HTTP oraz Prisma/PRAGMA. Nie kontaktuje żadnej usługi zewnętrznej.
- `npm test` — **GREEN**, 58 plików / 345 testów.
- `npm run build` — **GREEN**, Next.js 16.1.6 skompilował wszystkie dynamiczne route handlers, w tym `params: Promise<…>` dla katalogu, template, snapshotu, pokojów, zakresów, produktów i pomiarów.
- Świeże ręczne zastosowanie **całego** łańcucha SQL migracji na `/private/tmp` — **GREEN**; `PRAGMA foreign_key_check` nie zwrócił wierszy, `PRAGMA integrity_check` zwrócił `ok`.

## E2E — formalny BLOCKED po limicie pięciu iteracji

Uruchamiany scenariusz `npm run test:e2e -- e2e/installations-catalog.spec.ts` korzysta z izolowanej bazy i prawdziwego UI. Piąta, ostatnia dozwolona iteracja doszła do końcowego odczytu po archiwizacji katalogu. Widok nowego zakresu zawierał dokładnie dwie opcje: `Wybierz aktywny produkt` i `Ciepły len`; historyczny snapshot `Misty Grey` pozostał widoczny w istniejącym zakresie.

Formalny fail nie dotyczy zachowania aplikacji, tylko niejednoznacznego lokatora testu:

```text
expect(getByLabel('Produkt dla Drugi zakres').locator('option')).not.toContainText('Misty Grey')
strict mode violation: locator resolved to 2 elements
<option value="">Wybierz aktywny produkt</option>
<option value="…">Ciepły len</option>
```

Nie wykonano szóstej naprawy ani nie osłabiono scenariusza, zgodnie z limitem. Bramka E2E jest więc oznaczona jako BLOCKED mimo pozytywnego odczytu funkcjonalnego; wymaga decyzji prowadzącego o dalszej, osobnej iteracji testowej.

## Ograniczenie środowiska Prisma

`DATABASE_URL=file:/private/tmp/... npx prisma migrate deploy` na świeżej bazie zwrócił ogólny `Schema engine error` bez nazwy migracji (powtórzone także poza sandboxem i przy `prisma db push`). Lokalny `schema-engine-darwin-arm64 --version` uruchamia się poprawnie, a identyczny pełny łańcuch SQL przechodzi przez `sqlite3 -bail` wraz z kontrolami FK i integralności. To jest zarejestrowany blocker narzędzia Prisma/środowiska, a nie obejście migracji produkcyjnych: nie zmieniono wcześniejszych migracji ani entrypointu.
