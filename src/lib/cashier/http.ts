import { NextRequest, NextResponse } from 'next/server'
import type { PrismaClient } from '@/generated/prisma'
import { CashierError } from './errors'
import { executeCashierCommand, readCashierBootstrap } from './service'

type HttpDependencies = {
  db: PrismaClient
  getSession: () => Promise<{ user: { id?: string; role?: string } } | null>
  now?: () => Date
}
const headers = { 'Cache-Control': 'private, no-store' }

function errorResponse(error: unknown) {
  if (error instanceof CashierError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers })
  return NextResponse.json({ error: 'Nie udało się zapisać lub odczytać kasy. Odśwież dane i sprawdź wynik operacji przed ponowieniem.', code: 'CASHIER_ERROR' }, { status: 500, headers })
}

export function createCashierHandlers({ db, getSession, now = () => new Date() }: HttpDependencies) {
  return {
    async GET(req: NextRequest) {
      try {
        const session = await getSession()
        const query: Record<string, string> = {}
        for (const [key, value] of req.nextUrl.searchParams) query[key] = value
        const data = await readCashierBootstrap(db, session?.user.id, query, now())
        return NextResponse.json(data, { headers })
      } catch (error) { return errorResponse(error) }
    },
    async POST(req: NextRequest) {
      try {
        const session = await getSession()
        if (!session?.user.id) throw new CashierError(401, 'UNAUTHENTICATED', 'Zaloguj się, aby zapisać kasę salonu.')
        let input: unknown
        try { input = await req.json() } catch { throw new CashierError(400, 'INVALID_JSON', 'Nieprawidłowe dane formularza. Odśwież stronę i ponów zapis.') }
        const result = await executeCashierCommand(db, session.user.id, input, now())
        return NextResponse.json(result, { headers })
      } catch (error) { return errorResponse(error) }
    },
  }
}
