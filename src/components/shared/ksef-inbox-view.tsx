'use client'

import { useRef, useState } from 'react'
import { ArrowUpDown, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, CloudDownload, Eye, FilePlus2, RefreshCcw, Save, Search, Settings2, X } from 'lucide-react'
import { parseKsefInvoiceXmlPreview, type KsefInvoiceXmlPreview } from '@/lib/finance/ksef-invoice-preview'
import { TagChips } from '@/components/shared/tag-chips'
import { KsefInvoicePartsEditor } from '@/components/shared/ksef-invoice-parts-editor'
import { InvoicePaymentMoneySummary } from '@/components/shared/invoice-payment-money-summary'
import { InvoiceImportWorkspace } from '@/components/invoice-import/invoice-import-workspace'
import type { InvoiceMoneySummary } from '@/lib/finance/invoice-money'
import { KsefSelectionBar } from '@/components/shared/ksef-selection-bar'
import { KsefInvoiceTags } from '@/components/shared/ksef-invoice-tags'
import { monthIssueDateRange } from '@/lib/finance/ksef-date-filter'
import { warsawToday, type BulkPaymentResult } from '@/lib/finance/ksef-selection'

export type KsefStatus = 'NEW' | 'MAPPED' | 'APPROVED' | 'IGNORED'
export type KsefPaymentStatus = 'UNPAID' | 'PAID' | 'PARTIAL' | 'UNKNOWN'
type KsefPaymentDeadline = 'OVERDUE' | 'DUE_0_7' | 'DUE_8_14' | 'DUE_15_30' | 'LATER' | 'MISSING_DUE_DATE'
type KsefPageSize = 50 | 100 | 200
type KsefSortBy = 'issueDate' | 'invoiceNumber' | 'supplierName' | 'grossAmount' | 'status' | 'paymentStatus' | 'dueDate' | 'costCenterId'
type KsefSortDir = 'asc' | 'desc'
type KsefInvoiceCounts = Record<KsefStatus, number>
type KsefPaymentAgingInput = Record<KsefPaymentDeadline, {
  count: number
  grossAmount: number
} & Partial<InvoiceMoneySummary>>
type KsefPaymentAging = Record<KsefPaymentDeadline, InvoiceMoneySummary & { count: number; grossAmount: number }>

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
  source?: string
  invoiceImportDraft?: {
    id: string
    state: string
    ksef?: { linkedCount: number; conflictCount: number }
  } | null
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
  grossAmountSummary?: InvoiceMoneySummary
  unpaidAmountTotal?: number
  unpaidAmountSummary?: InvoiceMoneySummary
  unpaidCount?: number
  uncertainPaymentCount?: number
  paymentAging?: KsefPaymentAgingInput
  page: number
  pageSize: KsefPageSize
  totalPages: number
  counts: KsefInvoiceCounts
}

interface KsefInvoiceFilters {
  search: string
  amountMin: string
  amountMax: string
  issueDateFrom: string
  issueDateTo: string
  paymentStatus: 'UNPAID' | 'PAID' | 'ALL'
  paymentDeadline: KsefPaymentDeadline | 'ALL'
}

interface KsefInboxViewProps {
  initialInvoices: KsefInvoiceRow[]
  initialTotal: number
  initialGrossAmountTotal: number
  initialGrossAmountSummary?: InvoiceMoneySummary
  initialUnpaidAmountTotal?: number
  initialUnpaidAmountSummary?: InvoiceMoneySummary
  initialUnpaidCount?: number
  initialUncertainPaymentCount?: number
  initialPaymentAging?: KsefPaymentAgingInput
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
  OVERDUE: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
  DUE_0_7: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
  DUE_8_14: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
  DUE_15_30: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
  LATER: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
  MISSING_DUE_DATE: { count: 0, grossAmount: 0, plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] },
}

function knownPlnSummary(plnAmount: number): InvoiceMoneySummary {
  return { plnAmount, unconvertedCount: 0, unconvertedByCurrency: [] }
}

function normalizePaymentAging(paymentAging?: KsefPaymentAgingInput): KsefPaymentAging {
  if (!paymentAging) return EMPTY_PAYMENT_AGING
  return Object.fromEntries(Object.entries(EMPTY_PAYMENT_AGING).map(([bucket, empty]) => {
    const summary = paymentAging[bucket as KsefPaymentDeadline]
    return [bucket, summary ? {
      ...summary,
      plnAmount: summary.plnAmount ?? summary.grossAmount ?? 0,
      unconvertedCount: summary.unconvertedCount ?? 0,
      unconvertedByCurrency: summary.unconvertedByCurrency ?? [],
    } : empty]
  })) as KsefPaymentAging
}

function deriveUnpaidCount(paymentAging?: KsefPaymentAgingInput) {
  if (!paymentAging) return null
  const buckets = Object.keys(EMPTY_PAYMENT_AGING) as KsefPaymentDeadline[]
  if (!buckets.every((bucket) => paymentAging[bucket] != null)) return null
  return buckets.reduce((sum, bucket) => sum + paymentAging[bucket].count, 0)
}
const EMPTY_INVOICE_FILTERS: KsefInvoiceFilters = {
  search: '',
  amountMin: '',
  amountMax: '',
  issueDateFrom: '',
  issueDateTo: '',
  paymentStatus: 'ALL',
  paymentDeadline: 'ALL',
}
const PAYMENT_STATUS_LABELS: Record<KsefInvoiceFilters['paymentStatus'], string> = {
  ALL: 'Wszystkie',
  UNPAID: 'Do zapłaty',
  PAID: 'Zapłacone',
}
const PAYMENT_ROW_LABELS: Record<KsefPaymentStatus, string> = {
  PAID: 'Zapłacona', UNPAID: 'Do zapłaty', PARTIAL: 'Częściowo zapłacona', UNKNOWN: 'Płatność nieustalona',
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

const DEFAULT_SORT_BY: KsefSortBy = 'issueDate'
const DEFAULT_SORT_DIR: KsefSortDir = 'desc'

function money(value: number, currency = 'PLN') {
  return `${Math.round(value * 100) / 100}`.replace('.', ',') + ` ${currency}`
}

function isoDate(value: string) {
  return value.slice(0, 10)
}

function formatBankAccount(value: string) {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

function defaultSortDirFor(sortBy: KsefSortBy): KsefSortDir {
  return sortBy === 'issueDate' || sortBy === 'grossAmount' || sortBy === 'dueDate' ? 'desc' : 'asc'
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

class LegacyInvoiceReviewError extends Error {
  constructor(readonly draftId: string, message: string) { super(message) }
}

type DuplicateInvoiceTarget = { invoiceId: string; draftId: string | null }
type ExistingInvoiceSummary = Pick<KsefInvoiceRow, 'id' | 'supplierName' | 'supplierNip' | 'invoiceNumber' | 'issueDate' | 'grossAmount' | 'currency' | 'status'>
const invoiceTargetId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value)

class LegacyInvoiceDuplicateError extends Error {
  constructor(readonly target: DuplicateInvoiceTarget) {
    super('Ta faktura jest już zapisana. Otwórz istniejący dokument.')
  }
}

async function readLegacyJson(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data.code === 'INVOICE_DUPLICATE' && invoiceTargetId(data.duplicate?.invoiceId)
      && (data.duplicate.draftId === null || invoiceTargetId(data.duplicate.draftId))) {
      throw new LegacyInvoiceDuplicateError(data.duplicate)
    }
    if (data.code === 'INVOICE_IMPORT_REVIEW_REQUIRED' && typeof data.draftId === 'string' && data.draftId.length <= 191) {
      throw new LegacyInvoiceReviewError(data.draftId, 'Otwórz dokument, aby zmienić dane importowanej faktury.')
    }
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
    issueDateFrom: filters.issueDateFrom,
    issueDateTo: filters.issueDateTo,
    paymentStatus: filters.paymentStatus,
    paymentDeadline: filters.paymentDeadline,
  }
}

export function KsefInboxView({
  initialInvoices,
  initialTotal,
  initialGrossAmountTotal,
  initialGrossAmountSummary,
  initialUnpaidAmountTotal = 0,
  initialUnpaidAmountSummary,
  initialUnpaidCount,
  initialUncertainPaymentCount = 0,
  initialPaymentAging,
  initialPage,
  initialPageSize,
  initialTotalPages,
  initialCounts,
  initialRules,
  costCenters,
  costTagGroups = [],
}: KsefInboxViewProps) {
  const [invoices, setInvoices] = useState(initialInvoices)
  const [rules, setRules] = useState(initialRules)
  const [tagGroups, setTagGroups] = useState(costTagGroups)
  const [importWorkspace, setImportWorkspace] = useState<{ draftId?: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<KsefStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState<KsefPageSize>(initialPageSize)
  const [total, setTotal] = useState(initialTotal)
  const [grossAmountSummary, setGrossAmountSummary] = useState(initialGrossAmountSummary ?? knownPlnSummary(initialGrossAmountTotal))
  const [unpaidAmountSummary, setUnpaidAmountSummary] = useState(initialUnpaidAmountSummary ?? knownPlnSummary(initialUnpaidAmountTotal))
  const [unpaidCount, setUnpaidCount] = useState<number | null>(initialUnpaidCount ?? deriveUnpaidCount(initialPaymentAging))
  const [uncertainPaymentCount, setUncertainPaymentCount] = useState(initialUncertainPaymentCount)
  const [paymentAging, setPaymentAging] = useState(normalizePaymentAging(initialPaymentAging))
  const [totalPages, setTotalPages] = useState(initialTotalPages)
  const [counts, setCounts] = useState<KsefInvoiceCounts>(initialCounts)
  const [filterForm, setFilterForm] = useState<KsefInvoiceFilters>(EMPTY_INVOICE_FILTERS)
  const [activeFilters, setActiveFilters] = useState<KsefInvoiceFilters>(EMPTY_INVOICE_FILTERS)
  const [issueMonth, setIssueMonth] = useState('')
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<KsefSortBy>(DEFAULT_SORT_BY)
  const [sortDir, setSortDir] = useState<KsefSortDir>(DEFAULT_SORT_DIR)
  const [saving, setSaving] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPaidDate, setBulkPaidDate] = useState(warsawToday)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const bulkInFlight = useRef(false)
  const selectableInvoices = invoices.filter((invoice) => !invoice.invoiceImportDraft)
  const selectedInvoices = selectableInvoices.filter((invoice) => selectedIds.has(invoice.id))
  const bulkBusy = saving === 'bulk-payment'
  const [error, setError] = useState<string | null>(null)
  const [duplicateInvoice, setDuplicateInvoice] = useState<DuplicateInvoiceTarget | null>(null)
  const [existingInvoice, setExistingInvoice] = useState<ExistingInvoiceSummary | null>(null)
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
    || Boolean(activeFilters.search || activeFilters.amountMin || activeFilters.amountMax || activeFilters.issueDateFrom || activeFilters.issueDateTo)
  const hasCostTags = tagGroups.some((group) => group.tags.length > 0)

  async function readJson(response: Response) {
    setDuplicateInvoice(null)
    try { return await readLegacyJson(response) }
    catch (failure) {
      if (failure instanceof LegacyInvoiceReviewError) setImportWorkspace({ draftId: failure.draftId })
      if (failure instanceof LegacyInvoiceDuplicateError) setDuplicateInvoice(failure.target)
      throw failure
    }
  }

  async function openDuplicateInvoice() {
    if (!duplicateInvoice || saving !== null) return
    if (duplicateInvoice.draftId) {
      setError(null)
      setImportWorkspace({ draftId: duplicateInvoice.draftId })
      return
    }
    setSaving('existing-invoice')
    try {
      const response = await readLegacyJson(await fetch(`/api/finance/ksef/invoices/${duplicateInvoice.invoiceId}`, { cache: 'no-store' }))
      const invoice = response.invoice
      if (!invoice || invoice.id !== duplicateInvoice.invoiceId || typeof invoice.invoiceNumber !== 'string'
        || typeof invoice.supplierName !== 'string' || typeof invoice.issueDate !== 'string'
        || !Number.isFinite(new Date(invoice.issueDate).getTime())
        || typeof invoice.grossAmount !== 'number' || !Number.isFinite(invoice.grossAmount)
        || typeof invoice.currency !== 'string' || !/^[A-Z]{3}$/.test(invoice.currency)
        || !Object.hasOwn(STATUS_LABELS, invoice.status)) {
        throw new Error('Nie udało się odczytać istniejącej faktury. Spróbuj ponownie.')
      }
      setExistingInvoice(invoice)
      setError(null)
      setDuplicateInvoice(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Nie udało się pobrać dokumentu.')
    } finally {
      setSaving(null)
    }
  }

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
    setSelectedIds(new Set())
    setEditingTagsId(null)
    setInvoices(response.invoices)
    setPage(response.page)
    setPageSize(response.pageSize)
    setTotal(response.total)
    setGrossAmountSummary(response.grossAmountSummary ?? knownPlnSummary(response.grossAmountTotal ?? 0))
    setUnpaidAmountSummary(response.unpaidAmountSummary ?? knownPlnSummary(response.unpaidAmountTotal ?? 0))
    setUnpaidCount(response.unpaidCount ?? deriveUnpaidCount(response.paymentAging))
    setUncertainPaymentCount(response.uncertainPaymentCount ?? 0)
    setPaymentAging(normalizePaymentAging(response.paymentAging))
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
    sortBy?: KsefSortBy
    sortDir?: KsefSortDir
  } = {}) {
    const targetPage = options.page ?? page
    const targetPageSize = options.pageSize ?? pageSize
    const targetStatus = options.statusFilter ?? statusFilter
    const targetFilters = normalizeInvoiceFilters(options.filters ?? activeFilters)
    const targetSortBy = options.sortBy ?? sortBy
    const targetSortDir = options.sortDir ?? sortDir
    const params = new URLSearchParams({
      page: String(targetPage),
      pageSize: String(targetPageSize),
      sortBy: targetSortBy,
      sortDir: targetSortDir,
    })
    if (targetStatus !== 'ALL') params.set('status', targetStatus)
    if (targetFilters.search) params.set('search', targetFilters.search)
    if (targetFilters.amountMin) params.set('amountMin', targetFilters.amountMin)
    if (targetFilters.amountMax) params.set('amountMax', targetFilters.amountMax)
    if (targetFilters.issueDateFrom) params.set('issueDateFrom', targetFilters.issueDateFrom)
    if (targetFilters.issueDateTo) params.set('issueDateTo', targetFilters.issueDateTo)
    if (targetFilters.paymentStatus !== 'ALL') params.set('paymentStatus', targetFilters.paymentStatus)
    if (targetFilters.paymentDeadline !== 'ALL') params.set('paymentDeadline', targetFilters.paymentDeadline)

    setListLoading(true)
    try {
      const response = await readJson(await fetch(`/api/finance/ksef/invoices?${params.toString()}`)) as KsefInvoiceListResponse
      if (response.invoices.length === 0 && response.total > 0 && targetPage > response.totalPages) {
        return await refreshInvoices({
          page: response.totalPages,
          pageSize: targetPageSize,
          statusFilter: targetStatus,
          filters: targetFilters,
          sortBy: targetSortBy,
          sortDir: targetSortDir,
        })
      }
      return applyInvoicePage(response)
    } finally {
      setListLoading(false)
    }
  }

  async function createCostTag(group: CostTagGroupOption, name: string) {
    const data = await readJson(await fetch('/api/finance/cost-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupSlug: group.slug, name }),
    })) as { tag: { id: string; name: string; slug: string } }

    setTagGroups((current) => current.map((item) => (
      item.slug === group.slug
        ? {
            ...item,
            tags: [...item.tags, data.tag].sort((a, b) => a.name.localeCompare(b.name, 'pl')),
          }
        : item
    )))

    return data.tag
  }

  async function applyInvoiceFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSyncMessage(null)
    const nextFilters = normalizeInvoiceFilters(filterForm)
    if (nextFilters.issueDateFrom && nextFilters.issueDateTo && nextFilters.issueDateFrom > nextFilters.issueDateTo) {
      setError('Data od nie może być późniejsza niż data do.')
      return
    }
    setSaving('filters')
    try {
      await refreshInvoices({ page: 1, filters: nextFilters })
      setActiveFilters(nextFilters)
      setFilterForm(nextFilters)
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
      await refreshInvoices({ page: 1, filters: EMPTY_INVOICE_FILTERS })
      setIssueMonth('')
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
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
      setIssueMonth('')
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

  async function changeSort(nextSortBy: KsefSortBy) {
    const nextSortDir = sortBy === nextSortBy
      ? (sortDir === 'asc' ? 'desc' : 'asc')
      : defaultSortDirFor(nextSortBy)

    setError(null)
    setSyncMessage(null)
    try {
      setSortBy(nextSortBy)
      setSortDir(nextSortDir)
      setPage(1)
      await refreshInvoices({ page: 1, sortBy: nextSortBy, sortDir: nextSortDir })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się posortować faktur')
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
      setIssueMonth('')
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

  async function paySelectedInvoices() {
    if (bulkInFlight.current || saving || selectedInvoices.length === 0) return
    bulkInFlight.current = true
    setSaving('bulk-payment')
    setError(null)
    setBulkResult(null)
    const submittedInvoices = [...selectedInvoices]
    try {
      const result = await readJson(await fetch('/api/finance/ksef/invoices/bulk-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: submittedInvoices.map((invoice) => invoice.id), paidDate: bulkPaidDate }),
      })) as { results: BulkPaymentResult[]; paidAt: string }
      const paid = result.results.filter((item) => item.outcome === 'paid')
      const skipped = result.results.filter((item) => item.outcome === 'already_paid')
      const failed = result.results.filter((item) => item.outcome === 'failed')
      const completedIds = new Set([...paid, ...skipped].map((item) => item.id))
      setInvoices((current) => current.map((invoice) => completedIds.has(invoice.id)
        ? { ...invoice, paymentStatus: 'PAID', paidAt: invoice.paidAt ?? result.paidAt }
        : invoice))
      setSelectedIds(new Set(failed.map((item) => item.id)))
      const failures = failed.map((item) => `${submittedInvoices.find((invoice) => invoice.id === item.id)?.invoiceNumber ?? item.id}: ${item.error}`).join(' ')
      setBulkResult(`Oznaczono jako zapłacone: ${paid.length}. Już zapłacone: ${skipped.length}. Błędy: ${failed.length}.${failures ? ` ${failures}` : ''}`)
      try {
        const refreshed = await refreshInvoices()
        setSelectedIds(new Set(failed.filter((item) => refreshed.some((invoice) => invoice.id === item.id)).map((item) => item.id)))
      } catch {
        setError('Płatności zapisano, ale nie udało się odświeżyć podsumowania. Odśwież stronę.')
      }
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Nie udało się potwierdzić wyniku operacji'}. Możesz ponowić zapis — już zapłacone faktury zostaną pominięte.`)
    } finally {
      bulkInFlight.current = false
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
      setIssueMonth('')
      setFilterForm(EMPTY_INVOICE_FILTERS)
      setActiveFilters(EMPTY_INVOICE_FILTERS)
      await refreshInvoices({ page: 1, statusFilter: 'ALL', filters: EMPTY_INVOICE_FILTERS })
      setSyncMessage(
        `KSeF: pobrano ${result.fetched}, dodano ${result.imported}, zaktualizowano ${result.updated}, powiązano z importem ${result.linked ?? 0}, wymaga rozstrzygnięcia ${result.conflicts ?? 0}, zmapowano regułami ${result.mappedByRules ?? 0}. XML faktur: pobrano ${result.xmlDetailsFetched ?? 0}, błędy ${result.xmlDetailsFailed ?? 0}.`
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
      let totalCachedXml = 0
      let totalScanned = 0
      let totalFailed = 0
      let rateLimited = false

      // Walk the whole backlog of KSeF invoices without local XML in throttled,
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
        totalCachedXml += result.cachedXml ?? 0
        totalScanned += result.scanned ?? 0
        totalFailed += result.failed ?? 0
        rateLimited ||= Boolean(result.rateLimited)
        setSyncMessage(
          `Uzupełnianie cache XML… sprawdzono ${totalScanned}, XML ${totalCachedXml}, terminy ${totalUpdated}, opłacone ${totalPaid}${totalFailed ? `, błędy ${totalFailed}` : ''}.`
        )
        if (result.done || result.rateLimited || !result.nextBefore) break
        before = result.nextBefore
      }

      await refreshInvoices({ page: 1 })
      setSyncMessage(
        `${rateLimited ? 'KSeF zatrzymał pobieranie po limicie 64 XML/h. ' : 'Gotowe. '}Zapisano XML w cache dla ${totalCachedXml} faktur, uzupełniono terminy dla ${totalUpdated}, ${totalPaid} bez terminu oznaczono jako opłacone (sprawdzono ${totalScanned}${totalFailed ? `, nie udało się ${totalFailed}` : ''}).`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się uzupełnić cache XML faktur')
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

  function renderSortableHeader(label: string, key: KsefSortBy, align: 'left' | 'right' = 'left') {
    const active = sortBy === key
    const nextDirection = active && sortDir === 'asc' ? 'malejąco' : 'rosnąco'

    return (
      <button
        type="button"
        onClick={() => changeSort(key)}
        aria-label={`Sortuj ${label} ${nextDirection}`}
        className={`inline-flex w-full items-center gap-1 rounded-sm text-xs font-semibold uppercase tracking-wide transition-colors hover:text-[var(--wd-dark)] ${
          align === 'right' ? 'justify-end text-right' : 'justify-start text-left'
        }`}
      >
        <span>{label}</span>
        <ArrowUpDown size={13} className={active ? 'opacity-100' : 'opacity-40'} />
        {active && (
          <span aria-hidden="true" className="text-[10px] leading-none">
            {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    )
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

  if (importWorkspace) return (
    <InvoiceImportWorkspace initialDraftId={importWorkspace.draftId} costCenters={costCenters} tagGroups={tagGroups}
      rules={rules.map((rule) => ({ ...rule, tagIds: rule.tags?.flatMap((entry) => entry.tagId ? [entry.tagId] : entry.tag ? [entry.tag.id] : []) ?? [] }))}
      onClose={() => { setImportWorkspace(null); setError(null) }} onInvoicesChanged={async () => { await refreshInvoices() }} />
  )

  return (
    <fieldset disabled={saving !== null || listLoading} aria-busy={saving !== null || listLoading} className="m-0 min-w-0 space-y-6 border-0 p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="data-label mb-1">Kondycja firmy</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>KSeF Inbox</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--wd-text-muted)' }}>
            Faktury z KSeF oraz dokumenty dodane z pliku. Sprawdzenie danych, klasyfikacja i zatwierdzanie kosztów.
          </p>
        </div>
        <div className="space-y-3">
          <button type="button" onClick={() => setImportWorkspace({})} className="inline-flex w-full items-center justify-center gap-2 rounded bg-[var(--wd-dark)] px-4 py-3 text-sm font-semibold text-white">
            <FilePlus2 size={18} aria-hidden="true" />Dodaj faktury
          </button>
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
            title="Pobiera i zapisuje lokalnie XML faktur z KSeF. Uzupełnia termin i konto bankowe, a podgląd faktury działa później z cache bez kolejnego zapytania do KSeF."
          >
            <CalendarClock size={16} />
            {saving === 'backfill' ? 'Uzupełniam cache XML...' : 'Uzupełnij cache XML'}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <p>{error}</p>
          {duplicateInvoice && <button type="button" onClick={openDuplicateInvoice} disabled={saving !== null}
            className="mt-3 rounded border border-current px-3 py-2 font-semibold hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
            {saving === 'existing-invoice' ? 'Otwieram dokument…' : 'Otwórz istniejący dokument'}
          </button>}
        </div>
      )}

      {existingInvoice && <section aria-label="Istniejąca faktura" className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="data-label">Istniejąca faktura · bez nowego zapisu</p>
            <h2 className="mt-1 text-lg font-semibold">{existingInvoice.invoiceNumber}</h2>
          </div>
          <button type="button" aria-label="Zamknij podgląd istniejącej faktury" onClick={() => setExistingInvoice(null)}
            className="rounded p-2 hover:bg-[var(--wd-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2"><X size={18} aria-hidden="true" /></button>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[var(--wd-text-muted)]">Dostawca</dt><dd className="mt-1 font-semibold">{existingInvoice.supplierName}</dd></div>
          <div><dt className="text-[var(--wd-text-muted)]">Numer podatkowy</dt><dd className="mt-1">{existingInvoice.supplierNip || 'Nie podano'}</dd></div>
          <div><dt className="text-[var(--wd-text-muted)]">Data wystawienia</dt><dd className="mt-1">{isoDate(existingInvoice.issueDate)}</dd></div>
          <div><dt className="text-[var(--wd-text-muted)]">Kwota oryginalna brutto</dt><dd className="num mt-1 font-semibold">{existingInvoice.grossAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {existingInvoice.currency}</dd></div>
        </dl>
        <p className="mt-4 text-sm font-medium">{STATUS_LABELS[existingInvoice.status]}</p>
      </section>}

      {syncMessage && (
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {syncMessage}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={addInvoice} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <FilePlus2 size={18} className="text-green-700" />
            <h2 className="text-base font-semibold">Dodaj fakturę ręcznie bez pliku</h2>
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
                  groups={tagGroups}
                  value={ruleForm.tagIds}
                  size="sm"
                  onCreateTag={createCostTag}
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

      <section className="rounded-lg border border-[var(--wd-border)] bg-white">
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
          <div className="mb-3 grid items-end gap-3 border-b border-[var(--wd-border)] pb-3 sm:grid-cols-3 xl:grid-cols-[180px_180px_180px_1fr]">
            <label className="block text-xs font-semibold text-[var(--wd-text-muted)]">
              Miesiąc wystawienia
              <input type="month" value={issueMonth} onChange={(event) => {
                const month = event.target.value
                setIssueMonth(month)
                const range = monthIssueDateRange(month)
                setFilterForm((current) => ({ ...current, issueDateFrom: range?.issueDateFrom ?? '', issueDateTo: range?.issueDateTo ?? '' }))
              }} className="mt-1 w-full min-w-0 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]" />
            </label>
            <label className="block text-xs font-semibold text-[var(--wd-text-muted)]">
              Data wystawienia od
              <input type="date" value={filterForm.issueDateFrom} onChange={(event) => {
                setIssueMonth('')
                setFilterForm((current) => ({ ...current, issueDateFrom: event.target.value }))
              }} className="mt-1 w-full min-w-0 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]" />
            </label>
            <label className="block text-xs font-semibold text-[var(--wd-text-muted)]">
              Data wystawienia do
              <input type="date" value={filterForm.issueDateTo} onChange={(event) => {
                setIssueMonth('')
                setFilterForm((current) => ({ ...current, issueDateTo: event.target.value }))
              }} className="mt-1 w-full min-w-0 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]" />
            </label>
            <p className="pb-2 text-xs text-[var(--wd-text-muted)]">Wybierz miesiąc lub wpisz własny zakres, a następnie kliknij „Filtruj”.</p>
          </div>
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
                onChange={(event) => setFilterForm((current) => ({ ...current, paymentStatus: event.target.value as KsefInvoiceFilters['paymentStatus'] }))}
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
        {(activeFilters.issueDateFrom || activeFilters.issueDateTo) && (
          <p className="border-b border-[var(--wd-border)] px-4 py-2 text-xs text-[var(--wd-text-muted)]">Okres wystawienia: <strong className="num text-[var(--wd-dark)]">{activeFilters.issueDateFrom || 'bez początku'} — {activeFilters.issueDateTo || 'bez końca'}</strong></p>
        )}
        <KsefSelectionBar invoices={selectedInvoices} paidDate={bulkPaidDate} busy={bulkBusy} disabled={saving !== null} onDateChange={setBulkPaidDate} onClear={() => setSelectedIds(new Set())} onPay={() => void paySelectedInvoices()} />
        {bulkResult && <p role="status" className="border-b border-[var(--wd-border)] px-4 py-3 text-sm">{bulkResult}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
              <tr>
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" aria-label="Zaznacz wszystkie faktury na stronie" disabled={saving !== null || selectableInvoices.length === 0} checked={selectableInvoices.length > 0 && selectedInvoices.length === selectableInvoices.length} ref={(element) => { if (element) element.indeterminate = selectedInvoices.length > 0 && selectedInvoices.length < selectableInvoices.length }} onChange={(event) => setSelectedIds(event.target.checked ? new Set(selectableInvoices.map((invoice) => invoice.id)) : new Set())} className="h-4 w-4 cursor-pointer accent-[var(--wd-dark)]" />
                </th>
                <th className="px-4 py-3 text-right">Lp.</th>
                <th className="px-4 py-3">{renderSortableHeader('Faktura', 'issueDate')}</th>
                <th className="px-4 py-3">{renderSortableHeader('Dostawca', 'supplierName')}</th>
                <th className="px-4 py-3 text-right">{renderSortableHeader('Kwota', 'grossAmount', 'right')}</th>
                <th className="px-4 py-3">{renderSortableHeader('Status', 'status')}</th>
                <th className="px-4 py-3">{renderSortableHeader('Centrum', 'costCenterId')}</th>
                <th className="px-4 py-3">Tagi</th>
                <th className="px-4 py-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--wd-border)]">
              {invoices.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm" colSpan={9} style={{ color: 'var(--wd-text-muted)' }}>
                    Brak faktur dla wybranego filtra.
                  </td>
                </tr>
              ) : invoices.map((invoice, index) => {
                const rowClassification = classification[invoice.id] ?? {
                  costCenterId: invoiceAllocationCostCenterId(invoice) ?? costCenters[0]?.id ?? 'GLOBAL',
                  tagIds: invoiceTagIds(invoice),
                }
                const approved = invoice.status === 'APPROVED'
                const imported = invoice.invoiceImportDraft
                const paymentStatus = invoice.paymentStatus ?? (imported ? 'UNKNOWN' : 'UNPAID')
                const reportingAmount = invoice.reportingGrossAmount ?? null
                const needsCurrencyConversion = invoice.currency !== 'PLN' && reportingAmount == null
                return (
                  <tr key={invoice.id} className={`align-top ${selectedIds.has(invoice.id) ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-3 py-4">
                      <input type="checkbox" aria-label={`Zaznacz fakturę ${invoice.invoiceNumber}`} checked={!imported && selectedIds.has(invoice.id)} disabled={Boolean(imported) || saving !== null} onChange={(event) => {
                        if (imported) return
                        const checked = event.target.checked
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          if (checked) next.add(invoice.id)
                          else next.delete(invoice.id)
                          return next
                        })
                      }} className="h-4 w-4 cursor-pointer accent-[var(--wd-dark)]" />
                    </td>
                    <td className="px-4 py-3 text-right num text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{invoice.invoiceNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{isoDate(invoice.issueDate)}</p>
                      {imported && (
                        <div className="mt-1 flex flex-col items-start gap-1">
                          <p className="text-xs text-[var(--wd-text-muted)]">Dodana z pliku</p>
                          {(imported.ksef?.linkedCount ?? 0) > 0 && (
                            <span className="inline-flex rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                              KSeF · powiązana
                            </span>
                          )}
                          {(imported.ksef?.conflictCount ?? 0) > 0 && (
                            <span className="inline-flex rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              KSeF · wymaga rozstrzygnięcia
                            </span>
                          )}
                        </div>
                      )}
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
                        {imported && imported.state !== 'APPROVED' ? (imported.state === 'ARCHIVED' ? 'Poza kosztami · archiwum' : 'Poza kosztami · szkic') : STATUS_LABELS[invoice.status]}
                      </span>
                      <div className="mt-2 space-y-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${paymentStatus === 'PAID' ? 'border-green-100 bg-green-50 text-green-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
                          {PAYMENT_ROW_LABELS[paymentStatus] ?? 'Płatność nieustalona'}
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
                        disabled={approved || Boolean(imported)}
                        onChange={(costCenterId) => setClassification((current) => ({ ...current, [invoice.id]: { ...rowClassification, costCenterId } }))}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <KsefInvoiceTags groups={tagGroups} value={rowClassification.tagIds} savedValue={invoiceTagIds(invoice)}
                        invoiceTags={invoice.parts?.flatMap((part) => part.tags.flatMap((entry) => entry.tag ? [entry.tag] : [])) ?? []}
                        disabled={approved || Boolean(imported)} editing={!imported && editingTagsId === invoice.id}
                        onToggle={() => setEditingTagsId((current) => current === invoice.id ? null : invoice.id)}
                        onCreateTag={createCostTag}
                        onChange={(tagIds) => setClassification((current) => ({ ...current, [invoice.id]: { ...rowClassification, tagIds } }))} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {imported ? <button type="button" onClick={() => setImportWorkspace({ draftId: imported.id })} className="inline-flex items-center gap-2 rounded border border-[var(--wd-border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--wd-surface-2)]"><Eye size={15} aria-hidden="true" />Otwórz dokument</button> : <>
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
                        </>}
                      </div>
                      {!imported && conversionForm?.invoiceId === invoice.id && (
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
          <InvoicePaymentMoneySummary
            gross={grossAmountSummary}
            grossLabel={hasActiveResultFilter ? 'Suma wyników' : 'Suma faktur'}
            unpaid={unpaidAmountSummary}
            unpaidCount={unpaidCount}
            uncertainPaymentCount={uncertainPaymentCount}
            paymentAging={paymentAging}
            formatMoney={money}
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
          tagGroups={tagGroups}
          formatMoney={money}
          onCreateTag={createCostTag}
          onClose={() => setPartsEditorInvoice(null)}
          onReviewRequired={(draftId) => {
            setPartsEditorInvoice(null)
            setImportWorkspace({ draftId })
          }}
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
    </fieldset>
  )
}
