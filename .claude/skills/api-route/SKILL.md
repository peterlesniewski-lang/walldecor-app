---
name: api-route
description: Generuje Next.js App Router API route z auth check, walidacją Zod, Prisma i obsługą ról. Użyj gdy tworzysz nowy endpoint GET/POST/PUT/DELETE.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# API Route — WallDecor

Generujesz endpoint API dla aplikacji WallDecor. Argument: $ARGUMENTS

Ścieżka pliku: `app/api/<resource>/route.ts` lub `app/api/<resource>/[id]/route.ts`

---

## Obowiązkowy szablon

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// 1. Schemat walidacji Zod (zawsze definiuj)
const InputSchema = z.object({
  // ...pola
})

export async function GET(req: NextRequest) {
  // 2. Auth check (zawsze pierwszy)
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 3. Role check (jeśli wymagany)
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 4. Query Prisma
  try {
    const data = await prisma.model.findMany({ /* ... */ })
    return NextResponse.json(data)
  } catch (error) {
    console.error('[GET /api/resource]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 5. Walidacja body
  const body = await req.json()
  const result = InputSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const created = await prisma.model.create({ data: result.data })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('[POST /api/resource]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

---

## Reguły dostępu per zasób

Zawsze stosuj te reguły (z CLAUDE.md):

| Zasób | GET | POST/PUT | DELETE |
|---|---|---|---|
| `/api/budget` | ALL roles | ADMIN only | ADMIN only |
| `/api/actuals` | ALL roles | ADMIN + własny lokal EMPLOYEE | ADMIN |
| `/api/revenue` | ALL roles | ADMIN + własny lokal EMPLOYEE | ADMIN |
| `/api/employees` | ADMIN + MANAGER (bez salary) | ADMIN | ADMIN |
| `/api/employees/[id]/salary` | ADMIN only | ADMIN only | - |
| `/api/leave-requests` | własne: ALL, wszystkie: ADMIN+MGR | EMPLOYEE (własne) | ADMIN |
| `/api/work-time` | własne: ALL, wszystkie: ADMIN+MGR | ALL (własne) | ADMIN |

### Filtr lokalizacji dla EMPLOYEE
```typescript
// Pracownik widzi/edytuje tylko swój lokal
const costCenterId = session.user.role === 'EMPLOYEE'
  ? session.user.costCenterId  // z tokenu NextAuth
  : (req.nextUrl.searchParams.get('costCenter') ?? undefined)
```

---

## Query params — wzorce

```typescript
// Parsowanie query params ze stronicowaniem
const { searchParams } = req.nextUrl
const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()))
const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))
const costCenter = searchParams.get('costCenter') // 'JAG' | 'PUL' | 'GLOBAL' | null

// Walidacja query params przez Zod
const QuerySchema = z.object({
  year:       z.coerce.number().min(2020).max(2030),
  month:      z.coerce.number().min(1).max(12),
  costCenter: z.enum(['JAG', 'PUL', 'GLOBAL']).optional(),
})
```

---

## Checklist przed zapisem

- [ ] `getServerSession` jest pierwszą instrukcją
- [ ] Zwraca 401 dla braku sesji, 403 dla braku uprawnień
- [ ] Body walidowane przez Zod `safeParse` (nie `parse`)
- [ ] Błędy Prisma łapane przez `try/catch` z logowaniem
- [ ] Brak `console.log` z danymi wrażliwymi (hasła, PESEL)
- [ ] Endpoint zwraca spójne typy (nie mix `any`)
- [ ] Dodaj komentarz z nazwą endpointu w `console.error`
