import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { buildBreakEvenSources } from '@/lib/finance/break-even-data'
import { canMatchFixedCostSource } from '@/lib/finance/break-even-engine'
import { BreakEvenPeriodQuerySchema, BreakEvenSettingsActionSchema, type BreakEvenSettingsAction } from '@/lib/validations/break-even-settings'

class SettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
function required<T>(value: T | null | undefined, label: string): T {
  if (!value) throw new SettingsError(`${label} nie istnieje. Odśwież dane.`, 404)
  return value
}
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`
const sameNip = (value: string | null) => (value ?? '').replace(/[\s-]/g, '').replace(/^PL/i, '').toUpperCase()

export async function GET(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error
  const now = new Date()
  const parsed = BreakEvenPeriodQuerySchema.safeParse({ year: req.nextUrl.searchParams.get('year') ?? now.getUTCFullYear(), month: req.nextUrl.searchParams.get('month') ?? now.getUTCMonth() + 1 })
  if (!parsed.success) return NextResponse.json({ error: 'Wybierz poprawny rok i miesiąc.' }, { status: 400 })
  const [margins, fixedCosts, revenueBases, matches] = await Promise.all([
    prisma.breakEvenMarginSetting.findMany({ orderBy: { effectiveFrom: 'desc' } }),
    prisma.breakEvenFixedCost.findMany({ orderBy: [{ costCenterId: 'asc' }, { name: 'asc' }] }),
    prisma.breakEvenRevenueBasis.findMany({ where: parsed.data, orderBy: { costCenterId: 'asc' } }),
    prisma.breakEvenFixedCostMatch.findMany({ where: parsed.data, orderBy: { createdAt: 'asc' } }),
  ])
  return NextResponse.json({ margins: margins.map((row) => ({ ...row, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 7) })), fixedCosts, revenueBases, matches })
}

async function audit(tx: Prisma.TransactionClient, action: string, actorId: string, before: unknown, after: unknown) {
  await tx.costAuditLog.create({ data: { action: `break-even.${action}`, actorId, beforeJson: before == null ? null : JSON.stringify(before), afterJson: after == null ? null : JSON.stringify(after) } })
}

async function mutate(tx: Prisma.TransactionClient, data: BreakEvenSettingsAction, actorId: string) {
  switch (data.action) {
    case 'margin.save': {
      const before = data.id ? required(await tx.breakEvenMarginSetting.findUnique({ where: { id: data.id } }), 'Marża') : null
      const effectiveFrom = new Date(`${data.effectiveFrom}-01T00:00:00.000Z`)
      const duplicate = await tx.breakEvenMarginSetting.findUnique({ where: { effectiveFrom } })
      if (duplicate && duplicate.id !== data.id) throw new SettingsError('Marża dla tego miesiąca już istnieje. Edytuj istniejący wpis.', 409)
      const values = { margin: data.margin, effectiveFrom, note: data.note }
      const after = data.id
        ? await tx.breakEvenMarginSetting.update({ where: { id: data.id }, data: values })
        : await tx.breakEvenMarginSetting.create({ data: { ...values, createdById: actorId } })
      await audit(tx, data.action, actorId, before, after)
      return
    }
    case 'margin.delete': {
      const before = required(await tx.breakEvenMarginSetting.findUnique({ where: { id: data.id } }), 'Marża')
      await tx.breakEvenMarginSetting.delete({ where: { id: data.id } })
      await audit(tx, data.action, actorId, before, null)
      return
    }
    case 'fixed.save': {
      const before = data.id ? required(await tx.breakEvenFixedCost.findUnique({ where: { id: data.id } }), 'Koszt stały') : null
      required(await tx.costCenter.findUnique({ where: { id: data.costCenterId } }), 'Salon')
      if (data.id) {
        const matches = await tx.breakEvenFixedCostMatch.findMany({ where: { fixedCostId: data.id } })
        if (matches.some((match) => match.costCenterId !== data.costCenterId || monthKey(match.year, match.month) < data.effectiveFrom || (data.effectiveTo && monthKey(match.year, match.month) > data.effectiveTo))) {
          throw new SettingsError('Zmiana salonu lub okresu unieważni istniejące powiązania. Najpierw je usuń.', 409)
        }
        if (matches.length && sameNip(before?.supplierNip ?? null) !== sameNip(data.supplierNip)) {
          throw new SettingsError('Przed zmianą NIP dostawcy usuń istniejące powiązania faktur.', 409)
        }
      }
      const values = { name: data.name, costCenterId: data.costCenterId, expectedNetAmount: data.expectedNetAmount, effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo ?? null, supplierName: data.supplierName, supplierNip: data.supplierNip, active: true }
      const after = data.id
        ? await tx.breakEvenFixedCost.update({ where: { id: data.id }, data: values })
        : await tx.breakEvenFixedCost.create({ data: { ...values, createdById: actorId } })
      await audit(tx, data.action, actorId, before, after)
      return
    }
    case 'fixed.archive': {
      const before = required(await tx.breakEvenFixedCost.findUnique({ where: { id: data.id } }), 'Koszt stały')
      const after = await tx.breakEvenFixedCost.update({ where: { id: data.id }, data: { active: false } })
      await audit(tx, data.action, actorId, before, after)
      return
    }
    case 'revenue.save': {
      const key = { year: data.year, month: data.month, costCenterId: data.costCenterId }
      required(await tx.costCenter.findUnique({ where: { id: data.costCenterId } }), 'Salon')
      const revenues = await tx.revenue.findMany({ where: key, select: { amount: true } })
      if (!revenues.length) throw new SettingsError('Najpierw zapisz przychód brutto dla tego salonu i miesiąca.')
      const grossAmountSnapshot = revenues.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
      if (!Number.isFinite(grossAmountSnapshot) || grossAmountSnapshot < 0 || data.netAmount > grossAmountSnapshot) throw new SettingsError('Przychód netto nie może przekraczać zapisanego przychodu brutto ani bazować na ujemnym brutto.')
      if (grossAmountSnapshot > 0 && data.netAmount === 0) throw new SettingsError('Dla dodatniej sprzedaży brutto podaj dodatnią kwotę netto.')
      const before = await tx.breakEvenRevenueBasis.findUnique({ where: { year_month_costCenterId: key } })
      const values = { netAmount: data.netAmount, grossAmountSnapshot, createdById: actorId }
      const after = await tx.breakEvenRevenueBasis.upsert({ where: { year_month_costCenterId: key }, create: { ...key, ...values }, update: values })
      await audit(tx, data.action, actorId, before, after)
      return
    }
    case 'revenue.delete': {
      const before = required(await tx.breakEvenRevenueBasis.findUnique({ where: { id: data.id } }), 'Przychód netto')
      await tx.breakEvenRevenueBasis.delete({ where: { id: data.id } })
      await audit(tx, data.action, actorId, before, null)
      return
    }
    case 'match.save': {
      const fixed = required(await tx.breakEvenFixedCost.findUnique({ where: { id: data.fixedCostId } }), 'Koszt stały')
      const period = monthKey(data.year, data.month)
      if (!fixed.active || period < fixed.effectiveFrom || (fixed.effectiveTo && period > fixed.effectiveTo)) throw new SettingsError('Koszt stały nie obowiązuje w wybranym miesiącu.')
      const part = required(await tx.costEventPart.findUnique({ where: { id: data.costEventPartId }, include: { tags: { include: { tag: { select: { slug: true } } } }, allocations: true, event: { include: { sourceInvoice: { include: { invoiceImportDraft: { select: { state: true } } } }, parts: { include: { tags: { include: { tag: { select: { slug: true } } } }, allocations: true } } } } } }), 'Część faktury')
      if (!canMatchFixedCostSource(part.tags.map((item) => item.tag.slug))) throw new SettingsError('Zakup towaru, koszt zmienny, płace i wydatki jednorazowe nie mogą zastąpić kosztu stałego.')
      const event = part.event
      const invoice = event.sourceInvoice
      const allocation = part.allocations.find((row) => row.costCenterId === fixed.costCenterId)
      if (event.status !== 'APPROVED' || !['ACTIVE', 'CORRECTION'].includes(event.documentStatus) || event.currency !== 'PLN' || !event.sourceInvoiceId || !invoice || invoice.status !== 'APPROVED' || !['ACTIVE', 'CORRECTION'].includes(invoice.documentStatus) || (invoice.invoiceImportDraft != null && invoice.invoiceImportDraft.state !== 'APPROVED') || event.eventDate.getUTCFullYear() !== data.year || event.eventDate.getUTCMonth() + 1 !== data.month || !allocation || allocation.percent <= 0 || allocation.percent > 100) {
        throw new SettingsError('Wybierz zatwierdzoną, aktywną fakturę w PLN, przypisaną do tego salonu i miesiąca.')
      }
      if (fixed.supplierNip && sameNip(fixed.supplierNip) !== sameNip(event.supplierNip)) throw new SettingsError('NIP dostawcy faktury nie odpowiada kosztowi stałemu.')
      const source = buildBreakEvenSources([event], [], data.year, data.month).sources.find((row) => row.partId === part.id && row.costCenterId === fixed.costCenterId)
      if (!source) throw new SettingsError('Faktura ma niespójny podział kwot lub alokację. Popraw dokument przed przypisaniem.')
      const allocatedGross = source.grossAmount
      const override = data.actualNetAmount ?? null
      if (override != null && (Math.abs(override) > Math.abs(allocatedGross) || (override !== 0 && Math.sign(override) !== Math.sign(allocatedGross)))) throw new SettingsError('Kwota netto musi mieć znak kwoty brutto i nie może przekraczać jej wartości dla tego salonu.')
      if (override == null && source.netAmount == null) throw new SettingsError('Faktura nie ma jednoznacznej kwoty netto. Wpisz kwotę netto tej części dla salonu.')
      const key = { costEventPartId: data.costEventPartId, costCenterId: fixed.costCenterId }
      const before = await tx.breakEvenFixedCostMatch.findUnique({ where: { costEventPartId_costCenterId: key } })
      if (before && (before.fixedCostId !== fixed.id || before.year !== data.year || before.month !== data.month)) throw new SettingsError('Ta część faktury jest już przypisana do innego kosztu stałego. Najpierw usuń powiązanie.', 409)
      const values = { fixedCostId: fixed.id, year: data.year, month: data.month, ...key, actualNetAmount: override }
      const after = before
        ? await tx.breakEvenFixedCostMatch.update({ where: { id: before.id }, data: values })
        : await tx.breakEvenFixedCostMatch.create({ data: { ...values, createdById: actorId } })
      await audit(tx, data.action, actorId, before, after)
      return
    }
    case 'match.delete': {
      const before = required(await tx.breakEvenFixedCostMatch.findUnique({ where: { id: data.id } }), 'Powiązanie faktury')
      await tx.breakEvenFixedCostMatch.delete({ where: { id: data.id } })
      await audit(tx, data.action, actorId, before, null)
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Niepoprawny format danych.' }, { status: 400 }) }
  const parsed = BreakEvenSettingsActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Sprawdź kwoty, salon, identyfikatory i okres obowiązywania.', details: parsed.error.flatten() }, { status: 400 })
  try {
    await prisma.$transaction((tx) => mutate(tx, parsed.data, auth.session.user.id))
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof SettingsError) return NextResponse.json({ error: error.message }, { status: error.status })
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'P2002') return NextResponse.json({ error: 'Taki wpis lub powiązanie już istnieje. Odśwież dane.' }, { status: 409 })
    if (code === 'P2025' || code === 'P2003') return NextResponse.json({ error: 'Dane źródłowe zmieniły się. Odśwież dane i spróbuj ponownie.' }, { status: 409 })
    throw error
  }
}
