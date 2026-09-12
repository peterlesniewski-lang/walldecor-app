'use client'

import { useCallback, useEffect, useState } from 'react'
import type { createInvoiceImportClient } from '@/lib/invoice-import/client'
import type { InvoiceDraftDetail, InvoiceDraftKsefReconciliation } from '@/lib/invoice-import/client-contracts'

type Draft = Pick<InvoiceDraftDetail, 'id' | 'version' | 'state' | 'ksef'>
type Client = Pick<ReturnType<typeof createInvoiceImportClient>, 'ksef'>

/** A comparison belongs to one server draft revision, not merely its ID. */
export function useInvoiceKsefReconciliation(draft: Draft | null, client: Client) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; data: InvoiceDraftKsefReconciliation } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const draftId = draft?.id
  const hasLinks = Boolean(draft && draft.ksef.linkedCount > 0)
  const key = JSON.stringify([draftId, draft?.version, draft?.state, draft?.ksef.linkedCount, attempt])
  const refresh = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!draftId || !hasLinks) return
    const controller = new AbortController()
    void client.ksef(draftId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setLoaded({ key, data })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure({ key, message: error instanceof Error
        ? error.message : 'Nie udało się wczytać porównania z KSeF.' })
    })
    return () => controller.abort()
  }, [draftId, hasLinks, key, client])

  // A fresh server summary with no bindings is sufficient evidence; no second
  // request is needed for the common file-only case. Sync increments its version.
  const reconciliation = !draft ? null : !hasLinks
    ? { draftId: draft.id, draftVersion: draft.version, draftState: draft.state, links: [] }
    : loaded?.key === key ? loaded.data : null
  const error = hasLinks && failure?.key === key ? failure.message : null
  const loading = hasLinks && !reconciliation && !error
  let approvalBlockReason: string | null = null
  if (hasLinks) {
    if (loading) approvalBlockReason = 'Sprawdzam aktualne powiązanie z KSeF.'
    else if (error) approvalBlockReason = 'Nie można potwierdzić stanu KSeF. Ponów sprawdzenie przed zatwierdzeniem.'
    else if (!reconciliation || reconciliation.draftId !== draft?.id || reconciliation.draftVersion !== draft?.version
      || reconciliation.draftState !== draft?.state) approvalBlockReason = 'Dane dokumentu zmieniły się. Odśwież porównanie z KSeF.'
    else if (reconciliation.links.some((link) => link.approvalBlocked)) {
      approvalBlockReason = 'Rozstrzygnij różnice z KSeF przed zatwierdzeniem kosztu.'
    }
  }
  return { reconciliation, loading, error, refresh, approvalBlockReason }
}
