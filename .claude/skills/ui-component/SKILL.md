---
name: ui-component
description: Generuje nowy komponent React dla WallDecor zgodny z design systemem (shadcn/ui, Tailwind, polski UI, role-aware). Użyj gdy tworzysz nową stronę, formularz, kartę, tabelę lub widget.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# UI Component — WallDecor Design System

Generujesz komponent React dla aplikacji WallDecor. Argument: $ARGUMENTS

## Zasady design systemu WallDecor

### Technologie (nie zmieniaj)
- **shadcn/ui** — zawsze sprawdź czy potrzebny komponent istnieje: `components/ui/`
- **Tailwind CSS** — utility-first, bez inline styles
- **TypeScript strict** — pełne typowanie props, brak `any`
- `use client` tylko gdy niezbędna interaktywność (useState, useEffect, eventy)

### Paleta kolorów (Tailwind)
```
Tło aplikacji:    bg-background
Karty / panele:   bg-card, border border-border rounded-lg
Tekst główny:     text-foreground
Tekst pomocniczy: text-muted-foreground
Akcent główny:    bg-primary text-primary-foreground
Sukces/zielony:   text-green-600 / bg-green-50
Ostrzeżenie:      text-yellow-600 / bg-yellow-50
Błąd/czerwony:    text-red-600 / bg-red-50
```

### Traffic-light (budżet)
```tsx
// Używaj tego wzorca dla statusów budżetowych
const statusColors = {
  ok:      'text-green-600 bg-green-50 border-green-200',
  warning: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  danger:  'text-red-600 bg-red-50 border-red-200',
}
```

### Lokalizacje — badge
```tsx
const locationBadge = {
  JAG:    'bg-blue-100 text-blue-800',
  PUL:    'bg-purple-100 text-purple-800',
  GLOBAL: 'bg-gray-100 text-gray-700',
}
```

### Typografia
```
Nagłówek strony:    text-2xl font-semibold tracking-tight
Nagłówek sekcji:    text-lg font-medium
Label formularza:   text-sm font-medium text-foreground
Tekst pomocniczy:   text-sm text-muted-foreground
Wartość finansowa:  font-mono text-right (zawsze tabular-nums)
```

### Formatowanie kwot PLN
```tsx
// Zawsze używaj tego helpera
const formatPLN = (amount: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount)
// Wynik: "12 345,67 zł"
```

---

## Wymagania dla każdego komponentu

### 1. Stany obowiązkowe
Każdy komponent pobierający dane MUSI obsługiwać:
```tsx
// Loading
<Skeleton className="h-8 w-full" />

// Error
<Alert variant="destructive">
  <AlertDescription>Nie udało się załadować danych.</AlertDescription>
</Alert>

// Empty state
<div className="text-center py-8 text-muted-foreground">
  Brak danych do wyświetlenia.
</div>
```

### 2. Responsywność (mobile-first)
```
Telefon:  grid-cols-1
Tablet:   sm:grid-cols-2
Desktop:  lg:grid-cols-3 lub lg:grid-cols-4
Tabele:   owijaj w <div className="overflow-x-auto">
```

### 3. Dostępność
- Każdy input ma `<Label htmlFor="...">` z polskim tekstem
- Ikony dekoracyjne: `aria-hidden="true"`
- Przyciski z samą ikoną: `aria-label="Opis po polsku"`
- Tabele: `<th scope="col">` dla nagłówków

### 4. Role-aware (jeśli komponent zmienia wygląd per rola)
```tsx
import { useSession } from 'next-auth/react'

const { data: session } = useSession()
const isAdmin = session?.user?.role === 'ADMIN'
const isManager = session?.user?.role === 'MANAGER'

// Ukrywaj wrażliwe dane
{isAdmin && <span>{formatPLN(salary)}</span>}
```

---

## Wzorce komponentów

### Karta KPI
```tsx
// Wzorzec dla dashboard widgets
<Card>
  <CardHeader className="flex flex-row items-center justify-between pb-2">
    <CardTitle className="text-sm font-medium text-muted-foreground">
      {title}
    </CardTitle>
    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  </CardHeader>
  <CardContent>
    <div className="text-2xl font-bold font-mono">{formatPLN(value)}</div>
    <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
  </CardContent>
</Card>
```

### Tabela danych finansowych
```tsx
<div className="overflow-x-auto">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="w-[200px]">Kategoria</TableHead>
        <TableHead className="text-right">Budżet</TableHead>
        <TableHead className="text-right">Wykonanie</TableHead>
        <TableHead className="text-right">Różnica</TableHead>
        <TableHead className="text-right w-[80px]">%</TableHead>
      </TableRow>
    </TableHeader>
    {/* ... */}
  </Table>
</div>
```

### Formularz z walidacją Zod
```tsx
// Zawsze używaj react-hook-form + zodResolver
const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
  defaultValues: { ... }
})
// Po zapisie: toast z potwierdzeniem po polsku
toast({ title: "Zapisano", description: "Dane zostały zaktualizowane." })
```

### Badge lokalizacji
```tsx
<Badge variant="outline" className={locationBadge[costCenter]}>
  {costCenter}
</Badge>
```

---

## Język interfejsu — słownik PL

| Angielski (kod) | Polski (UI) |
|---|---|
| Budget | Budżet |
| Actual | Wykonanie |
| Revenue | Przychód |
| Cost Center | Lokalizacja |
| Break-even | Próg rentowności |
| Overtime | Nadgodziny |
| Leave Request | Wniosek urlopowy |
| Pending | Oczekuje |
| Approved | Zatwierdzono |
| Rejected | Odrzucono |

---

## Checklist przed zapisem

- [ ] Props są w pełni otypowane (interface lub type)
- [ ] Obsługuje stany: loading / error / empty / data
- [ ] Kwoty wyświetlane przez `formatPLN()`
- [ ] Responsywny na mobile
- [ ] Dostępny (labele, aria)
- [ ] `use client` tylko jeśli konieczny
- [ ] Brak hardcodowanych stringów — wszystkie texty po polsku w UI
