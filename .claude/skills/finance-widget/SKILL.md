---
name: finance-widget
description: Generuje komponent finansowy dla WallDecor — KPI karta, wykres plan vs wykonanie, break-even, traffic-light. Użyj gdy budujesz elementy dashboardu finansowego.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Finance Widget — WallDecor Dashboard

Generujesz widget finansowy dla dashboardu WallDecor. Argument: $ARGUMENTS

---

## Typy widgetów

### 1. KPI Card — pojedyncza metryka
Do wyświetlania: przychód, koszty, marża, break-even status

```tsx
interface KpiCardProps {
  title: string
  value: number             // kwota PLN
  previousValue?: number    // dla delta YoY
  target?: number           // budżet / plan
  costCenter: 'JAG' | 'PUL' | 'GLOBAL'
  trend?: 'up' | 'down' | 'neutral'
  isLoading?: boolean
}
```

Wyświetlaj:
- Kwotę: `formatPLN(value)` — font-mono, duży rozmiar
- Delta vs poprzedni rok: `+12,3%` zielony / `-5,1%` czerwony
- Progress bar: wykonanie vs plan (0–100%)

### 2. Plan vs Wykonanie — tabela miesięczna
Do wyświetlania kategorii z budżetem i wykonaniem

```tsx
interface PlanActualRow {
  subCategoryId: string
  subCategoryName: string
  budget: number       // plan
  actual: number       // wykonanie
  variance: number     // actual - budget (ujemne = oszczędność kosztów)
  variancePct: number  // (actual / budget - 1) * 100
}

// Reguła kolorowania wierszy:
// variancePct < 80%   → bg-green-50  (poniżej planu — dobrze dla kosztów)
// variancePct 80–100% → bg-yellow-50 (zbliża się do limitu)
// variancePct > 100%  → bg-red-50    (przekroczony)
```

### 3. Break-even Gauge
Próg rentowności per lokal — kiedy lokal "wychodzi na zero"

```tsx
interface BreakevenProps {
  costCenter: 'JAG' | 'PUL'
  totalCosts: number        // suma kosztów tego lokalu (+ udział GLOBAL)
  currentRevenue: number    // bieżący przychód miesiąca
  targetMonth: number       // 1-12
  targetYear: number
}

// Wyświetlaj:
// - Próg: formatPLN(totalCosts)
// - Bieżący przychód: formatPLN(currentRevenue)
// - Status: "Pokryty ✓" / "Brakuje: formatPLN(totalCosts - currentRevenue)"
// - Progress bar: currentRevenue / totalCosts * 100
```

### 4. Traffic-light Status Badge
Inline status per kategoria / lokal

```tsx
type BudgetStatus = 'ok' | 'warning' | 'danger' | 'no-data'

const getBudgetStatus = (actual: number, budget: number): BudgetStatus => {
  if (budget === 0) return 'no-data'
  const pct = (actual / budget) * 100
  if (pct <= 80)  return 'ok'       // zielony — poniżej 80% budżetu
  if (pct <= 100) return 'warning'  // żółty — 80-100%
  return 'danger'                    // czerwony — przekroczony
}

const statusConfig = {
  ok:      { label: 'W normie',     className: 'bg-green-100 text-green-800',  icon: '●' },
  warning: { label: 'Uwaga',        className: 'bg-yellow-100 text-yellow-800', icon: '●' },
  danger:  { label: 'Przekroczony', className: 'bg-red-100 text-red-800',      icon: '●' },
  'no-data':{ label: 'Brak planu',  className: 'bg-gray-100 text-gray-500',   icon: '○' },
}
```

### 5. Wykres trendu (Recharts)
Do wyświetlania przychodu vs kosztów za ostatnie N miesięcy

```tsx
// Używaj Recharts (zainstaluj: npm install recharts)
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Formatowanie osi Y (PLN w tys.)
const formatAxis = (value: number) => `${(value / 1000).toFixed(0)}k`

// Tooltip po polsku
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-md">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }} className="text-sm">
          {entry.name}: {formatPLN(entry.value)}
        </p>
      ))}
    </div>
  )
}
```

---

## Dane — skąd pobierać

Widgety używają **Server Components** z Prisma lub **SWR** dla live refresh:

```typescript
// Server Component (preferowane dla dashboardu)
const budgetData = await prisma.budgetEntry.findMany({
  where: { year, month, costCenterId },
  include: { subCategory: { include: { category: true } } }
})

// Lub SWR (dla live update bez przeładowania)
const { data, isLoading } = useSWR(
  `/api/budget?year=${year}&month=${month}&costCenter=${center}`,
  fetcher
)
```

---

## Formatowanie helper (lib/format.ts)

```typescript
export const formatPLN = (amount: number): string =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount)

export const formatPct = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`

export const formatMonth = (month: number, year: number): string =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1))
// Wynik: "styczeń 2026"
```

---

## Checklist
- [ ] Kwoty przez `formatPLN()` — nie ręcznie
- [ ] Stan loading przez `<Skeleton>` z shadcn/ui
- [ ] Traffic-light logika spójna (80% / 100% progi)
- [ ] Wykresy responsywne (`<ResponsiveContainer width="100%" height={300}>`)
- [ ] Tooltip wykresów po polsku
- [ ] Typ `Decimal` z Prisma konwertuj do `Number()` przed obliczeniami
