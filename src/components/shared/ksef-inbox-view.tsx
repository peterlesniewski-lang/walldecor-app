'use client'

import { useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CloudDownload, Eye, FilePlus2, RefreshCcw, Save, Search, Settings2, X } from 'lucide-react'
import { parseKsefInvoiceXmlPreview, type KsefInvoiceXmlPreview } from '@/lib/finance/ksef-invoice-preview'
import { TagChips } from '@/components/shared/tag-chips'
import { KsefInvoicePartsEditor } from '@/components/shared/ksef-invoice-parts-editor'
import { KsefPaymentSummary } from '@/components/shared/ksef-payment-summary'

export type KsefStatus = 'NEW' | 'MAPPED' | 'APPROVED' | 'IGNORED'
export type KsefPaymentStatus = 'UNPAID' | 'PAID'
type KsefPaymentDeadline = 'OVERDUE' | 'DUE_0_7' | 'DUE_8_14' | 'DUE_15_30' | 'LATER' | 'MISSING_DUE_DATE'
type KsefPageSize = 50 | 100 | 200
type KsefInvoiceCounts = Record<KsefStatus, number>
type KsefPaymentAging = Record<KsefPaymentDeadline, { count: number; grossAmount: number }>

interface CostCenterOption {
  id: string
  name: string
}

interface SubCategoryOption {
  id: string
  name: string
  category: { name: string }
}

interface CostTagGroupOption {
  id: string
  name: string
  slug: string
  tags: Array<{ id: string; name: string; slug: string }>
}

interface KsefInvoiceRow {
  id: string
  externalId: string | null
  supplierName: string
  supplierNip: string | null
  invoiceNumber: string
  issueDate: string
  grossAmount: number
  netAmount: number | null
  vatAmount: number | null
  currency: string
  reportingGrossAmount?: number | null
  reportingNetAmount?: number | null
  reportingVatAmount?: number | null
  originalCurrency?: string | null
  originalGrossAmount?: number | null
  originalNetAmount?: number | null
  originalVatAmount?: number | null
  currencyConversionNote?: string | null
  convertedById?: string | null
  convertedAt?: string | null
  status: KsefStatus
  paymentStatus?: KsefPaymentStatus
  paidAt?: string | null
  dueDate?: string | null
  bankAccount?: string | null
  documentStatus?: string
  ruleMatchStatus?: string
  notes: string | null
  costCenterId: string | null
  subCategoryId: string | null
  costCenter: CostCenterOption | null
  subCategory: SubCategoryOption | null
  parts?: Array<{
    tags: Array<{ tagId?: string; tag?: { id: string; name: string; slug: string } }>
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

interface KsefInvoiceContentPreview {
  invoice: KsefInvoiceRow
  ksefNumber: string
  xml: string
  preview: KsefInvoiceXmlPreview
}

interface KsefSupplierRuleRow {
  id: string
  supplierNamePattern: string | null
  supplierNip: string | null
  costCenterId: string
  subCategoryId: string | null
  active: boolean
  costCenter: CostCenterOption
  subCategory: SubCategoryOption | null
  tags?: Array<{ tagId?: string; tag?: { id: string; name: string; slug: string } }>
}

interface KsefInvoiceListResponse {
  invoices: KsefInvoiceRow[]
  total: number
  grossAmountTotal: number
  unpaidAmountTotal?: number
  paymentAging?: KsefPaymentAging
  page: number
  pageSize: KsefPageSize
  totalPages: number
  counts: KsefInvoiceCounts
}

interface KsefInvoiceFilters {
  search: string
  amountMin: string
  amountMax: string
  paymentStatus: KsefPaymentStatus | 'ALL'
  paymentDeadline: KsefPaymentDeadline | 'ALL'
}

interface KsefInboxViewProps {
  initialInvoices: KsefInvoiceRow[]
  initialTotal: number
  initialGrossAmountTotal: number
  initialUnpaidAmountTotal?: number
  initialPaymentAging?: KsefPaymentAging
  initialPage: number
  initialPageSize: KsefPageSize
  initialTotalPages: number
  initialCounts: KsefInvoiceCounts
  initialRules: KsefSupplierRuleRow[]
  costCenters: CostCenterOption[]
  subCategories: SubCategoryOption[]
  costTagGroups?: CostTagGroupOption[]
}

const STATUS_LABELS: Record<KsefStatus, string> = {
  NEW: 'Nowa',
  MAPPED: 'Zmapowana',
  APPROVED: 'Zatwierdzona',
  IGNORED: 'Ignorowana',
}

const STATUS_CLASSES: Record<KsefStatus, string> = {
  NEW: 'bg-amber-50 text-amber-700 border-amber-100',
  MAPPED: 'bg-blue-50 text-blue-700 border-blue-100',
  APPROVED: 'bg-green-50 text-green-700 border-green-100',
  IGNORED: 'bg-gray-50 text-gray-600 border-gray-200',
}

const PAGE_SIZE_OPTIONS: KsefPageSize[] = [50, 100, 200]
const EMPTY_PAYMENT_AGING: KsefPaymentAging = {
  OVERDUE: { count: 0, grossAmount: 0 },
  DUE_0_7: { count: 0, grossAmount: 0 },
  DUE_8_14: { count: 0, grossAmount: 0 },
  DUE_15_30: { count: 0, grossAmount: 0 },
  LATER: { count: 0, grossAmount: 0 },
  MISSING_DUE_DATE: { count: 0, grossAmount: 0 },
}
const EMPTY_INVOICE_FILTERS: KsefInvoiceFilters = {
  search: '',
  amountMin: '',
  amountMax: '',
  paymentStatus: 'ALL',
  paymentDeadline: 'ALL',
}
const PAYMENT_STATUS_LABELS: Record<KsefPaymentStatus | 'ALL', string> = {
  ALL: 'Wszystkie',
  UNPAID: 'Do zapłaty',
  PAID: 'Zapłacone',
}
const PAYMENT_DEADLINE_LABELS: Record<KsefPaymentDeadline | 'ALL', string> = {
  ALL: 'Wszystkie',
  OVERDUE: 'Po terminie',
  DUE_0_7: '0-7 dni',
  DUE_8_14: '8-14 dni',
  DUE_15_30: '15-30 dni',
  LATER: 'Później',
  MISSING_DUE_DATE: 'Brak terminu',
}

function money(value: number, currency = 'PLN') {
  return `${Math.round(value * 100) / 100}`.replace('.', ',') + ` ${currency}`
}

function isoDate(value: string) {
  return value.slice(0, 10)
}

function formatBankAccount(value: string) {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

function CostCenterChips({
  options,
  value,
  disabled,
  onChange,
}: {
  options: CostCenterOption[]
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  return (
    <div className="flex min-w-40 flex-wrap gap-1">
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
              selected
                ? 'border-[var(--wd-dark)] bg-[var(--wd-dark)] text-white'
                : 'border-[var(--wd-border)] bg-white text-[var(--wd-dark)] hover:bg-gray-50'
            }`}
          >
            {option.name}
          </button>
        )
      })}
    </div>
  )
}

function invoiceTagIds(invoice: KsefInvoiceRow) {
  return Array.from(new Set(
    invoice.parts?.flatMap((part) => part.tags.map((entry) => entry.tagId ?? entry.tag?.id).filter(Boolean) as string[]) ?? []
  ))
}

function invoiceAllocationCostCenterId(invoice: KsefInvoiceRow) {
  const wholeAllocation = invoice.parts?.[0]?.allocations.find((allocation) => allocation.percent === 100)
  return wholeAllocation?.costCenterId ?? invoice.costCenterId
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error ?? 'Operacja nie powiodła się')
  }
  return data
}

function buildClassificationState(
  invoices: KsefInvoiceRow[],
  costCenters: CostCenterOption[]
) {
  return Object.fromEntries(
    invoices.map((invoice) => [
      invoice.id,
      {
        costCenterId: invoiceAllocationCostCenterId(invoice) ?? costCenters[0]?.id ?? 'GLOBAL',
        tagIds: invoiceTagIds(invoice),
      },
    ])
  )
}

function normalizeInvoiceFilters(filters: KsefInvoiceFilters): KsefInvoiceFilters {
  return {
    search: filters.search.trim(),
    amountMin: filters.amountMin.trim(),
    amountMax: filters.amountMax.trim(),
    paymentStatus: filters.paymentStatus,
    paymentDeadline: filters.paymentDeadline,
  }
}

export function KsefInboxView({
  initialInvoices,
  initialTotal,
  initialGrossAmountTotal,
  initialUnpaidAmountTotal = 0,
  initialPaymentAging = EMPTY_PAYMENT_AGING,
  initialPage,
  initialPageSize,
  initialTotalPages,
  initialCounts,
  initialRules,
  costCenters,
  subCategories,
  costTagGroups = [],
}: KsefInboxViewProps) {
  const [invoices, setInvoices] = useState(initialInvoices)
  const [rules, setRules] = useState(initialRules)
  const [statusFilter, setStatusFilter] = useState<KsefStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState<KsefPageSize>(initialPageSize)
  const [total, setTotal] = useState(initialTotal)
  const [grossAmountTotal, setGrossAmountTotal] = useState(initialGrossAmountTotal)
  const [unpaidAmountTotal, setUnpaidAmountTotal] = useState(initialUnpaidAmountTotal)
  const [paymentAging, setPaymentAging] = useState(initialPaymentAging)
  const [totalPages, setTotalPages] = useState(initialTotalPages)
  const [counts, setCounts] = useState<KsefInvoiceCounts>(initialCounts)
  const [filterForm, setFilterForm] = useState<KsefInvoiceFilters>(EMPTY_INVOICE_FILTERS)
  const [activeFilters, setActiveFilters] = useState<KsefInvoiceFilters>(EMPTY_INVOICE_FILTERS)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [contentPreview, setContentPreview] = useState<KsefInvoiceContentPreview | null>(null)
  const [partsEditorInvoice, setPartsEditorInvoice] = useState<KsefInvoiceRow | null>(null)
  const [conversionForm, setConversionForm] = useState<{
    invoiceId: string
    reportingGrossAmount: string
    reportingNetAmount: string
    reportingVatAmount: string
    currencyConversionNote: string
  } | null>(null)
  const [invoiceForm, setInvoiceForm] = useState({
    supplierName: '',
    supplierNip: '',
    invoiceNumber: '',
    issueDate: new Date().toISOString().slice(0, 10),
    grossAmount: '',
    netAmount: '',
    vatAmount: '',
    currency: 'PLN',
    notes: '',
  })
  const [ruleForm, setRuleForm] = useState({
    supplierNamePattern: '',
    supplierNip: '',
    costCenterId: costCenters[0]?.id ?? 'GLOBAL',
    tagIds: [] as string[],
  })
  const [classification, setClassification] = useState<Record<string, { costCenterId: string; tagIds: string[] }>>(
    buildClassificationState(initialInvoices, costCenters)
  )
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastItem = total === 0 ? 0 : Math.min(total, (page - 1) * pageSize + invoices.length)
  const hasActiveResultFilter = statusFilter !== 'ALL'
    || activeFilters.paymentStatus !== 'ALL'
    || activeFilters.paymentDeadline !== 'ALL'
    || Boolean(activeFilters.search || activeFilters.amountMin || activeFilters.amountMax)
  const hasCostTags = costTagGroups.some((group) => group.tags.length > 0)

  function replaceInvoice(updated: KsefInvoiceRow) {
    setInvoices((current) => current.map((invoice) => (invoice.id === updated.id ? updated : invoice)))
    setClassification((current) => ({
      ...current,
      [updated.id]: {
        costCenterId: invoiceAllocationCostCenterId(updated) ?? current[updated.id]?.costCenterId ?? costCenters[0]?.id ?? 'GLOBAL',
        tagIds: invoiceTagIds(updated).length > 0 ? invoiceTagIds(updated) : current[updated.id]?.tagIds ?? [],
      },
    }))
  }

  function applyInvoicePage(response: KsefInvoiceListResponse) {
    setInvoices(response.invoices)
    setPage(response.page)
    setPageSize(response.pageSize)
    setTotal(response.total)
    setGrossAmountTotal(response.grossAmountTotal ?? 0)
    setUnpaidAmountTotal(response.unpaidAmountTotal ?? 0)
    setPaymentAging(response.paymentAging ?? EMPTY_PAYMENT_AGING)
    setTotalPages(response.totalPages)
    setCounts(response.counts)
    setClassification(buildClassificationState(response.invoices, costCenters))
    return response.invoices
  }

  async function refreshInvoices(options: {
    page?: number
    pageSize?: KsefPageSize
    statusFilter?: KsefStatus | 'ALL'
    filters?: KsefInvoiceFilters
  } = {}) {
    const targetPage = options.page ?? page
    const targetPageSize = options.pageSize ?? pageSize
    const targetStatus = options.statusFilter ?? statusFilter
    const targetFilters = normalizeInvoiceFilters(options.filters ?? activeFilters)
    const params = new URLSearchParams({
      page: String(targetPage),
      pageSize: String(targetPageSize),
    })
    if (targetStatus !== 'ALL') params.set('status', targetStatus)
    if (targetFilters.search) params.set('search', targetFilters.search)
    if (targetFilters.amountMin) params.set('amountMin', targetFilters.amountMin)
    if (targetFilters.amountMax) params.set('amountMax', targetFilters.amountMax)
    if (targetFilters.paymentStatus !== 'ALL') params.set('paymentStatus', targetFilters.paymentStatus)
    if (targetFilters.paymentDeadline !== 'ALL') params.set('paymentDeadline', targetFilters.paymentDeadline)

    const response = await readJson(await fetch(`/api/finance/ksef/invoices?${params.toString()}`)) as KsefInvoiceListResponse
    if (response.invoices.length === 0 && response.total > 0 && targetPage > response.totalPages) {
      return refreshInvoices({ page: response.totalPages, pageSize: targetPageSize, statusFilter: targetStatus, filters: targetFilters })
    }

    return applyInvoicePage(response)
  }

  async function applyInvoiceFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSyncMessage(null)
    setSaving('filters')
    const nextFilters = normalizeInvoiceFilters(filterForm)
    try {
      setActiveFilters(nextFilters)
      setFilterForm(nextFilters)
      setPage(1)
      await refreshInvoices({ page: 1, filters: nextFilters })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zastosować filtrów')
    } finally {
      setSaving(null)
    }
  }

  async function clearInvoiceFilters() {
    setError(null)
    setSyncMessage(null)
    setSaving('filters')
    try {
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
      setPage(1)
      await refreshInvoices({ page: 1, filters: EMPTY_INVOICE_FILTERS })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wyczyścić filtrów')
    } finally {
      setSaving(null)
    }
  }

  async function changeStatusFilter(status: KsefStatus) {
    const nextFilter = statusFilter === status ? 'ALL' : status
    setError(null)
    setSyncMessage(null)
    try {
      setStatusFilter(nextFilter)
      setPage(1)
      await refreshInvoices({ page: 1, statusFilter: nextFilter })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się odświeżyć faktur')
    }
  }

  async function showAllInvoices() {
    setError(null)
    setSyncMessage(null)
    try {
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
      setStatusFilter('ALL')
      setPage(1)
      await refreshInvoices({ page: 1, statusFilter: 'ALL', filters: EMPTY_INVOICE_FILTERS })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się odświeżyć faktur')
    }
  }

  async function changePageSize(nextPageSize: KsefPageSize) {
    setError(null)
    setSyncMessage(null)
    try {
      setPageSize(nextPageSize)
      setPage(1)
      await refreshInvoices({ page: 1, pageSize: nextPageSize })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić stronicowania')
    }
  }

  async function goToPage(nextPage: number) {
    const boundedPage = Math.max(1, Math.min(totalPages, nextPage))
    if (boundedPage === page) return
    setError(null)
    setSyncMessage(null)
    try {
      setPage(boundedPage)
      await refreshInvoices({ page: boundedPage })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić strony')
    }
  }

  async function addInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSyncMessage(null)
    setSaving('invoice')
    try {
      await readJson(await fetch('/api/finance/ksef/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...invoiceForm,
          grossAmount: Number(invoiceForm.grossAmount),
          netAmount: invoiceForm.netAmount ? Number(invoiceForm.netAmount) : undefined,
          vatAmount: invoiceForm.vatAmount ? Number(invoiceForm.vatAmount) : undefined,
        }),
      }))
      setStatusFilter('ALL')
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
      await refreshInvoices({ page: 1, statusFilter: 'ALL', filters: EMPTY_INVOICE_FILTERS })
      setInvoiceForm((current) => ({
        ...current,
        supplierName: '',
        supplierNip: '',
        invoiceNumber: '',
        grossAmount: '',
        netAmount: '',
        vatAmount: '',
        notes: '',
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać faktury')
    } finally {
      setSaving(null)
    }
  }

  async function saveClassification(invoiceId: string) {
    setError(null)
    setSyncMessage(null)
    setSaving(invoiceId)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classification[invoiceId]),
      }))
      const updated = result.invoice ?? result
      replaceInvoice(updated)
      await refreshInvoices()
      if (result.appliedCount > 0) {
        setSyncMessage(`Reguła dostawcy zmapowała ${result.appliedCount} pozostałych faktur.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać klasyfikacji')
    } finally {
      setSaving(null)
    }
  }

  async function approveInvoice(invoiceId: string) {
    setError(null)
    setSyncMessage(null)
    setSaving(`approve-${invoiceId}`)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoiceId}/approve`, {
        method: 'POST',
      }))
      replaceInvoice(result.invoice)
      await refreshInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zatwierdzić faktury')
    } finally {
      setSaving(null)
    }
  }

  async function unapproveInvoice(invoiceId: string) {
    setError(null)
    setSyncMessage(null)
    setSaving(`unapprove-${invoiceId}`)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoiceId}/approve`, {
        method: 'DELETE',
      }))
      replaceInvoice(result.invoice)
      setSyncMessage('Faktura cofnięta z kosztów. Możesz poprawić klasyfikację i zatwierdzić ją ponownie.')
      await refreshInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się cofnąć faktury z kosztów')
    } finally {
      setSaving(null)
    }
  }

  async function updatePaymentStatus(invoice: KsefInvoiceRow) {
    setError(null)
    setSyncMessage(null)
    setSaving(`payment-${invoice.id}`)
    const nextStatus: KsefPaymentStatus = invoice.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID'
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoice.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentStatus: nextStatus,
          dueDate: invoice.dueDate ?? null,
        }),
      }))
      replaceInvoice(result.invoice)
      await refreshInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić statusu płatności')
    } finally {
      setSaving(null)
    }
  }

  async function convertCurrency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!conversionForm) return

    setError(null)
    setSyncMessage(null)
    setSaving(`currency-${conversionForm.invoiceId}`)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${conversionForm.invoiceId}/currency-conversion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportingGrossAmount: Number(conversionForm.reportingGrossAmount),
          reportingNetAmount: conversionForm.reportingNetAmount ? Number(conversionForm.reportingNetAmount) : null,
          reportingVatAmount: conversionForm.reportingVatAmount ? Number(conversionForm.reportingVatAmount) : null,
          currencyConversionNote: conversionForm.currencyConversionNote,
        }),
      }))
      replaceInvoice(result.invoice)
      setConversionForm(null)
      await refreshInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać przeliczenia PLN')
    } finally {
      setSaving(null)
    }
  }

  async function ignoreInvoice(invoiceId: string) {
    setError(null)
    setSyncMessage(null)
    setSaving(`ignore-${invoiceId}`)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IGNORED' }),
      }))
      const updated = result.invoice ?? result
      replaceInvoice(updated)
      await refreshInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zignorować faktury')
    } finally {
      setSaving(null)
    }
  }

  async function addRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSyncMessage(null)
    setSaving('rule')
    try {
      const result = await readJson(await fetch('/api/finance/ksef/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ruleForm),
      }))
      const rule = result.rule ?? result
      setRules((current) => [rule, ...current])
      await refreshInvoices({ page: 1 })
      if (result.appliedCount > 0) {
        setSyncMessage(`Reguła dostawcy zmapowała ${result.appliedCount} istniejących faktur.`)
      }
      setRuleForm((current) => ({ ...current, supplierNamePattern: '', supplierNip: '' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać reguły')
    } finally {
      setSaving(null)
    }
  }

  async function syncKsef() {
    setError(null)
    setSyncMessage(null)
    setSaving('sync')
    try {
      const result = await readJson(await fetch('/api/finance/ksef/sync', { method: 'POST' }))
      setStatusFilter('ALL')
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
      await refreshInvoices({ page: 1, statusFilter: 'ALL', filters: EMPTY_INVOICE_FILTERS })
      setSyncMessage(
        `KSeF: pobrano ${result.fetched}, dodano ${result.imported}, zaktualizowano ${result.updated}, zmapowano regułami ${result.mappedByRules ?? 0}. XML faktur: pobrano ${result.xmlDetailsFetched ?? 0}, błędy ${result.xmlDetailsFailed ?? 0}.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zsynchronizować KSeF')
    } finally {
      setSaving(null)
    }
  }

  async function backfillDueDates() {
    setError(null)
    setSyncMessage(null)
    setSaving('backfill')
    try {
      let before: string | null = null
      let totalUpdated = 0
      let totalPaid = 0
      let totalScanned = 0
      let totalFailed = 0

      // Walk the whole backlog of due-date-less KSeF invoices in throttled,
      // keyset-paginated passes. The endpoint caps each batch; we loop until it
      // reports done. The pass cap is a safety net against an unbounded loop.
      for (let pass = 0; pass < 500; pass++) {
        const result = await readJson(
          await fetch('/api/finance/ksef/invoices/backfill-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(before ? { before } : {}),
          })
        )
        totalUpdated += result.updated ?? 0
        totalPaid += result.markedPaid ?? 0
        totalScanned += result.scanned ?? 0
        totalFailed += result.failed ?? 0
        setSyncMessage(
          `Uzupełnianie terminów… sprawdzono ${totalScanned}, terminy ${totalUpdated}, opłacone ${totalPaid}${totalFailed ? `, błędy ${totalFailed}` : ''}.`
        )
        if (result.done || !result.nextBefore) break
        before = result.nextBefore
      }

      await refreshInvoices({ page: 1 })
      setSyncMessage(
        `Gotowe. Uzupełniono terminy dla ${totalUpdated} faktur, ${totalPaid} bez terminu oznaczono jako opłacone (sprawdzono ${totalScanned}${totalFailed ? `, nie udało się ${totalFailed}` : ''}).`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się uzupełnić terminów płatności')
    } finally {
      setSaving(null)
    }
  }

  async function loadInvoiceContent(invoice: KsefInvoiceRow) {
    setError(null)
    setSyncMessage(null)
    setSaving(`content-${invoice.id}`)
    try {
      const result = await readJson(await fetch(`/api/finance/ksef/invoices/${invoice.id}/content`))
      const preview = parseKsefInvoiceXmlPreview(result.xml)
      const updatedInvoice = {
        ...invoice,
        dueDate: result.invoice?.dueDate ?? invoice.dueDate,
        bankAccount: result.invoice?.bankAccount ?? invoice.bankAccount,
      }
      replaceInvoice(updatedInvoice)
      setContentPreview({
        invoice: updatedInvoice,
        ksefNumber: result.ksefNumber,
        xml: result.xml,
        preview,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać treści faktury')
    } finally {
      setSaving(null)
    }
  }

  function renderPaginationControls() {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
          Na stronie
          <select
            className="rounded border border-[var(--wd-border)] bg-white px-2 py-1 text-xs"
            value={pageSize}
            onChange={(event) => changePageSize(Number(event.target.value) as KsefPageSize)}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="inline-flex overflow-hidden rounded border border-[var(--wd-border)]">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center justify-center px-2 py-1 text-xs disabled:opacity-40"
            title="Poprzednia strona"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex items-center justify-center border-l border-[var(--wd-border)] px-2 py-1 text-xs disabled:opacity-40"
            title="Następna strona"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <button type="button" onClick={showAllInvoices} className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
          <RefreshCcw size={14} />
          pokaż wszystkie
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="data-label mb-1">Kondycja firmy</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>KSeF Inbox</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--wd-text-muted)' }}>
            Ręczny intake faktur zakupowych, klasyfikacja dostawców i zatwierdzanie kosztów do wykonania.
          </p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {(['NEW', 'MAPPED', 'APPROVED', 'IGNORED'] as KsefStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => changeStatusFilter(status)}
                className={`rounded-lg border px-3 py-2 ${STATUS_CLASSES[status]} ${statusFilter === status ? 'ring-2 ring-offset-1 ring-[#D7C8B5]' : ''}`}
              >
                <span className="block font-semibold">{counts[status]}</span>
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={syncKsef}
            disabled={saving === 'sync' || saving === 'backfill'}
            className="inline-flex w-full items-center justify-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <CloudDownload size={16} />
            {saving === 'sync' ? 'Synchronizuję...' : 'Synchronizuj z KSeF'}
          </button>
          <button
            type="button"
            onClick={backfillDueDates}
            disabled={saving === 'backfill' || saving === 'sync'}
            className="inline-flex w-full items-center justify-center gap-2 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold disabled:opacity-60"
            title="Ponownie pobiera XML faktur bez terminu. Uzupełnia termin, jeśli KSeF go zawiera; jeśli faktura nie ma terminu (zwykle już opłacona) — oznacza ją jako opłaconą."
          >
            <CalendarClock size={16} />
            {saving === 'backfill' ? 'Uzupełniam terminy...' : 'Uzupełnij terminy płatności'}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {syncMessage && (
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {syncMessage}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={addInvoice} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <FilePlus2 size={18} className="text-green-700" />
            <h2 className="text-base font-semibold">Dodaj fakturę</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm lg:col-span-2" placeholder="Dostawca" value={invoiceForm.supplierName} onChange={(e) => setInvoiceForm({ ...invoiceForm, supplierName: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="NIP" value={invoiceForm.supplierNip} onChange={(e) => setInvoiceForm({ ...invoiceForm, supplierNip: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="Numer FV" value={invoiceForm.invoiceNumber} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" type="date" value={invoiceForm.issueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, issueDate: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" type="number" step="0.01" placeholder="Brutto" value={invoiceForm.grossAmount} onChange={(e) => setInvoiceForm({ ...invoiceForm, grossAmount: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" type="number" step="0.01" placeholder="Netto" value={invoiceForm.netAmount} onChange={(e) => setInvoiceForm({ ...invoiceForm, netAmount: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" type="number" step="0.01" placeholder="VAT" value={invoiceForm.vatAmount} onChange={(e) => setInvoiceForm({ ...invoiceForm, vatAmount: e.target.value })} />
            <button type="submit" disabled={saving === 'invoice'} className="inline-flex items-center justify-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <FilePlus2 size={16} />
              {saving === 'invoice' ? 'Dodaję...' : 'Dodaj'}
            </button>
          </div>
        </form>

        <form onSubmit={addRule} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Settings2 size={18} className="text-amber-700" />
            <h2 className="text-base font-semibold">Nowa reguła dostawcy</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="NIP" value={ruleForm.supplierNip} onChange={(e) => setRuleForm({ ...ruleForm, supplierNip: e.target.value })} />
            <input className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" placeholder="Wzorzec nazwy" value={ruleForm.supplierNamePattern} onChange={(e) => setRuleForm({ ...ruleForm, supplierNamePattern: e.target.value })} />
            <select className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm" value={ruleForm.costCenterId} onChange={(e) => setRuleForm({ ...ruleForm, costCenterId: e.target.value })}>
              {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
            </select>
            {hasCostTags ? (
              <div className="col-span-2 max-h-48 overflow-y-auto rounded border border-[var(--wd-border)] p-2">
                <TagChips
                  groups={costTagGroups}
                  value={ruleForm.tagIds}
                  size="sm"
                  onChange={(tagIds) => setRuleForm({ ...ruleForm, tagIds })}
                />
              </div>
            ) : (
              <div className="col-span-2 rounded border border-dashed border-[var(--wd-border)] bg-gray-50 px-3 py-2 text-sm font-medium" style={{ color: 'var(--wd-text-muted)' }}>
                Brak tagów kosztowych
              </div>
            )}
            <button type="submit" disabled={saving === 'rule'} className="col-span-2 inline-flex items-center justify-center gap-2 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60">
              <Save size={16} />
              {saving === 'rule' ? 'Zapisuję...' : 'Zapisz regułę'}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--wd-border)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--wd-border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Inbox faktur</h2>
            <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              Pozycje {firstItem}-{lastItem} z {total} · strona {page} z {totalPages}
            </p>
          </div>
          {renderPaginationControls()}
        </div>
        <form onSubmit={applyInvoiceFilters} className="border-b border-[var(--wd-border)] bg-white px-4 py-3">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_140px_140px_140px_150px_auto] md:items-end">
            <label className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
              Dostawca lub NIP
              <input
                className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                placeholder="Nazwa lub NIP dostawcy"
                value={filterForm.search}
                onChange={(event) => setFilterForm((current) => ({ ...current, search: event.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
              Kwota od
              <input
                className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                inputMode="decimal"
                placeholder="0,00"
                value={filterForm.amountMin}
                onChange={(event) => setFilterForm((current) => ({ ...current, amountMin: event.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
              Kwota do
              <input
                className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                inputMode="decimal"
                placeholder="0,00"
                value={filterForm.amountMax}
                onChange={(event) => setFilterForm((current) => ({ ...current, amountMax: event.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
              Płatność
              <select
                className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                value={filterForm.paymentStatus}
                onChange={(event) => setFilterForm((current) => ({ ...current, paymentStatus: event.target.value as KsefPaymentStatus | 'ALL' }))}
              >
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
              Termin
              <select
                className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                value={filterForm.paymentDeadline}
                onChange={(event) => setFilterForm((current) => ({ ...current, paymentDeadline: event.target.value as KsefPaymentDeadline | 'ALL' }))}
              >
                {Object.entries(PAYMENT_DEADLINE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                type="submit"
                disabled={saving === 'filters'}
                className="inline-flex items-center justify-center gap-2 rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Search size={15} />
                Filtruj
              </button>
              <button
                type="button"
                onClick={clearInvoiceFilters}
                disabled={saving === 'filters'}
                className="inline-flex items-center justify-center gap-2 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
              >
                <X size={15} />
                Wyczyść
              </button>
            </div>
          </div>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
              <tr>
                <th className="px-4 py-3 text-right">Lp.</th>
                <th className="px-4 py-3">Faktura</th>
                <th className="px-4 py-3">Dostawca</th>
                <th className="px-4 py-3 text-right">Kwota</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Centrum</th>
                <th className="px-4 py-3">Tagi</th>
                <th className="px-4 py-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--wd-border)]">
              {invoices.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm" colSpan={8} style={{ color: 'var(--wd-text-muted)' }}>
                    Brak faktur dla wybranego filtra.
                  </td>
                </tr>
              ) : invoices.map((invoice, index) => {
                const rowClassification = classification[invoice.id] ?? {
                  costCenterId: invoiceAllocationCostCenterId(invoice) ?? costCenters[0]?.id ?? 'GLOBAL',
                  tagIds: invoiceTagIds(invoice),
                }
                const approved = invoice.status === 'APPROVED'
                const paymentStatus = invoice.paymentStatus ?? 'UNPAID'
                const reportingAmount = invoice.reportingGrossAmount ?? null
                const needsCurrencyConversion = invoice.currency !== 'PLN' && reportingAmount == null
                return (
                  <tr key={invoice.id} className="align-top">
                    <td className="px-4 py-3 text-right num text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{invoice.invoiceNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{isoDate(invoice.issueDate)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{invoice.supplierName}</p>
                      <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{invoice.supplierNip || 'brak NIP'}</p>
                      {invoice.bankAccount && (
                        <p className="mt-1 text-xs num" style={{ color: 'var(--wd-text-muted)' }}>
                          Konto: {formatBankAccount(invoice.bankAccount)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="num font-semibold">{money(invoice.grossAmount, invoice.currency)}</p>
                      {reportingAmount != null && (
                        <p className="num text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                          Raportowo {money(reportingAmount)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[invoice.status]}`}>
                        {STATUS_LABELS[invoice.status]}
                      </span>
                      <div className="mt-2 space-y-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${paymentStatus === 'PAID' ? 'border-green-100 bg-green-50 text-green-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
                          {paymentStatus === 'PAID' ? 'Zapłacona' : 'Do zapłaty'}
                        </span>
                        <p className="text-[11px]" style={{ color: 'var(--wd-text-muted)' }}>
                          Termin: {invoice.dueDate ? isoDate(invoice.dueDate) : 'brak'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <CostCenterChips
                        options={costCenters}
                        value={rowClassification.costCenterId}
                        disabled={approved}
                        onChange={(costCenterId) => setClassification((current) => ({ ...current, [invoice.id]: { ...rowClassification, costCenterId } }))}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {hasCostTags ? (
                        <div className="max-h-44 min-w-56 overflow-y-auto pr-1">
                          <TagChips
                            groups={costTagGroups}
                            value={rowClassification.tagIds}
                            disabled={approved}
                            size="sm"
                            onChange={(tagIds) =>
                              setClassification((current) => ({
                                ...current,
                                [invoice.id]: { ...rowClassification, tagIds },
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <div className="min-w-48 rounded border border-dashed border-[var(--wd-border)] bg-gray-50 px-2 py-2 text-xs font-medium" style={{ color: 'var(--wd-text-muted)' }}>
                          Brak tagów kosztowych
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" disabled={approved || saving === invoice.id} onClick={() => saveClassification(invoice.id)} className="rounded border border-[var(--wd-border)] p-2 hover:bg-gray-50 disabled:opacity-40" title="Zapisz klasyfikację">
                          <Save size={15} />
                        </button>
                        <button type="button" disabled={saving === `content-${invoice.id}`} onClick={() => loadInvoiceContent(invoice)} className="rounded border border-[var(--wd-border)] p-2 hover:bg-gray-50 disabled:opacity-40" title="Podgląd faktury">
                          <Eye size={15} />
                        </button>
                        <button type="button" disabled={approved} onClick={() => setPartsEditorInvoice(invoice)} className="rounded border border-[var(--wd-border)] p-2 hover:bg-gray-50 disabled:opacity-40" title="Rozbij fakturę">
                          <Settings2 size={15} />
                        </button>
                        {approved ? (
                          <button
                            type="button"
                            disabled={saving === `unapprove-${invoice.id}`}
                            onClick={() => unapproveInvoice(invoice.id)}
                            className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                            title="Cofnij z kosztów"
                          >
                            <RefreshCcw size={15} />
                          </button>
                        ) : (
                          <button type="button" disabled={saving === `approve-${invoice.id}`} onClick={() => approveInvoice(invoice.id)} className="rounded bg-green-700 p-2 text-white disabled:opacity-40" title="Zatwierdź do kosztów">
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={saving === `payment-${invoice.id}`}
                          onClick={() => updatePaymentStatus(invoice)}
                          className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs font-semibold disabled:opacity-40"
                        >
                          {paymentStatus === 'PAID' ? 'Cofnij płatność' : 'Zapłacona'}
                        </button>
                        {needsCurrencyConversion && (
                          <button
                            type="button"
                            disabled={approved}
                            onClick={() => setConversionForm({
                              invoiceId: invoice.id,
                              reportingGrossAmount: '',
                              reportingNetAmount: '',
                              reportingVatAmount: '',
                              currencyConversionNote: '',
                            })}
                            className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          >
                            Przelicz PLN
                          </button>
                        )}
                        <button type="button" disabled={approved || saving === `ignore-${invoice.id}`} onClick={() => ignoreInvoice(invoice.id)} className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs font-semibold disabled:opacity-40">
                          Ignoruj
                        </button>
                      </div>
                      {conversionForm?.invoiceId === invoice.id && (
                        <form onSubmit={convertCurrency} className="mt-2 grid min-w-[220px] gap-2 rounded border border-[var(--wd-border)] bg-gray-50 p-2">
                          <input
                            className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs"
                            inputMode="decimal"
                            placeholder="Brutto PLN"
                            value={conversionForm.reportingGrossAmount}
                            onChange={(event) => setConversionForm((current) => current ? { ...current, reportingGrossAmount: event.target.value } : current)}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs"
                              inputMode="decimal"
                              placeholder="Netto PLN"
                              value={conversionForm.reportingNetAmount}
                              onChange={(event) => setConversionForm((current) => current ? { ...current, reportingNetAmount: event.target.value } : current)}
                            />
                            <input
                              className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs"
                              inputMode="decimal"
                              placeholder="VAT PLN"
                              value={conversionForm.reportingVatAmount}
                              onChange={(event) => setConversionForm((current) => current ? { ...current, reportingVatAmount: event.target.value } : current)}
                            />
                          </div>
                          <input
                            className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs"
                            placeholder="Notatka kursowa"
                            value={conversionForm.currencyConversionNote}
                            onChange={(event) => setConversionForm((current) => current ? { ...current, currencyConversionNote: event.target.value } : current)}
                          />
                          <div className="flex gap-2">
                            <button type="submit" disabled={saving === `currency-${invoice.id}`} className="rounded bg-[var(--wd-dark)] px-2 py-1 text-xs font-semibold text-white disabled:opacity-40">
                              Zapisz PLN
                            </button>
                            <button type="button" onClick={() => setConversionForm(null)} className="rounded border border-[var(--wd-border)] px-2 py-1 text-xs font-semibold">
                              Anuluj
                            </button>
                          </div>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--wd-border)] px-4 py-3">
          <KsefPaymentSummary
            grossAmountTotal={grossAmountTotal}
            grossAmountLabel={hasActiveResultFilter ? 'Suma wyników' : 'Suma faktur'}
            unpaidAmountTotal={unpaidAmountTotal}
            paymentAging={paymentAging}
            formatMoney={(value) => money(value)}
          />
          {renderPaginationControls()}
        </div>
      </section>

      {contentPreview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-8 w-full max-w-5xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-[var(--wd-border)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>Podgląd faktury KSeF</p>
                <h2 className="text-lg font-semibold">{contentPreview.preview.invoiceNumber ?? contentPreview.invoice.invoiceNumber}</h2>
                <p className="text-xs num" style={{ color: 'var(--wd-text-muted)' }}>{contentPreview.ksefNumber}</p>
              </div>
              <button type="button" onClick={() => setContentPreview(null)} className="rounded border border-[var(--wd-border)] p-2 hover:bg-gray-50" title="Zamknij podgląd">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="data-label">Data wystawienia</p>
                    <p className="font-semibold">{contentPreview.preview.issueDate ?? '-'}</p>
                  </div>
                  <div>
                    <p className="data-label">Data sprzedaży</p>
                    <p className="font-semibold">{contentPreview.preview.saleDate ?? '-'}</p>
                  </div>
                  <div>
                    <p className="data-label">Netto</p>
                    <p className="num font-semibold">{contentPreview.preview.totals.net ?? '-'}</p>
                  </div>
                  <div>
                    <p className="data-label">VAT</p>
                    <p className="num font-semibold">{contentPreview.preview.totals.vat ?? '-'}</p>
                  </div>
                  <div>
                    <p className="data-label">Brutto</p>
                    <p className="num font-semibold">{contentPreview.preview.totals.gross ?? money(contentPreview.invoice.grossAmount, contentPreview.invoice.currency)}</p>
                  </div>
                  <div>
                    <p className="data-label">Format</p>
                    <p className="font-semibold">{contentPreview.preview.formCode ?? '-'}</p>
                  </div>
                  <div>
                    <p className="data-label">Termin płatności</p>
                    <p className="font-semibold">{contentPreview.preview.paymentDueDate ?? (contentPreview.invoice.dueDate ? isoDate(contentPreview.invoice.dueDate) : '-')}</p>
                  </div>
                  <div>
                    <p className="data-label">Rachunek</p>
                    <p className="num font-semibold">
                      {contentPreview.preview.bankAccounts[0]
                        ? formatBankAccount(contentPreview.preview.bankAccounts[0])
                        : contentPreview.invoice.bankAccount
                          ? formatBankAccount(contentPreview.invoice.bankAccount)
                          : '-'}
                    </p>
                  </div>
                </div>
                <div className="rounded border border-[var(--wd-border)] p-3 text-sm">
                  <p className="mb-1 font-semibold">Sprzedawca</p>
                  <p>{contentPreview.preview.seller.name ?? contentPreview.invoice.supplierName}</p>
                  <p className="text-xs num" style={{ color: 'var(--wd-text-muted)' }}>{contentPreview.preview.seller.nip ?? contentPreview.invoice.supplierNip ?? '-'}</p>
                </div>
                <div className="rounded border border-[var(--wd-border)] p-3 text-sm">
                  <p className="mb-1 font-semibold">Nabywca</p>
                  <p>{contentPreview.preview.buyer.name ?? '-'}</p>
                  <p className="text-xs num" style={{ color: 'var(--wd-text-muted)' }}>{contentPreview.preview.buyer.nip ?? '-'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="overflow-hidden rounded border border-[var(--wd-border)]">
                  <div className="border-b border-[var(--wd-border)] px-3 py-2 text-sm font-semibold">Pozycje</div>
                  <div className="max-h-72 overflow-auto">
                    {contentPreview.preview.lines.length === 0 ? (
                      <p className="p-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak pozycji do pokazania.</p>
                    ) : (
                      <table className="w-full min-w-[620px] text-left text-xs">
                        <thead className="bg-gray-50" style={{ color: 'var(--wd-text-muted)' }}>
                          <tr>
                            <th className="px-3 py-2">Lp.</th>
                            <th className="px-3 py-2">Nazwa</th>
                            <th className="px-3 py-2 text-right">Ilość</th>
                            <th className="px-3 py-2 text-right">Cena</th>
                            <th className="px-3 py-2 text-right">Netto</th>
                            <th className="px-3 py-2 text-right">VAT</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--wd-border)]">
                          {contentPreview.preview.lines.map((line, index) => (
                            <tr key={`${line.number ?? index}-${line.name ?? ''}`}>
                              <td className="px-3 py-2">{line.number ?? index + 1}</td>
                              <td className="px-3 py-2">{line.name ?? '-'}</td>
                              <td className="px-3 py-2 text-right num">{line.quantity ?? '-'} {line.unit ?? ''}</td>
                              <td className="px-3 py-2 text-right num">{line.unitPrice ?? '-'}</td>
                              <td className="px-3 py-2 text-right num">{line.netAmount ?? '-'}</td>
                              <td className="px-3 py-2 text-right num">{line.vatRate ?? '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <details className="rounded border border-[var(--wd-border)]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">XML</summary>
                  <pre className="max-h-72 overflow-auto border-t border-[var(--wd-border)] bg-gray-50 p-3 text-xs">{contentPreview.xml}</pre>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}

      {partsEditorInvoice && (
        <KsefInvoicePartsEditor
          invoice={partsEditorInvoice}
          costCenters={costCenters}
          tagGroups={costTagGroups}
          formatMoney={money}
          onClose={() => setPartsEditorInvoice(null)}
          onSaved={(invoice) => {
            if (invoice) replaceInvoice(invoice as KsefInvoiceRow)
            setPartsEditorInvoice(null)
            void refreshInvoices()
          }}
        />
      )}

      <section className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Reguły dostawców</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rules.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak reguł. Nowe faktury trzeba klasyfikować ręcznie.</p>
          ) : rules.map((rule) => (
            <div key={rule.id} className="rounded border border-[var(--wd-border)] p-3 text-sm">
              <p className="font-semibold">{rule.supplierNip || rule.supplierNamePattern}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                {rule.costCenter.name} → {(rule.tags ?? []).map((entry) => entry.tag?.name).filter(Boolean).join(', ') || (rule.subCategory ? `${rule.subCategory.category.name} / ${rule.subCategory.name}` : 'Brak tagów')}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
