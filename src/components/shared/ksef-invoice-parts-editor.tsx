'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { TagChips, type TagChipsGroup, type TagChipsTag } from '@/components/shared/tag-chips'

interface CostCenterOption {
  id: string
  name: string
}

interface InvoicePartsEditorInvoice {
  id: string
  invoiceNumber: string
  grossAmount: number
  reportingGrossAmount?: number | null
  currency: string
}

interface PartDraft {
  label: string
  grossAmount: string
  tagIds: string[]
  allocations: Array<{ costCenterId: string; percent: string }>
}

interface KsefInvoicePartsEditorProps {
  invoice: InvoicePartsEditorInvoice
  costCenters: CostCenterOption[]
  tagGroups: TagChipsGroup[]
  formatMoney: (value: number, currency?: string) => string
  onCreateTag?: (group: TagChipsGroup, name: string) => Promise<TagChipsTag>
  onClose: () => void
  onSaved: (invoice: unknown) => void
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function createDefaultPart(invoice: InvoicePartsEditorInvoice): PartDraft {
  return {
    label: 'Faktura',
    grossAmount: String(invoice.reportingGrossAmount ?? invoice.grossAmount),
    tagIds: [],
    allocations: [{ costCenterId: 'GLOBAL', percent: '100' }],
  }
}

export function KsefInvoicePartsEditor({
  invoice,
  costCenters,
  tagGroups,
  formatMoney,
  onCreateTag,
  onClose,
  onSaved,
}: KsefInvoicePartsEditorProps) {
  const [parts, setParts] = useState<PartDraft[]>([createDefaultPart(invoice)])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invoiceAmount = invoice.reportingGrossAmount ?? invoice.grossAmount
  const partsTotal = roundMoney(parts.reduce((sum, part) => sum + (Number(part.grossAmount) || 0), 0))
  const totalValid = partsTotal === roundMoney(invoiceAmount)

  const allocationErrors = useMemo(() => {
    return parts.map((part) => {
      const total = roundMoney(part.allocations.reduce((sum, allocation) => sum + (Number(allocation.percent) || 0), 0))
      return total === 100 ? null : `Alokacja musi mieć 100%, teraz ${total}%.`
    })
  }, [parts])
  const canSave = totalValid && allocationErrors.every((item) => item == null) && parts.every((part) => part.label.trim())

  function updatePart(index: number, nextPart: PartDraft) {
    setParts((current) => current.map((part, partIndex) => (partIndex === index ? nextPart : part)))
  }

  async function saveParts() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/finance/ksef/invoices/${invoice.id}/parts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: parts.map((part) => ({
            label: part.label,
            grossAmount: Number(part.grossAmount),
            tagIds: part.tagIds,
            allocations: part.allocations.map((allocation) => ({
              costCenterId: allocation.costCenterId,
              percent: Number(allocation.percent),
            })),
          })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Nie udało się zapisać części faktury')
      onSaved(data.invoice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać części faktury')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-4xl rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-[var(--wd-border)] px-5 py-4">
          <div>
            <p className="data-label">Rozbicie kosztu</p>
            <h2 className="text-lg font-semibold">Części faktury</h2>
            <p className="text-xs num" style={{ color: 'var(--wd-text-muted)' }}>
              {invoice.invoiceNumber} · {formatMoney(invoiceAmount, invoice.reportingGrossAmount ? 'PLN' : invoice.currency)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-[var(--wd-border)] p-2 hover:bg-gray-50" title="Zamknij">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}

          <div className="rounded border border-[var(--wd-border)] px-3 py-2">
            <p className="data-label">Suma części</p>
            <p className={`num text-sm font-semibold ${totalValid ? 'text-green-700' : 'text-red-700'}`}>
              {formatMoney(partsTotal)} / {formatMoney(invoiceAmount)}
            </p>
          </div>

          {parts.map((part, index) => (
            <div key={index} className="rounded border border-[var(--wd-border)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Część {index + 1}</p>
                {parts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setParts((current) => current.filter((_, partIndex) => partIndex !== index))}
                    className="rounded border border-[var(--wd-border)] p-1 hover:bg-gray-50"
                    title="Usuń część"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_140px]">
                <input
                  className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm"
                  placeholder="Nazwa części"
                  value={part.label}
                  onChange={(event) => updatePart(index, { ...part, label: event.target.value })}
                />
                <input
                  className="rounded border border-[var(--wd-border)] px-3 py-2 text-sm"
                  inputMode="decimal"
                  placeholder="Kwota brutto"
                  value={part.grossAmount}
                  onChange={(event) => updatePart(index, { ...part, grossAmount: event.target.value })}
                />
              </div>

              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>Tagi</p>
                <TagChips
                  groups={tagGroups}
                  value={part.tagIds}
                  onCreateTag={onCreateTag}
                  onChange={(tagIds) => updatePart(index, { ...part, tagIds })}
                />
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {costCenters.map((costCenter) => {
                  const allocation = part.allocations.find((item) => item.costCenterId === costCenter.id)
                  return (
                    <label key={costCenter.id} className="block text-xs font-semibold" style={{ color: 'var(--wd-text-muted)' }}>
                      {costCenter.name}
                      <input
                        className="mt-1 w-full rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-normal text-[var(--wd-dark)]"
                        inputMode="decimal"
                        value={allocation?.percent ?? ''}
                        onChange={(event) => {
                          const withoutCurrent = part.allocations.filter((item) => item.costCenterId !== costCenter.id)
                          const nextAllocations = event.target.value
                            ? [...withoutCurrent, { costCenterId: costCenter.id, percent: event.target.value }]
                            : withoutCurrent
                          updatePart(index, { ...part, allocations: nextAllocations })
                        }}
                      />
                    </label>
                  )
                })}
              </div>
              {allocationErrors[index] && <p className="mt-2 text-xs font-semibold text-red-700">{allocationErrors[index]}</p>}
            </div>
          ))}

          <div className="flex flex-wrap justify-between gap-2">
            <button
              type="button"
              onClick={() => setParts((current) => [...current, createDefaultPart({ ...invoice, grossAmount: 0, reportingGrossAmount: 0 })])}
              className="inline-flex items-center gap-2 rounded border border-[var(--wd-border)] px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              <Plus size={15} />
              Dodaj część
            </button>
            <button
              type="button"
              onClick={saveParts}
              disabled={!canSave || saving}
              className="rounded bg-[var(--wd-dark)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? 'Zapisuję...' : 'Zapisz części'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
