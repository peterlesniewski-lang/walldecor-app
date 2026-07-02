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
import {
  fetchKsefInvoiceDetailWithRetry,
  wait,
  XML_DETAILS_THROTTLE_MS,
} from '@/lib/finance/ksef-detail-fetch'

const KSEF_SETTINGS = [
  'ksef_enabled',
  'ksef_environment',
  'ksef_company_nip',
  'ksef_token',
  'ksef_sync_from',
] as const

type MappedKsefInvoice = ReturnType<typeof mapKsefMetadataToInvoice>
type PersistableKsefInvoice = Omit<MappedKsefInvoice, 'correctedKsefNumber' | 'correctedInvoiceNumber'>
type ExistingInvoiceDetails = {
  dueDate: Date | null
  bankAccount: string | null
  paymentDetailsFetchedAt?: Date | null
} | null

function splitMappedInvoice(invoice: MappedKsefInvoice) {
  const { correctedKsefNumber, correctedInvoiceNumber, ...data } = invoice
  return { data, correctedKsefNumber, correctedInvoiceNumber }
}

function blocksAutomaticClassification(invoice: PersistableKsefInvoice) {
  return (
    invoice.documentStatus !== 'ACTIVE' ||
    (invoice.currency !== 'PLN' && invoice.reportingGrossAmount == null)
  )
}

function needsInvoiceXmlDetails(invoice: PersistableKsefInvoice, existing: ExistingInvoiceDetails) {
  if (existing?.paymentDetailsFetchedAt) return false
  return (!invoice.dueDate && !existing?.dueDate) || (!invoice.bankAccount && !existing?.bankAccount)
}

async function findCorrectedInvoiceId({
  correctedKsefNumber,
  correctedInvoiceNumber,
  supplierNip,
  excludeId,
}: {
  correctedKsefNumber: string | null
  correctedInvoiceNumber: string | null
  supplierNip: string | null
  excludeId?: string
}) {
  if (correctedKsefNumber) {
    const original = await prisma.ksefInvoice.findUnique({
      where: { externalId: correctedKsefNumber },
      select: { id: true },
    })
    if (original && original.id !== excludeId) return original.id
  }

  if (!correctedInvoiceNumber) return null

  const original = await prisma.ksefInvoice.findFirst({
    where: {
      invoiceNumber: correctedInvoiceNumber,
      ...(supplierNip ? { supplierNip } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
    orderBy: { issueDate: 'desc' },
  })

  return original?.id ?? null
}

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
    const rules = await prisma.ksefSupplierRule.findMany({
      where: { active: true },
      include: { tags: true },
    })

    let imported = 0
    let updated = 0
    let fetched = 0
    let truncated = false
    let mappedByRules = 0
    let xmlDetailsFetched = 0
    let xmlDetailsFailed = 0
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
          const mappedInvoice = mapKsefMetadataToInvoice(metadata)
          const {
            data: invoiceData,
            correctedKsefNumber,
            correctedInvoiceNumber,
          } = splitMappedInvoice(mappedInvoice)
          const existing = await prisma.ksefInvoice.findUnique({
            where: { externalId: invoiceData.externalId },
          })
          let paymentDetailsFetchedAt: Date | null = null
          if (needsInvoiceXmlDetails(invoiceData, existing)) {
            try {
              const details = await fetchKsefInvoiceDetailWithRetry({
                client,
                accessToken: authTokens.accessToken.token,
                ksefNumber: invoiceData.externalId,
              })
              invoiceData.dueDate = details.dueDate ?? invoiceData.dueDate
              invoiceData.bankAccount = details.bankAccount ?? invoiceData.bankAccount
              paymentDetailsFetchedAt = new Date()
              xmlDetailsFetched += 1
            } catch {
              xmlDetailsFailed += 1
            }
            // Throttle between full-XML downloads so a large backlog does not
            // trip KSeF rate limiting and silently drop payment due dates.
            await wait(XML_DETAILS_THROTTLE_MS)
          }
          const xmlConfirmsNoDueDate = Boolean(paymentDetailsFetchedAt && !invoiceData.dueDate)
          const correctsInvoiceId = await findCorrectedInvoiceId({
            correctedKsefNumber,
            correctedInvoiceNumber,
            supplierNip: invoiceData.supplierNip,
            excludeId: existing?.id,
          })
          const shouldBlockClassification = blocksAutomaticClassification(invoiceData)

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
                reportingGrossAmount: invoiceData.currency === 'PLN' ? null : existing.reportingGrossAmount,
                reportingNetAmount: invoiceData.currency === 'PLN' ? null : existing.reportingNetAmount,
                reportingVatAmount: invoiceData.currency === 'PLN' ? null : existing.reportingVatAmount,
                originalCurrency: invoiceData.originalCurrency,
                originalGrossAmount: invoiceData.originalGrossAmount,
                originalNetAmount: invoiceData.originalNetAmount,
                originalVatAmount: invoiceData.originalVatAmount,
                dueDate: invoiceData.dueDate ?? existing.dueDate,
                bankAccount: invoiceData.bankAccount ?? existing.bankAccount,
                paymentDetailsFetchedAt: paymentDetailsFetchedAt ?? existing.paymentDetailsFetchedAt,
                documentStatus: invoiceData.documentStatus,
                correctsInvoiceId: invoiceData.documentStatus === 'CORRECTION' ? correctsInvoiceId : null,
                ...(xmlConfirmsNoDueDate && existing.paymentStatus !== 'PAID'
                  ? { paymentStatus: 'PAID', paidAt: existing.paidAt ?? invoiceData.issueDate }
                  : {}),
                ...(shouldBlockClassification && existing.status !== 'APPROVED'
                  ? {
                      status: 'NEW',
                      ruleMatchStatus: 'NO_RULE',
                      costCenterId: null,
                      subCategoryId: null,
                      supplierRuleId: null,
                    }
                  : {}),
              },
            })
            updated += 1
            continue
          }

          const ruleDecision = shouldBlockClassification
            ? { status: 'NO_RULE' as const }
            : resolveSupplierRuleMatch(
                { supplierName: invoiceData.supplierName, supplierNip: invoiceData.supplierNip },
                rules
              )
          const match = ruleDecision.status === 'MATCHED' ? ruleDecision.rule : null

          await prisma.ksefInvoice.create({
            data: {
              ...invoiceData,
              paymentDetailsFetchedAt,
              correctsInvoiceId: invoiceData.documentStatus === 'CORRECTION' ? correctsInvoiceId : null,
              ...(xmlConfirmsNoDueDate ? { paymentStatus: 'PAID', paidAt: invoiceData.issueDate } : {}),
              status: match ? 'MAPPED' : 'NEW',
              ruleMatchStatus: ruleDecision.status === 'CONFLICT' ? 'CONFLICT' : match ? 'MATCHED' : 'NO_RULE',
              costCenterId: match?.costCenterId ?? null,
              subCategoryId: match?.subCategoryId ?? null,
              supplierRuleId: match?.id ?? null,
              ...(match?.tags && match.tags.length > 0
                ? {
                    parts: {
                      create: {
                        label: invoiceData.invoiceNumber,
                        grossAmount: invoiceData.reportingGrossAmount ?? invoiceData.grossAmount,
                        order: 0,
                        tags: { create: match.tags.map((tag) => ({ tagId: tag.tagId })) },
                        allocations: { create: { costCenterId: match.costCenterId, percent: 100 } },
                      },
                    },
                  }
                : {}),
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
      xmlDetailsFetched,
      xmlDetailsFailed,
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
