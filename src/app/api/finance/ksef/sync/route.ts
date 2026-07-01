import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import {
  KsefApiError,
  KsefApiClient,
  describeKsefApiError,
  mapKsefMetadataToInvoice,
  type KsefEnvironment,
} from '@/lib/finance/ksef-client'
import { resolveSupplierRuleMatch } from '@/lib/finance/ksef-inbox'
import { applySupplierRulesToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { buildKsefSyncDateRanges } from '@/lib/finance/ksef-sync-ranges'

const KSEF_SETTINGS = [
  'ksef_enabled',
  'ksef_environment',
  'ksef_company_nip',
  'ksef_token',
  'ksef_sync_from',
] as const

export async function POST() {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

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
  const syncFrom = map.get('ksef_sync_from') || new Date().toISOString().slice(0, 10)

  if (!token || !companyNip) {
    return NextResponse.json({ error: 'Brakuje tokena KSeF albo NIP firmy w ustawieniach.' }, { status: 400 })
  }

  try {
    const client = new KsefApiClient({ environment })
    const authTokens = await client.authenticateWithToken({ companyNip, token })
    const rules = await prisma.ksefSupplierRule.findMany({ where: { active: true } })

    let imported = 0
    let updated = 0
    let fetched = 0
    let truncated = false
    let mappedByRules = 0
    const ranges = buildKsefSyncDateRanges(syncFrom)

    for (const range of ranges) {
      let pageOffset = 0
      let hasMore = true

      while (hasMore && pageOffset < 20) {
        const response = await client.queryPurchaseInvoiceMetadata({
          accessToken: authTokens.accessToken.token,
          from: range.from,
          to: range.to,
          pageOffset,
          pageSize: 250,
        })

        fetched += response.invoices.length
        truncated ||= response.isTruncated
        hasMore = response.hasMore

        for (const metadata of response.invoices) {
          const invoiceData = mapKsefMetadataToInvoice(metadata)
          const existing = await prisma.ksefInvoice.findUnique({
            where: { externalId: invoiceData.externalId },
          })

          if (existing) {
            await prisma.ksefInvoice.update({
              where: { id: existing.id },
              data: {
                supplierName: invoiceData.supplierName,
                supplierNip: invoiceData.supplierNip,
                invoiceNumber: invoiceData.invoiceNumber,
                issueDate: invoiceData.issueDate,
                grossAmount: invoiceData.grossAmount,
                netAmount: invoiceData.netAmount,
                vatAmount: invoiceData.vatAmount,
                currency: invoiceData.currency,
              },
            })
            updated += 1
            continue
          }

          const ruleDecision = resolveSupplierRuleMatch(
            { supplierName: invoiceData.supplierName, supplierNip: invoiceData.supplierNip },
            rules
          )
          const match = ruleDecision.status === 'MATCHED' ? ruleDecision.rule : null

          await prisma.ksefInvoice.create({
            data: {
              ...invoiceData,
              status: match ? 'MAPPED' : 'NEW',
              ruleMatchStatus: ruleDecision.status === 'CONFLICT' ? 'CONFLICT' : match ? 'MATCHED' : 'NO_RULE',
              costCenterId: match?.costCenterId ?? null,
              subCategoryId: match?.subCategoryId ?? null,
              supplierRuleId: match?.id ?? null,
            },
          })
          imported += 1
        }

        pageOffset += 1
      }
    }

    mappedByRules = await applySupplierRulesToNewInvoices(prisma, rules)

    return NextResponse.json({
      ok: true,
      environment,
      fetched,
      imported,
      updated,
      mappedByRules,
      ranges: ranges.length,
      truncated,
    })
  } catch (err) {
    return NextResponse.json(
      { error: describeKsefApiError(err) },
      { status: err instanceof KsefApiError && err.status === 429 ? 429 : 502 }
    )
  }
}
