# Standardy testowania — WallDecor App

---

## Frameworki

| Warstwa | Framework | Zastosowanie |
|---|---|---|
| Unit / Integration | **Vitest** | Logika biznesowa, helpery, API routes |
| E2E / UI | **Playwright** | Przepływy użytkownika, formularze, role |
| Komponenty | **Testing Library** + Vitest | Komponenty React w izolacji |

---

## Instalacja

```bash
# Vitest + Testing Library
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event

# Playwright
npm install -D @playwright/test
npx playwright install chromium  # wystarczy jeden browser w MVP
```

---

## Struktura katalogów testów

```
walldecor-app/
├── __tests__/
│   ├── unit/               # Logika biznesowa, utils, kalkulacje
│   │   ├── finance/        # break-even, plan vs actual
│   │   └── hr/             # kalkulacja nadgodzin, saldo urlopowe
│   ├── integration/        # API routes z bazą danych (SQLite in-memory)
│   │   ├── budget.test.ts
│   │   └── employees.test.ts
│   └── components/         # Komponenty React
├── e2e/                    # Testy Playwright
│   ├── auth.spec.ts
│   ├── budget.spec.ts
│   ├── dashboard.spec.ts
│   └── hr.spec.ts
├── vitest.config.ts
└── playwright.config.ts
```

---

## Konfiguracja Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'e2e/', 'prisma/'],
    },
  },
})
```

---

## Konfiguracja Playwright

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
```

---

## Komendy testowe

```bash
# Wszystkie testy jednostkowe
npm run test

# Testy z watch mode (development)
npm run test:watch

# Testy z pokryciem kodu
npm run test:coverage

# Testy E2E (wymaga działającego serwera dev)
npm run test:e2e

# Testy E2E z UI Playwright (debugowanie)
npm run test:e2e:ui

# Jeden plik testowy
npm run test __tests__/unit/finance/breakeven.test.ts
```

Dodaj do `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## Wymagania dotyczące testowania

### Kiedy pisać testy

| Kod | Wymagany test |
|---|---|
| Kalkulacja finansowa (break-even, plan vs actual, YoY) | ✅ Unit test — obowiązkowy |
| Kalkulacja HR (nadgodziny, saldo urlopowe) | ✅ Unit test — obowiązkowy |
| API route z logiką dostępu (role/uprawnienia) | ✅ Integration test — obowiązkowy |
| Formularz z walidacją Zod | ✅ Unit test schematu + E2E |
| Komponent UI bez logiki biznesowej | Opcjonalny |
| Strona statyczna / layout | Nie wymagany |

### Przypadki brzegowe — obowiązkowe

Każdy moduł finansowy musi mieć testy dla:
- `amount = 0` — brak budżetu lub wykonania
- `amount < 0` — korekta / storno
- Brakujące dane za dany miesiąc (null vs 0)
- Pełny rok (wszystkie 12 miesięcy)
- Przełom roku (grudzień → styczeń)

Każdy moduł HR musi mieć testy dla:
- Pracownik bez przypisanego salda urlopowego
- Wniosek urlopowy przekraczający saldo
- Sobota jako automatyczna nadgodzina
- Pracownik nieaktywny (endDate w przeszłości)

---

## Zasady pisania testów

```typescript
// ✅ Dobrze — opisowy, jeden assert na test
it('should calculate overtime for Saturday shift (11:00–14:00)', () => {
  const hours = calculateOvertimeHours({ date: '2026-03-07', start: '11:00', end: '14:00' })
  expect(hours).toBe(3)
})

// ❌ Źle — wiele asercji bez kontekstu
it('works', () => {
  expect(calc(a)).toBe(1)
  expect(calc(b)).toBe(2)
  expect(calc(c)).toBe(3)
})
```

- Nazwy testów po angielsku (`it('should...')`)
- Jeden logiczny przypadek na test
- Używaj `describe` do grupowania per moduł
- Dane testowe w `__fixtures__/` jeśli są duże
- Baza testowa: SQLite in-memory (`datasource url = "file::memory:?cache=shared"`)

---

## Kluczowe scenariusze E2E (Playwright)

### Auth
- [ ] Logowanie poprawnym hasłem → redirect do dashboard
- [ ] Logowanie złym hasłem → komunikat błędu
- [ ] Dostęp do chronionej strony bez sesji → redirect do login

### Role i uprawnienia
- [ ] EMPLOYEE nie widzi danych płacowych
- [ ] EMPLOYEE nie może edytować budżetu
- [ ] MANAGER widzi dane obu salonów
- [ ] ADMIN ma pełny dostęp

### Moduł finansowy
- [ ] Admin wpisuje budżet miesięczny dla JAG → zapis i widok
- [ ] Pracownik wpisuje obrót dla swojego salonu
- [ ] Dashboard pokazuje prawidłowe KPI po wpisaniu danych

### HR
- [ ] Pracownik składa wniosek urlopowy → status PENDING
- [ ] Manager zatwierdza wniosek → status APPROVED, saldo -X dni
- [ ] Wniosek przekraczający saldo → błąd walidacji

---

## MCP — Playwright MCP w Claude Code

Do szybkiego testowania i debugowania UI używaj Playwright MCP:

```bash
# Dodanie do projektu
claude mcp add --transport stdio playwright -- npx -y @playwright/mcp@latest
```

Playwright MCP pozwala Claude Code:
- Nawigować po aplikacji i weryfikować UI bez screenshots
- Wypełniać formularze i sprawdzać wyniki
- Debugować przepływy ról użytkowników live
