import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { KsefApiClient, dateFromKsefDate, type KsefEnvironment } from '@/lib/finance/ksef-client'
import { parseKsefInvoiceXmlDetails } from '@/lib/finance/ksef-xml-details'

const KSEF_SETTINGS = [
  'ksef_enabled',
  'ksef_environment',
  'ksef_company_nip',
  'ksef_token',
] as const

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const invoice = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (!invoice.externalId) {
    return NextResponse.json({ error: 'Ta faktura nie ma numeru KSeF do pobrania XML.' }, { status: 400 })
  }

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: [...KSEF_SETTINGS] } },
  })
  const map = new Map(settings.map((setting) => [setting.key, setting.value]))
  if (map.get('ksef_enabled') !== 'true') {
    return NextResponse.json({ error: 'Integracja KSeF jest wyłączona w ustawieniach.' }, { status: 400 })
  }

  const token = map.get('ksef_token') ?? ''
  const companyNip = map.get('ksef_company_nip') ?? ''
  const environment = (map.get('ksef_environment') ?? 'test') as KsefEnvironment
  if (!token || !companyNip) {
    return NextResponse.json({ error: 'Brakuje tokena KSeF albo NIP firmy w ustawieniach.' }, { status: 400 })
  }

  try {
    const client = new KsefApiClient({ environment })
    const authTokens = await client.authenticateWithToken({ companyNip, token })
    const xml = await client.downloadInvoiceXml({
      accessToken: authTokens.accessToken.token,
      ksefNumber: invoice.externalId,
    })
    const details = parseKsefInvoiceXmlDetails(xml)
    const dueDate = dateFromKsefDate(details.paymentDueDate)
    const bankAccount = details.bankAccounts[0] ?? null
    const updatedInvoice = dueDate || bankAccount
      ? await prisma.ksefInvoice.update({
          where: { id: invoice.id },
          data: {
            dueDate: dueDate ?? invoice.dueDate,
            bankAccount: bankAccount ?? invoice.bankAccount,
          },
        })
      : invoice

    return NextResponse.json({
      invoiceId: invoice.id,
      ksefNumber: invoice.externalId,
      xml,
      invoice: updatedInvoice,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Nie udało się pobrać treści faktury z KSeF.' },
      { status: 502 }
    )
  }
}
