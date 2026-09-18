'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createInvoiceImportClient, invoiceOriginalUrl } from '@/lib/invoice-import/client'
import type { InvoiceDraftDetail } from '@/lib/invoice-import/client-contracts'

interface Props {
  draftId: string
  attachment: Pick<InvoiceDraftDetail['attachment'], 'originalName' | 'mimeType' | 'byteSize' | 'sha256' | 'pageCount'>
}

// The paper occupies a quiet, inset surface; the existing operational typeface,
// warm border and 4px rhythm keep attention on the source and its amounts.
export function InvoiceOriginalPreview({ draftId, attachment }: Props) {
  const client = useMemo(() => createInvoiceImportClient(), [])
  const [preview, setPreview] = useState<{ key: string; url: string | null; error: string | null } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { mimeType, byteSize, sha256, originalName, pageCount } = attachment
  const key = `${draftId}:${mimeType}:${byteSize}:${sha256}:${attempt}`
  const url = preview?.key === key ? preview.url : null
  const error = preview?.key === key ? preview.error : null
  useEffect(() => {
    const controller = new AbortController()
    let ownedUrl: string | null = null
    void client.original(draftId, { mimeType, byteSize, sha256 }, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      ownedUrl = URL.createObjectURL(blob)
      setPreview({ key, url: ownedUrl, error: null })
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setPreview({ key, url: null, error: failure instanceof Error ? failure.message : 'Nie można wyświetlić oryginału.' })
    })
    return () => {
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [client, draftId, mimeType, byteSize, sha256, key])

  return (
    <section aria-label="Oryginał faktury" className="overflow-hidden rounded-lg border border-[var(--wd-border)] bg-[var(--wd-bg)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--wd-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-[var(--wd-dark)]">{originalName}</p>
          <p className="mt-1 text-xs text-[var(--wd-text-muted)]">{(byteSize / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} KB{pageCount ? ` · ${pageCount} str.` : ''} · oryginalny plik</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" asChild><a href={invoiceOriginalUrl(draftId)} target="_blank" rel="noopener noreferrer" aria-label="Otwórz oryginał w nowej karcie"><ExternalLink aria-hidden="true" /></a></Button>
          <Button variant="ghost" size="icon" asChild><a href={invoiceOriginalUrl(draftId, true)} aria-label="Pobierz oryginał"><Download aria-hidden="true" /></a></Button>
        </div>
      </header>
      {error ? (
        <div className="space-y-4 p-6">
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}><RefreshCcw aria-hidden="true" />Ponów podgląd</Button>
        </div>
      ) : !url ? (
        <p role="status" className="p-8 text-sm text-[var(--wd-text-muted)]">Wczytuję oryginał…</p>
      ) : mimeType === 'application/pdf' ? (
        <iframe src={url} title={`Oryginał: ${originalName}`} referrerPolicy="no-referrer" className="h-[70dvh] min-h-96 w-full border-0 bg-white" />
      ) : (
        <div className="max-h-[75dvh] overflow-auto p-4">
          {/* A verified private blob cannot use Next's public image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={originalName} onError={() => {
            URL.revokeObjectURL(url)
            setPreview({ key, url: null, error: 'Nie można wyświetlić oryginału w tej przeglądarce. Możesz pobrać plik.' })
          }} className="mx-auto h-auto w-full object-contain" />
        </div>
      )}
      <p className="border-t border-[var(--wd-border)] px-4 py-3 text-xs leading-relaxed text-[var(--wd-text-muted)]">Dane w formularzu porównaj z dokumentem. Podgląd i pobranie nie zmieniają faktury ani jej płatności.</p>
    </section>
  )
}
