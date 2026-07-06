import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import {
  KsefApiError,
  KsefApiClient,
  describeKsefApiError,
  type KsefEnvironment,
} from '@/lib/finance/ksef-client'
import {
  fetchKsefInvoiceDetailWithRetry,
  wait,
  XML_DETAILS_THROTTLE_MS,
} from '@/lib/finance/ksef-detail-fetch'

// Re-download full invoice XML for KSeF invoices that are not cached locally yet.
// The regular sync fetches details inline, but KSeF caps full XML downloads
// aggressively, so a large historical import can leave invoices visible in the
// inbox without XML for preview. This endpoint fills that cache in throttled,
// keyset-paginated batches so clicking preview does not need to hit KSeF again.
const KSEF_SETTINGS = ['ksef_enabled', 'ksef_environment', 'ksef_company_nip', 'ksef_token'] as const
const DEFAULT_BATCH = 50
const MAX_BATCH = 200

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const payload = (await req.json().catch(() => ({}))) as { before?: string; limit?: number }
  const limit = Math.min(Math.max(Math.trunc(Number(payload.limit) || DEFAULT_BATCH), 1), MAX_BATCH)
  const before = payload.before ? new Date(payload.before) : null
  const hasValidBefore = before !== null && !Number.isNaN(before.getTime())

  const settings = await prisma.appSetting.findMany({ where: { key: { in: [...KSEF_SETTINGS] } } })
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

  const invoices = await prisma.ksefInvoice.findMany({
    where: {
      source: 'KSEF',
      externalId: { not: null },
      xmlContent: null,
      ...(hasValidBefore ? { issueDate: { lt: before } } : {}),
    },
    select: {
      id: true,
      externalId: true,
      issueDate: true,
      dueDate: true,
      bankAccount: true,
      paymentStatus: true,
      paidAt: true,
    },
    orderBy: { issueDate: 'desc' },
    take: limit,
  })

  if (invoices.length === 0) {
    const remaining = await prisma.ksefInvoice.count({
      where: { source: 'KSEF', externalId: { not: null }, xmlContent: null },
    })
    return NextResponse.json({ ok: true, scanned: 0, updated: 0, markedPaid: 0, cachedXml: 0, failed: 0, rateLimited: false, done: true, nextBefore: null, remaining })
  }

  try {
    const client = new KsefApiClient({ environment })
    const authTokens = await client.authenticateWithToken({ companyNip, token })

    let updated = 0
    let markedPaid = 0
    let cachedXml = 0
    let failed = 0
    let rateLimited = false
    let nextBefore: string | null = null

    for (const invoice of invoices) {
      if (!invoice.externalId) continue
      nextBefore = invoice.issueDate.toISOString()

      try {
        const details = await fetchKsefInvoiceDetailWithRetry({
          client,
          accessToken: authTokens.accessToken.token,
          ksefNumber: invoice.externalId,
        })

        const fetchedAt = new Date()
        const shouldMarkPaid = !details.dueDate && !invoice.dueDate && invoice.paymentStatus !== 'PAID'
        const shouldCountDueDateUpdate = Boolean(details.dueDate && !invoice.dueDate)

        await prisma.ksefInvoice.update({
          where: { id: invoice.id },
          data: {
            dueDate: details.dueDate ?? invoice.dueDate,
            bankAccount: details.bankAccount ?? invoice.bankAccount ?? undefined,
            paymentDetailsFetchedAt: fetchedAt,
            xmlContent: details.xml,
            xmlFetchedAt: fetchedAt,
            ...(shouldMarkPaid ? { paymentStatus: 'PAID', paidAt: invoice.paidAt ?? invoice.issueDate } : {}),
          },
        })
        cachedXml += 1

        if (details.dueDate) {
          if (shouldCountDueDateUpdate) updated += 1
        } else if (shouldMarkPaid) {
          markedPaid += 1
        }
      } catch (err) {
        failed += 1
        if (err instanceof KsefApiError && err.status === 429) {
          rateLimited = true
          break
        }
      }

      await wait(XML_DETAILS_THROTTLE_MS)
    }

    const remaining = await prisma.ksefInvoice.count({
      where: { source: 'KSEF', externalId: { not: null }, xmlContent: null },
    })

    return NextResponse.json({
      ok: true,
      scanned: invoices.length,
      updated,
      markedPaid,
      cachedXml,
      failed,
      rateLimited,
      done: !rateLimited && invoices.length < limit,
      nextBefore,
      remaining,
    })
  } catch (err) {
    return NextResponse.json(
      { error: describeKsefApiError(err) },
      { status: err instanceof KsefApiError && err.status === 429 ? 429 : 502 }
    )
  }
}
