'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  History,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InvoiceOriginalPreview } from '@/components/invoice-import/invoice-original-preview'
import { InvoiceReviewEditor } from '@/components/invoice-import/invoice-review-editor'
import { InvoiceKsefReconciliationPanel } from './invoice-ksef-reconciliation-panel'
import { useInvoiceKsefReconciliation } from './use-invoice-ksef-reconciliation'
import type { TagChipsGroup } from '@/components/shared/tag-chips'
import type { InvoiceDraftMutationResult } from '@/lib/invoice-import/approval-service'
import type { InvoiceClassificationRule } from '@/lib/invoice-import/classification-hint'
import {
  createInvoiceImportClient,
  InvoiceImportApiError,
} from '@/lib/invoice-import/client'
import type {
  InvoiceClosedPeriod,
  InvoiceDraftAction,
  InvoiceDraftDetail,
  InvoiceDraftSummary,
  InvoiceHistoryEntry,
  InvoiceReviewIssue,
  InvoiceKsefResolutionInput,
} from '@/lib/invoice-import/client-contracts'
import {
  INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES,
  INVOICE_ATTACHMENT_MAX_BYTES,
  INVOICE_IMPORT_MAX_FILES,
  type InvoiceDraftData,
} from '@/lib/invoice-import/contracts'

export interface InvoiceImportWorkspaceProps {
  initialDraftId?: string
  costCenters: { id: string; name: string }[]
  tagGroups: TagChipsGroup[]
  rules: InvoiceClassificationRule[]
  onClose(): void
  onInvoicesChanged(): Promise<void>
}

type FilterState = 'ALL' | 'OPEN' | 'APPROVED' | 'ARCHIVED'
type MobilePane = 'DOCUMENT' | 'DATA'
type UploadState = 'WAITING' | 'UPLOADING' | 'SAVED' | 'DUPLICATE' | 'ERROR'

interface UploadEntry {
  id: string
  file: File
  batchId: string | null
  state: UploadState
  message?: string
  retryable: boolean
}

interface DiscardTarget {
  kind: 'CLOSE' | 'SELECT'
  draftId?: string
}

type ConfirmedMutation = InvoiceDraftMutationResult | { outcome: 'READBACK'; draft: InvoiceDraftDetail }

interface ClosedPeriodRequest {
  kind: 'APPROVE' | 'REVOKE'
  draftId: string
  version: number
  key: string
  periods: InvoiceClosedPeriod[]
  resolve(result: ConfirmedMutation | null): void
  reject(error: unknown): void
}

interface PendingApproval {
  draftId: string
  expectedVersion: number
  patchKey: string
  approvalVersion: number
  key: string
}

const POLL_MS = 2_000
const LIST_LIMIT = 100
const ALLOWED_TYPES = new Set<string>(INVOICE_ATTACHMENT_ALLOWED_MIME_TYPES)

const uploadLabels: Record<UploadState, string> = {
  WAITING: 'Oczekuje',
  UPLOADING: 'Wysyłanie',
  SAVED: 'Zapisany',
  DUPLICATE: 'Duplikat — już zapisany',
  ERROR: 'Błąd',
}

const historyLabels: Record<string, string> = {
  CREATED: 'Dodano dokument',
  EDITED: 'Zapisano poprawki',
  EXTRACTION_REQUESTED: 'Zlecono odczyt',
  AI_RESULT_APPLIED: 'Zastosowano wynik odczytu',
  AI_RESULT_STALE_SKIPPED: 'Pominięto nieaktualny wynik odczytu',
  SKIPPED: 'Pominięto na teraz',
  ARCHIVED: 'Przeniesiono do archiwum',
  RESTORED: 'Przywrócono szkic',
  APPROVED: 'Zatwierdzono w kosztach',
  APPROVAL_DUPLICATE: 'Wykryto wcześniej zatwierdzoną fakturę',
  REVOKED: 'Cofnięto z kosztów',
  KSEF_OBSERVED: 'Powiązano lub zaktualizowano dane z KSeF',
  KSEF_KEPT_LOCAL: 'Zachowano dane administratora zamiast danych KSeF',
  KSEF_APPLIED_TO_DRAFT: 'Przyjęto dane KSeF do szkicu',
}

const monthNames = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
]

function draftStatus(draft: InvoiceDraftSummary): { label: string; tone: string } {
  if (draft.state === 'APPROVED') return { label: 'Zatwierdzona', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
  if (draft.state === 'ARCHIVED') return { label: 'Archiwum', tone: 'bg-stone-100 text-stone-700 border-stone-200' }
  if (draft.skippedAt) return { label: 'Pominięta', tone: 'bg-stone-100 text-stone-700 border-stone-200' }
  if (draft.latestJob?.status === 'QUEUED') return { label: 'W kolejce', tone: 'bg-amber-50 text-amber-900 border-amber-200' }
  if (draft.latestJob?.status === 'RUNNING') return { label: 'Odczytywanie', tone: 'bg-amber-50 text-amber-900 border-amber-200' }
  if (draft.latestJob && ['FAILED', 'BLOCKED', 'CANCELLED'].includes(draft.latestJob.status)) {
    return { label: 'Wymaga ręcznego uzupełnienia', tone: 'bg-red-50 text-red-800 border-red-200' }
  }
  return { label: 'Do sprawdzenia', tone: 'bg-sky-50 text-sky-900 border-sky-200' }
}

function formatAmount(value: number | null, currency: string | null): string {
  if (value === null) return 'Kwota nieodczytana'
  const normalizedCurrency = currency?.trim().toUpperCase()
  if (!normalizedCurrency) {
    const amount = value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${amount} · waluta nieodczytana`
  }
  try {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(value)
  } catch {
    return `${value.toLocaleString('pl-PL')} ${normalizedCurrency}`
  }
}

function jobFailureMessage(draft: InvoiceDraftDetail): string | null {
  const job = draft.latestJob
  if (!job || !['FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status)) return null
  const code = job.blockedReason ?? job.errorCode
  if (code === 'QUOTA') return 'Limit usługi odczytu został wyczerpany. Dane możesz uzupełnić i zatwierdzić ręcznie.'
  if (code === 'AUTH') return 'Usługa odczytu nie ma poprawnego dostępu. Dane możesz uzupełnić i zatwierdzić ręcznie.'
  if (code === 'MODEL_UNAVAILABLE') return 'Usługa odczytu jest teraz niedostępna. Dane możesz uzupełnić i zatwierdzić ręcznie.'
  return 'Automatyczny odczyt nie zakończył się poprawnie. Sprawdź dokument i uzupełnij dane ręcznie.'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function patchKey(patch: InvoiceDraftData): string {
  return JSON.stringify(Object.keys(patch).sort().map((key) => [key, patch[key as keyof InvoiceDraftData]]))
}

function createActionKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `invoice-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function InvoiceImportWorkspace({
  initialDraftId,
  costCenters,
  tagGroups,
  rules,
  onClose,
  onInvoicesChanged,
}: InvoiceImportWorkspaceProps) {
  const client = useMemo(() => createInvoiceImportClient(), [])
  const [filter, setFilter] = useState<FilterState>('ALL')
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialDraftId ?? null)
  const [detail, setDetail] = useState<InvoiceDraftDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDraftId))
  const [detailError, setDetailError] = useState<string | null>(null)
  const [issues, setIssues] = useState<InvoiceReviewIssue[]>([])
  const [operationNotice, setOperationNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mobilePane, setMobilePane] = useState<MobilePane>('DOCUMENT')
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null)
  const [closedPeriodRequest, setClosedPeriodRequest] = useState<ClosedPeriodRequest | null>(null)
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<InvoiceHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const ksef = useInvoiceKsefReconciliation(detail?.id === selectedId ? detail : null, client)

  const selectedIdRef = useRef(selectedId)
  const mutationRef = useRef(false)
  const mutationEpochRef = useRef(0)
  const listSequenceRef = useRef(0)
  const detailSequenceRef = useRef(0)
  const listRequestsRef = useRef(0)
  const detailRequestsRef = useRef(0)
  const detailControllerRef = useRef<AbortController | null>(null)
  const historySequenceRef = useRef(0)
  const historyRequestRef = useRef<{ draftId: string; controller: AbortController } | null>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const closedPeriodRequestRef = useRef<ClosedPeriodRequest | null>(null)
  const mountedRef = useRef(true)
  const uploadCounterRef = useRef(0)
  const actionKeysRef = useRef(new Map<string, string>())
  const pendingApprovalRef = useRef<PendingApproval | null>(null)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const loadList = useCallback(async (background = false, requestedFilter: FilterState = filter, skipIfPending = false) => {
    if (skipIfPending && listRequestsRef.current > 0) return null
    listRequestsRef.current += 1
    const sequence = ++listSequenceRef.current
    const epoch = mutationEpochRef.current
    if (!background) setListLoading(true)
    setListError(null)
    try {
      const next = await client.list({
        ...(requestedFilter === 'ALL' ? {} : { state: requestedFilter }),
        limit: LIST_LIMIT,
      })
      if (sequence !== listSequenceRef.current || epoch !== mutationEpochRef.current) return next
      setDrafts(next)
      setListError(null)
      if (!selectedIdRef.current && next[0]) {
        selectedIdRef.current = next[0].id
        setSelectedId(next[0].id)
      }
      return next
    } catch (error) {
      if (sequence === listSequenceRef.current && epoch === mutationEpochRef.current) {
        setListError(errorMessage(error, 'Nie udało się wczytać dokumentów.'))
      }
      return null
    } finally {
      listRequestsRef.current -= 1
      if (!background && sequence === listSequenceRef.current) setListLoading(false)
    }
  }, [client, filter])

  const loadDetail = useCallback(async (draftId: string, background = false, skipIfPending = false) => {
    if (skipIfPending && detailRequestsRef.current > 0) return null
    detailRequestsRef.current += 1
    detailControllerRef.current?.abort()
    const controller = new AbortController()
    detailControllerRef.current = controller
    const sequence = ++detailSequenceRef.current
    const epoch = mutationEpochRef.current
    if (!background) setDetailLoading(true)
    setDetailError(null)
    try {
      const next = await client.get(draftId, controller.signal)
      if (controller.signal.aborted || sequence !== detailSequenceRef.current
        || epoch !== mutationEpochRef.current || selectedIdRef.current !== draftId) return null
      setDetail(next)
      setDetailError(null)
      return next
    } catch (error) {
      if (controller.signal.aborted || (error instanceof InvoiceImportApiError && error.code === 'ABORTED')) return null
      if (sequence === detailSequenceRef.current && selectedIdRef.current === draftId) {
        setDetailError(errorMessage(error, 'Nie udało się wczytać dokumentu.'))
      }
      return null
    } finally {
      detailRequestsRef.current -= 1
      if (!background && sequence === detailSequenceRef.current) setDetailLoading(false)
    }
  }, [client])

  useEffect(() => {
    void loadList(false)
  }, [loadList])

  useEffect(() => {
    historyRequestRef.current?.controller.abort()
    historyRequestRef.current = null
    historySequenceRef.current += 1
    setDirty(false)
    setIssues([])
    setOperationNotice(null)
    setHistoryOpen(false)
    setHistoryEntries([])
    setHistoryCursor(null)
    setHistoryLoading(false)
    setHistoryError(null)
    setMobilePane('DOCUMENT')
    if (!selectedId) {
      detailControllerRef.current?.abort()
      setDetail(null)
      setDetailLoading(false)
      return
    }
    if (detail?.id !== selectedId) setDetail(null)
    void loadDetail(selectedId)
    return () => detailControllerRef.current?.abort()
    // Keeping the previous same-id detail mounted while it refreshes is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadDetail])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (mutationRef.current || uploadControllerRef.current) return
      void loadList(true, filter, true)
      const currentId = selectedIdRef.current
      if (currentId) void loadDetail(currentId, true, true)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [filter, loadDetail, loadList])

  useEffect(() => () => {
    mountedRef.current = false
    detailControllerRef.current?.abort()
    historyRequestRef.current?.controller.abort()
    historyRequestRef.current = null
    historySequenceRef.current += 1
    uploadControllerRef.current?.abort()
    closedPeriodRequestRef.current?.resolve(null)
    closedPeriodRequestRef.current = null
  }, [])

  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (mutationRef.current) return undefined
    mutationRef.current = true
    mutationEpochRef.current += 1
    setBusy(true)
    setOperationNotice(null)
    try {
      return await operation()
    } finally {
      mutationRef.current = false
      setBusy(false)
    }
  }

  function actionKey(kind: 'APPROVE' | 'REVOKE', draftId: string, version: number): string {
    const identity = `${kind}:${draftId}:${version}`
    const existing = actionKeysRef.current.get(identity)
    if (existing) return existing
    const created = createActionKey()
    actionKeysRef.current.set(identity, created)
    return created
  }

  function requestClosedPeriodConfirmation(
    kind: 'APPROVE' | 'REVOKE',
    draftId: string,
    version: number,
    key: string,
    periods: InvoiceClosedPeriod[],
  ): Promise<ConfirmedMutation | null> {
    return new Promise((resolve, reject) => {
      const request: ClosedPeriodRequest = { kind, draftId, version, key, periods, resolve, reject }
      closedPeriodRequestRef.current = request
      setClosedPeriodRequest(request)
    })
  }

  function callInvoiceMutation(
    kind: 'APPROVE' | 'REVOKE',
    draftId: string,
    version: number,
    key: string,
    periodIds: string[] = [],
  ) {
    return kind === 'APPROVE'
      ? client.approve(draftId, version, key, periodIds)
      : client.revoke(draftId, version, key, periodIds)
  }

  async function recoverNetworkMutation(
    kind: 'APPROVE' | 'REVOKE',
    draftId: string,
    version: number,
    key: string,
    periodIds: string[] = [],
  ): Promise<ConfirmedMutation> {
    const readback = await client.get(draftId).catch(() => null)
    const completed = kind === 'APPROVE' ? readback?.state === 'APPROVED' : readback?.state === 'OPEN'
    if (completed && readback) {
      setDetail(readback)
      return { outcome: 'READBACK', draft: readback }
    }

    try {
      return await callInvoiceMutation(kind, draftId, version, key, periodIds)
    } catch (retryError) {
      if (!(retryError instanceof InvoiceImportApiError) || retryError.code !== 'NETWORK_ERROR') throw retryError
      const finalReadback = await client.get(draftId).catch(() => null)
      const finallyCompleted = kind === 'APPROVE' ? finalReadback?.state === 'APPROVED' : finalReadback?.state === 'OPEN'
      if (finallyCompleted && finalReadback) {
        setDetail(finalReadback)
        return { outcome: 'READBACK', draft: finalReadback }
      }
      throw retryError
    }
  }

  async function mutateInvoice(
    kind: 'APPROVE' | 'REVOKE',
    draftId: string,
    version: number,
    key: string,
  ): Promise<ConfirmedMutation | null> {
    try {
      return await callInvoiceMutation(kind, draftId, version, key)
    } catch (error) {
      if (error instanceof InvoiceImportApiError && error.code === 'CLOSED_PERIOD_CONFIRMATION_REQUIRED') {
        return requestClosedPeriodConfirmation(kind, draftId, version, key, error.periods)
      }
      if (!(error instanceof InvoiceImportApiError) || error.code !== 'NETWORK_ERROR') throw error
      return recoverNetworkMutation(kind, draftId, version, key)
    }
  }

  async function forceCurrentDetail(draftId: string): Promise<InvoiceDraftDetail | null> {
    return loadDetail(draftId)
  }

  async function refreshAfterMutation(draftId: string, advance: boolean) {
    const [openDrafts] = await Promise.all([
      advance ? client.list({ state: 'OPEN', limit: LIST_LIMIT }).catch(() => null) : Promise.resolve(null),
      loadList(true),
    ])
    if (advance && openDrafts) {
      const next = openDrafts.find((item) => item.id !== draftId && !item.skippedAt)
      if (next) {
        selectedIdRef.current = next.id
        setSelectedId(next.id)
        return
      }
    }
    await forceCurrentDetail(draftId)
  }

  function handleMutationError(error: unknown) {
    if (error instanceof InvoiceImportApiError) {
      setIssues(error.issues)
      if (error.code === 'STALE_VERSION') {
        setOperationNotice('Dokument zmienił się na serwerze. Wczytano aktualną wersję; edytor pozwoli bezpiecznie nałożyć Twoje poprawki.')
        const currentId = selectedIdRef.current
        if (currentId) void forceCurrentDetail(currentId)
      } else if (error.code === 'NETWORK_ERROR') {
        setOperationNotice('Nie udało się jednoznacznie potwierdzić operacji. Stan dokumentu został sprawdzony; ponowienie użyje tego samego klucza.')
      }
    }
  }

  async function saveDraft(patch: InvoiceDraftData, expectedVersion: number): Promise<void> {
    if (!detail || Object.keys(patch).length === 0) return
    const draftId = detail.id
    const outcome = await runExclusive(async () => {
      try {
        const updated = await client.edit(draftId, expectedVersion, patch)
        if (selectedIdRef.current === draftId) setDetail(updated)
        setIssues([])
        return updated
      } catch (error) {
        handleMutationError(error)
        throw error
      }
    })
    if (outcome) void loadList(true)
  }

  async function approveDraft(patch: InvoiceDraftData, expectedVersion: number): Promise<void> {
    if (!detail || ksef.approvalBlockReason) return
    const draftId = detail.id
    await runExclusive(async () => {
      const currentPatchKey = patchKey(patch)
      let approvalVersion = expectedVersion
      let key: string
      const pending = pendingApprovalRef.current
      if (pending && pending.draftId === draftId && pending.expectedVersion === expectedVersion && pending.patchKey === currentPatchKey) {
        approvalVersion = pending.approvalVersion
        key = pending.key
      } else {
        if (Object.keys(patch).length > 0) {
          try {
            const updated = await client.edit(draftId, expectedVersion, patch)
            approvalVersion = updated.version
          } catch (error) {
            if (error instanceof InvoiceImportApiError && error.code === 'NETWORK_ERROR') {
              const readback = await client.get(draftId).catch(() => null)
              if (readback) setDetail(readback)
              setIssues([])
              setOperationNotice(readback
                ? 'Nie udało się potwierdzić zapisu poprawek. Wczytano aktualną wersję dokumentu. Sprawdź wszystkie dane i ponownie wybierz „Zatwierdź i następna”.'
                : 'Nie udało się potwierdzić zapisu poprawek. Odśwież dokument, sprawdź wszystkie dane i ponownie wybierz „Zatwierdź i następna”.')
              throw error
            } else {
              handleMutationError(error)
              throw error
            }
          }
        }
        key = actionKey('APPROVE', draftId, approvalVersion)
        pendingApprovalRef.current = { draftId, expectedVersion, patchKey: currentPatchKey, approvalVersion, key }
      }

      try {
        const result = await mutateInvoice('APPROVE', draftId, approvalVersion, key)
        if (result === null) {
          pendingApprovalRef.current = null
          if (!mountedRef.current) return
          await refreshAfterMutation(draftId, false)
          return
        }
        pendingApprovalRef.current = null
        setIssues([])
        if (result.outcome === 'DUPLICATE') {
          if (result.existingDraftId) {
            selectedIdRef.current = result.existingDraftId
            setSelectedId(result.existingDraftId)
          } else {
            setOperationNotice(`Ta faktura istnieje już w kosztach (ID: ${result.invoiceId}). Nie utworzono drugiego kosztu.`)
            setFilter('APPROVED')
            await refreshAfterMutation(draftId, false)
          }
          return
        }
        await onInvoicesChanged().catch(() => {
          setOperationNotice('Faktura została zatwierdzona, ale zestawienie kosztów nie odświeżyło się automatycznie. Odśwież je ręcznie.')
        })
        await refreshAfterMutation(draftId, true)
      } catch (error) {
        handleMutationError(error)
        throw error
      }
    })
  }

  async function revokeDraft(expectedVersion: number): Promise<void> {
    if (!detail) return
    const draftId = detail.id
    await runExclusive(async () => {
      const key = actionKey('REVOKE', draftId, expectedVersion)
      try {
        const result = await mutateInvoice('REVOKE', draftId, expectedVersion, key)
        if (result === null) return
        await onInvoicesChanged().catch(() => {
          setOperationNotice('Faktura została cofnięta z kosztów, ale zestawienie nie odświeżyło się automatycznie. Odśwież je ręcznie.')
        })
        await refreshAfterMutation(draftId, false)
      } catch (error) {
        handleMutationError(error)
        throw error
      }
    })
  }

  async function runDraftAction(action: InvoiceDraftAction, expectedVersion: number): Promise<void> {
    if (!detail || dirty) return
    const draftId = detail.id
    await runExclusive(async () => {
      try {
        const updated = await client.action(draftId, expectedVersion, action)
        setDetail(updated)
        setIssues([])
        await refreshAfterMutation(draftId, action === 'SKIP' || action === 'ARCHIVE')
      } catch (error) {
        handleMutationError(error)
        throw error
      }
    })
  }

  async function resolveKsef(reconciliationId: string, action: InvoiceKsefResolutionInput['action']): Promise<void> {
    const current = ksef.reconciliation
    if (!detail || dirty || ksef.loading || ksef.error || !current || current.draftId !== detail.id
      || current.draftVersion !== detail.version || current.draftState !== detail.state) return
    const link = current.links.find((item) => item.id === reconciliationId)
    if (!link || link.snapshot.documentStatus !== 'ACTIVE' || detail.state === 'ARCHIVED'
      || (action === 'APPLY_TO_DRAFT' && detail.state !== 'OPEN')) return
    const draftId = detail.id
    const identity = `KSEF:${draftId}:${detail.version}:${link.id}:${link.version}:${action}`
    const idempotencyKey = actionKeysRef.current.get(identity) ?? createActionKey()
    actionKeysRef.current.set(identity, idempotencyKey)
    const input: InvoiceKsefResolutionInput = { reconciliationId: link.id, expectedDraftVersion: detail.version,
      expectedLinkVersion: link.version, action, idempotencyKey }
    await runExclusive(async () => {
      try {
        try { await client.resolveKsef(draftId, input) }
        catch (error) {
          if (!(error instanceof InvoiceImportApiError) || !['NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code)) throw error
          // An uncertain response may follow a committed decision. Replay only
          // the exact original operation, never one based on refreshed versions.
          await client.resolveKsef(draftId, input)
        }
        setIssues([])
        await refreshAfterMutation(draftId, false)
        ksef.refresh()
        await onInvoicesChanged().catch(() => {
          setOperationNotice('Wybór zapisano, ale oznaczenia na liście nie odświeżyły się. Odśwież zestawienie ręcznie.')
        })
      } catch (error) {
        const [readback, , parentRefreshed] = await Promise.all([
          forceCurrentDetail(draftId),
          loadList(true),
          onInvoicesChanged().then(() => true, () => false),
        ])
        ksef.refresh()
        const notice = readback
          ? 'Wczytano bieżący stan dokumentu. Sprawdź porównanie z KSeF przed kolejnym wyborem.'
          : 'Nie można potwierdzić wyboru ani odświeżyć dokumentu. Ponów sprawdzenie KSeF przed kolejnym działaniem.'
        setOperationNotice(parentRefreshed ? notice : `${notice} Oznaczenia na liście wymagają ręcznego odświeżenia.`)
        throw error
      }
    })
  }

  function refreshKsef() {
    if (!detail) return
    const draftId = detail.id
    void runExclusive(async () => {
      await forceCurrentDetail(draftId)
      ksef.refresh()
    })
  }

  function chooseDraft(draftId: string) {
    if (busy || uploadBusy || draftId === selectedIdRef.current) return
    if (dirty) {
      setDiscardTarget({ kind: 'SELECT', draftId })
      return
    }
    selectedIdRef.current = draftId
    setSelectedId(draftId)
  }

  function requestClose() {
    if (busy || uploadBusy) return
    if (dirty) {
      setDiscardTarget({ kind: 'CLOSE' })
      return
    }
    onClose()
  }

  function confirmDiscard() {
    const target = discardTarget
    setDiscardTarget(null)
    setDirty(false)
    if (target?.kind === 'CLOSE') onClose()
    if (target?.kind === 'SELECT' && target.draftId) {
      selectedIdRef.current = target.draftId
      setSelectedId(target.draftId)
    }
  }

  function updateUpload(id: string, patch: Partial<UploadEntry>) {
    setUploadEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  }

  async function uploadOne(entry: UploadEntry, batchId: string, controller: AbortController) {
    updateUpload(entry.id, { batchId, state: 'UPLOADING', message: undefined, retryable: false })
    try {
      const result = await client.upload(batchId, entry.file, controller.signal)
      updateUpload(entry.id, {
        state: result.deduplicated ? 'DUPLICATE' : 'SAVED',
        retryable: false,
      })
      await loadList(true)
      if (!selectedIdRef.current) {
        selectedIdRef.current = result.draft.id
        setSelectedId(result.draft.id)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      updateUpload(entry.id, {
        state: 'ERROR',
        message: errorMessage(error, 'Nie udało się zapisać pliku.'),
        retryable: true,
      })
    }
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0 || uploadBusy || busy || uploadControllerRef.current) return
    setUploadError(null)
    if (files.length > INVOICE_IMPORT_MAX_FILES) {
      setUploadError(`Wybierz maksymalnie ${INVOICE_IMPORT_MAX_FILES} plików w jednym dodaniu.`)
      return
    }

    const entries: UploadEntry[] = files.map((file) => {
      uploadCounterRef.current += 1
      const typeAllowed = ALLOWED_TYPES.has(file.type)
      const sizeAllowed = file.size <= INVOICE_ATTACHMENT_MAX_BYTES
      return {
        id: `upload-${uploadCounterRef.current}`,
        file,
        batchId: null,
        state: typeAllowed && sizeAllowed ? 'WAITING' : 'ERROR',
        message: !typeAllowed
          ? 'Dozwolone są pliki PDF, JPG, PNG i WEBP.'
          : !sizeAllowed ? 'Plik przekracza limit 10 MiB.' : undefined,
        retryable: false,
      }
    })
    setUploadEntries(entries)
    const valid = entries.filter((entry) => entry.state === 'WAITING')
    if (valid.length === 0) return

    const controller = new AbortController()
    uploadControllerRef.current = controller
    setUploadBusy(true)
    try {
      const batch = await client.createBatch()
      for (const entry of valid) {
        if (controller.signal.aborted) break
        await uploadOne(entry, batch.id, controller)
      }
    } catch (error) {
      const message = errorMessage(error, 'Nie udało się rozpocząć dodawania dokumentów.')
      setUploadEntries((current) => current.map((entry) => entry.state === 'WAITING'
        ? { ...entry, state: 'ERROR', message, retryable: false }
        : entry))
    } finally {
      uploadControllerRef.current = null
      setUploadBusy(false)
    }
  }

  async function retryUpload(entry: UploadEntry) {
    if (!entry.batchId || !entry.retryable || uploadBusy || busy || uploadControllerRef.current) return
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setUploadBusy(true)
    try {
      await uploadOne(entry, entry.batchId, controller)
    } finally {
      uploadControllerRef.current = null
      setUploadBusy(false)
    }
  }

  const loadHistory = useCallback(async (cursor?: string) => {
    const draftId = selectedIdRef.current
    if (!draftId) return
    const currentRequest = historyRequestRef.current
    if (currentRequest?.draftId === draftId) return
    currentRequest?.controller.abort()
    const controller = new AbortController()
    const sequence = ++historySequenceRef.current
    historyRequestRef.current = { draftId, controller }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const page = await client.history(draftId, cursor, controller.signal)
      if (controller.signal.aborted || sequence !== historySequenceRef.current || selectedIdRef.current !== draftId) return
      setHistoryEntries((current) => cursor ? [...current, ...page.entries] : page.entries)
      setHistoryCursor(page.nextCursor)
    } catch (error) {
      if (controller.signal.aborted || (error instanceof InvoiceImportApiError && error.code === 'ABORTED')) return
      if (sequence === historySequenceRef.current && selectedIdRef.current === draftId) {
        setHistoryError(errorMessage(error, 'Nie udało się wczytać historii.'))
      }
    } finally {
      if (historyRequestRef.current?.controller === controller && sequence === historySequenceRef.current) {
        historyRequestRef.current = null
        setHistoryLoading(false)
      }
    }
  }, [client])

  const historyDraftId = detail?.id
  const historyDraftVersion = detail?.version
  useEffect(() => {
    if (!historyOpen || !historyDraftId || historyDraftId !== selectedIdRef.current) return
    // A new version may carry an AI result or a mutation from another tab.
    // Restart the first page, rather than keeping an obsolete history forever.
    historyRequestRef.current?.controller.abort()
    historyRequestRef.current = null
    historySequenceRef.current += 1
    setHistoryEntries([])
    setHistoryCursor(null)
    void loadHistory()
    return () => {
      historyRequestRef.current?.controller.abort()
      historyRequestRef.current = null
      historySequenceRef.current += 1
    }
  }, [historyDraftId, historyDraftVersion, historyOpen, loadHistory])

  function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
  }

  async function confirmClosedPeriods() {
    const request = closedPeriodRequestRef.current
    if (!request) return
    closedPeriodRequestRef.current = null
    setClosedPeriodRequest(null)
    try {
      const ids = request.periods.map((period) => period.id)
      let result: ConfirmedMutation
      try {
        result = await callInvoiceMutation(request.kind, request.draftId, request.version, request.key, ids)
      } catch (error) {
        if (!(error instanceof InvoiceImportApiError) || error.code !== 'NETWORK_ERROR') throw error
        result = await recoverNetworkMutation(request.kind, request.draftId, request.version, request.key, ids)
      }
      request.resolve(result)
    } catch (error) {
      request.reject(error)
    }
  }

  function cancelClosedPeriods() {
    const request = closedPeriodRequestRef.current
    closedPeriodRequestRef.current = null
    setClosedPeriodRequest(null)
    request?.resolve(null)
  }

  const failureMessage = detail ? jobFailureMessage(detail) : null
  const editorVisible = mobilePane === 'DATA'
  const sourceVisible = mobilePane === 'DOCUMENT'

  return (
    <div className="min-h-full bg-[var(--wd-off-white)] text-[var(--wd-dark)]">
      <header className="border-b border-[var(--wd-border)] bg-[var(--wd-white)] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="ghost" size="icon" disabled={busy || uploadBusy} onClick={requestClose} aria-label="Wróć do faktur">
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--wd-text-muted)]">Koszty · obieg dokumentu</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight">Import faktur</h1>
            </div>
          </div>
          <label className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--wd-dark)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black focus-within:ring-2 focus-within:ring-[var(--wd-dark)]/25 ${busy || uploadBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            <UploadCloud aria-hidden="true" className="size-4" />
            Dodaj dokumenty
            <input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
              disabled={busy || uploadBusy}
              className="sr-only"
              aria-label="Dodaj faktury"
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                void handleFiles(selected)
              }}
            />
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        {(uploadError || uploadEntries.length > 0) && (
          <section aria-labelledby="invoice-upload-title" className="mb-5 border-y border-[var(--wd-border)] bg-[var(--wd-white)] px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="invoice-upload-title" className="font-semibold">Przesyłanie dokumentów</h2>
                <p className="mt-1 text-xs text-[var(--wd-text-muted)]">Maksymalnie 20 plików po 10 MiB. Samo dodanie nie tworzy kosztu.</p>
              </div>
              {uploadEntries.length > 0 && !uploadBusy && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setUploadEntries([])}>Ukryj zakończone</Button>
              )}
            </div>
            {uploadError && <p role="alert" className="mt-3 text-sm font-medium text-red-800">{uploadError}</p>}
            <ul className="mt-3 divide-y divide-[var(--wd-border)]">
              {uploadEntries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  {entry.state === 'UPLOADING' ? <LoaderCircle className="size-4 animate-spin text-amber-700" aria-hidden="true" />
                    : entry.state === 'SAVED' || entry.state === 'DUPLICATE' ? <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
                      : entry.state === 'ERROR' ? <XCircle className="size-4 text-red-700" aria-hidden="true" />
                        : <Clock3 className="size-4 text-[var(--wd-text-muted)]" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 break-all font-medium">{entry.file.name}</span>
                  <span className="text-xs font-semibold">{uploadLabels[entry.state]}</span>
                  {entry.message && <span className="basis-full pl-7 text-xs text-red-800">{entry.message}</span>}
                  {entry.retryable && (
                    <Button type="button" size="sm" variant="outline" disabled={uploadBusy || busy} onClick={() => { void retryUpload(entry) }} aria-label={`Ponów ${entry.file.name}`}>
                      <RotateCcw aria-hidden="true" />Ponów
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid min-h-[70dvh] grid-cols-1 overflow-hidden rounded-lg border border-[var(--wd-border)] bg-[var(--wd-white)] lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <aside className="border-b border-[var(--wd-border)] lg:border-b-0 lg:border-r" aria-label="Dokumenty importu">
            <div className="border-b border-[var(--wd-border)] p-4">
              <label htmlFor="invoice-state-filter" className="text-xs font-semibold uppercase tracking-wide text-[var(--wd-text-muted)]">Stan dokumentów</label>
              <div className="mt-2 flex gap-2">
                <select
                  id="invoice-state-filter"
                  aria-label="Stan dokumentów"
                  value={filter}
                  disabled={busy || uploadBusy}
                  onChange={(event) => setFilter(event.target.value as FilterState)}
                  className="min-h-10 min-w-0 flex-1 rounded-md border border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20"
                >
                  <option value="ALL">Wszystkie</option>
                  <option value="OPEN">Otwarte</option>
                  <option value="APPROVED">Zatwierdzone</option>
                  <option value="ARCHIVED">Archiwum</option>
                </select>
                <Button type="button" variant="outline" size="icon" disabled={listLoading || busy || uploadBusy} onClick={() => { void loadList(false) }} aria-label="Odśwież listę">
                  <RefreshCcw aria-hidden="true" />
                </Button>
              </div>
            </div>

            {listLoading && drafts.length === 0 ? (
              <p role="status" className="p-5 text-sm text-[var(--wd-text-muted)]">Wczytuję dokumenty…</p>
            ) : listError && drafts.length === 0 ? (
              <div className="space-y-3 p-4">
                <Alert variant="destructive"><AlertDescription>{listError}</AlertDescription></Alert>
                <Button type="button" variant="outline" onClick={() => { void loadList(false) }}>Spróbuj ponownie</Button>
              </div>
            ) : drafts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <FileText className="mx-auto size-7 text-[var(--wd-text-muted)]" aria-hidden="true" />
                <p className="mt-3 text-sm text-[var(--wd-text-muted)]">Brak dokumentów w tym widoku.</p>
              </div>
            ) : (
              <ul className="max-h-[70dvh] divide-y divide-[var(--wd-border)] overflow-y-auto">
                {drafts.map((draft) => {
                  const status = draftStatus(draft)
                  const selected = selectedId === draft.id
                  return (
                    <li key={draft.id}>
                      <button
                        type="button"
                        disabled={busy || uploadBusy}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => chooseDraft(draft.id)}
                        className={`w-full px-4 py-4 text-left transition-colors hover:bg-[var(--wd-sand-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wd-dark)]/20 disabled:cursor-not-allowed ${selected ? 'bg-[var(--wd-sand-light)]' : 'bg-white'}`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{draft.display.supplierName ?? draft.display.fileName}</span>
                            <span className="mt-1 block truncate text-xs text-[var(--wd-text-muted)]">{draft.display.invoiceNumber ?? draft.display.fileName}</span>
                          </span>
                          <ChevronRight className="mt-0.5 size-4 shrink-0 text-[var(--wd-text-muted)]" aria-hidden="true" />
                        </span>
                        <span className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.tone}`}>{status.label}</span>
                          <span className="font-mono text-xs tabular-nums">{formatAmount(draft.display.gross, draft.display.currency)}</span>
                        </span>
                        {draft.ksef.linkedCount > 0 && (
                          <span className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${draft.ksef.conflictCount > 0
                            ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-[var(--wd-border)] text-[var(--wd-text-muted)]'}`}>
                            {draft.ksef.conflictCount > 0 ? 'KSeF · wymaga rozstrzygnięcia' : 'Powiązana z KSeF'}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {listError && drafts.length > 0 && (
              <div role="alert" className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900">
                <p className="font-semibold">Nie udało się odświeżyć tego widoku.</p>
                <p>{listError} Pokazujemy ostatnio wczytaną listę.</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => { void loadList(false) }} className="mt-1">Spróbuj ponownie</Button>
              </div>
            )}
            {drafts.length === LIST_LIMIT && (
              <p className="border-t border-[var(--wd-border)] px-4 py-3 text-xs leading-5 text-amber-900">Pokazano pierwsze 100 dokumentów. Zawęź widok filtrem, aby znaleźć starsze pozycje.</p>
            )}
          </aside>

          <section className="min-w-0" aria-label="Weryfikacja faktury">
            {!selectedId ? (
              <div className="grid min-h-[60dvh] place-items-center p-8 text-center text-sm text-[var(--wd-text-muted)]">Wybierz dokument z listy albo dodaj nowy plik.</div>
            ) : detailError && !detail ? (
              <div className="mx-auto max-w-lg space-y-4 p-8">
                <Alert variant="destructive"><AlertDescription>{detailError}</AlertDescription></Alert>
                <Button type="button" variant="outline" onClick={() => { void loadDetail(selectedId) }}>Spróbuj ponownie</Button>
              </div>
            ) : !detail ? (
              <p role="status" className="p-8 text-sm text-[var(--wd-text-muted)]">Wczytuję dokument…</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--wd-border)] px-4 py-3">
                  <p className="min-w-0 truncate text-sm font-semibold">{detail.attachment.originalName}</p>
                  <Button type="button" size="sm" variant="ghost" disabled={detailLoading || busy || uploadBusy} onClick={() => { void loadDetail(detail.id) }}>
                    <RefreshCcw aria-hidden="true" />Odśwież dokument
                  </Button>
                </div>
                <div className="border-b border-[var(--wd-border)] p-2 md:hidden">
                  <div className="grid grid-cols-2 rounded-md bg-[var(--wd-surface-2)] p-1" aria-label="Widok dokumentu">
                    <button type="button" aria-pressed={sourceVisible} onClick={() => setMobilePane('DOCUMENT')} className={`min-h-10 rounded px-3 text-sm font-semibold ${sourceVisible ? 'bg-white shadow-sm' : 'text-[var(--wd-text-muted)]'}`}>Dokument</button>
                    <button type="button" aria-pressed={editorVisible} onClick={() => setMobilePane('DATA')} className={`min-h-10 rounded px-3 text-sm font-semibold ${editorVisible ? 'bg-white shadow-sm' : 'text-[var(--wd-text-muted)]'}`}>Dane</button>
                  </div>
                </div>

                {detailLoading && <p role="status" className="border-b border-[var(--wd-border)] px-5 py-2 text-xs text-[var(--wd-text-muted)]">Odświeżam stan dokumentu…</p>}
                {detailError && <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{detailError}</p>}
                {operationNotice && <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-950">{operationNotice}</p>}
                {failureMessage && (
                  <div className="flex gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                    <div><p className="font-semibold">Odczyt wymaga działania</p><p className="mt-1 leading-6">{failureMessage}</p></div>
                  </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2">
                  <div className={`${sourceVisible ? 'block' : 'hidden'} border-[var(--wd-border)] p-4 md:block xl:border-r xl:p-5`}>
                    <InvoiceOriginalPreview draftId={detail.id} attachment={detail.attachment} />
                    <section className="mt-4 border-t border-[var(--wd-border)] pt-3" aria-labelledby="invoice-history-title">
                      <button type="button" onClick={toggleHistory} className="flex min-h-10 w-full items-center justify-between text-left text-sm font-semibold">
                        <span className="flex items-center gap-2"><History className="size-4" aria-hidden="true" /><span id="invoice-history-title">Historia dokumentu</span></span>
                        <ChevronRight className={`size-4 transition-transform ${historyOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                      </button>
                      {historyOpen && (
                        <div className="pt-2">
                          {historyLoading && historyEntries.length === 0 ? <p role="status" className="text-xs text-[var(--wd-text-muted)]">Wczytuję historię…</p>
                            : historyError ? <div><p role="alert" className="text-xs text-red-800">{historyError}</p><Button type="button" variant="ghost" size="sm" onClick={() => { void loadHistory() }}>Ponów</Button></div>
                              : historyEntries.length === 0 ? <p className="text-xs text-[var(--wd-text-muted)]">Brak zapisanych zdarzeń.</p>
                                : <ol className="space-y-3 border-l border-[var(--wd-border)] pl-4">{historyEntries.map((entry) => <li key={entry.id} className="text-xs"><p className="font-semibold">{historyLabels[entry.action] ?? 'Zmieniono dokument'}</p><p className="mt-0.5 text-[var(--wd-text-muted)]">{new Date(entry.createdAt).toLocaleString('pl-PL')}{entry.actorName ? ` · ${entry.actorName}` : ''}</p></li>)}</ol>}
                          {historyCursor && <Button type="button" variant="ghost" size="sm" disabled={historyLoading} onClick={() => { void loadHistory(historyCursor) }} className="mt-3">Wczytaj starsze</Button>}
                        </div>
                      )}
                    </section>
                  </div>
                  <div className={`${editorVisible ? 'block' : 'hidden'} p-4 md:block xl:p-6`}>
                    {detail.ksef.linkedCount > 0 && <div className="mb-6">
                      <InvoiceKsefReconciliationPanel
                        draft={detail}
                        reconciliation={ksef.reconciliation}
                        localCurrency={detail.data.currency}
                        loading={ksef.loading}
                        error={ksef.error}
                        dirty={dirty}
                        busy={busy}
                        onRetry={refreshKsef}
                        onResolve={resolveKsef}
                      />
                    </div>}
                    <InvoiceReviewEditor
                      key={detail.id}
                      draft={detail}
                      costCenters={costCenters}
                      tagGroups={tagGroups}
                      rules={rules}
                      busy={busy}
                      issues={issues}
                      approvalBlockReason={ksef.approvalBlockReason}
                      onSave={saveDraft}
                      onApprove={approveDraft}
                      onRevoke={revokeDraft}
                      onAction={runDraftAction}
                      onDirtyChange={setDirty}
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <Dialog open={Boolean(discardTarget)} onOpenChange={(open) => { if (!open) setDiscardTarget(null) }}>
        <DialogContent className="border-[var(--wd-border)] bg-[var(--wd-white)]">
          <DialogHeader>
            <DialogTitle>Odrzucić niezapisane zmiany?</DialogTitle>
            <DialogDescription>Zmiany istnieją tylko w formularzu. Po przejściu dalej nie będzie można ich odzyskać.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDiscardTarget(null)}>Zostań przy dokumencie</Button>
            <Button type="button" onClick={confirmDiscard} className="bg-red-800 text-white hover:bg-red-900">Odrzuć zmiany</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closedPeriodRequest)} onOpenChange={(open) => { if (!open) cancelClosedPeriods() }}>
        <DialogContent className="border-[var(--wd-border)] bg-[var(--wd-white)]">
          <DialogHeader>
            <DialogTitle>Ponownie otworzyć zamknięty okres?</DialogTitle>
            <DialogDescription>Ta operacja zmieni podsumowania zamkniętego miesiąca. Okres zostanie ponownie otwarty i będzie wymagał ponownej kontroli oraz zamknięcia.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 rounded-md bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {closedPeriodRequest?.periods.map((period) => <li key={period.id}>{monthNames[period.month - 1]} {period.year}</li>)}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelClosedPeriods}>Anuluj</Button>
            <Button type="button" onClick={() => { void confirmClosedPeriods() }} className="bg-amber-800 text-white hover:bg-amber-900">Potwierdź i otwórz okres</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
