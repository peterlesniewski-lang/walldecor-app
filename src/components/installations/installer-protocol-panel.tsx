'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePenLine, ArrowUpRight } from 'lucide-react'
import { formatWarsawDateTime } from '@/lib/installations/visit-time'

export type AcceptanceCandidate = {
  id: string
  visitId: string
  startsAt: Date | string | null
  groupKey: string
  workType: string
  scopeCount: number
  status: string | null
  blockedReason: string | null
}

const statusName: Record<string, string> = {
  DRAFT: 'szkic', INSTALLER_SIGNED: 'podpis wykonawcy złożony', ACCEPTED: 'odebrano',
  ACCEPTED_WITH_REMARKS: 'odebrano z uwagami', REFUSED: 'odmowa odbioru', UNILATERAL: 'protokół jednostronny',
}

export function InstallerProtocolPanel({ orderId, candidates }: { orderId: string; candidates: AcceptanceCandidate[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function open(candidate: AcceptanceCandidate) {
    if (candidate.status) {
      router.push(`/installations/${orderId}/protocols/${candidate.id}`)
      return
    }
    setBusy(candidate.id)
    setError('')
    try {
      const response = await fetch(`/api/installations/${orderId}/protocols`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitId: candidate.visitId, groupKey: candidate.groupKey }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Nie udało się otworzyć protokołu.')
      router.push(`/installations/${orderId}/protocols/${body.protocol.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć protokołu.')
      setBusy(null)
    }
  }

  return (
    <section id="acceptance" aria-labelledby="acceptance-heading" className="scroll-mt-6 overflow-hidden rounded-2xl border border-[color:var(--wd-dark)] bg-[color:var(--wd-white)]">
      <div className="border-b border-[color:var(--wd-dark)] px-5 py-5 sm:px-7" style={{ background: 'linear-gradient(125deg, var(--wd-sand-light), var(--wd-white) 70%)' }}>
        <span className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: '#8C5718' }}>Po wykonaniu montażu</span>
        <h2 id="acceptance-heading" className="mt-2 text-2xl font-bold tracking-tight" style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-acceptance-display)' }}>Protokoły odbioru</h2>
        <p className="mt-1 max-w-xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>Jeden protokół obejmuje jeden rodzaj prac wykonanych podczas wizyty, również w kilku pomieszczeniach.</p>
      </div>
      <div className="divide-y divide-black/10">
        {candidates.length === 0 && <p className="px-5 py-6 text-sm sm:px-7" style={{ color: 'var(--wd-text-muted)' }}>Po rozpoczęciu wizyty pojawią się tu prace do udokumentowania.</p>}
        {candidates.map((candidate) => (
          <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#8C5718' }}>{candidate.startsAt ? formatWarsawDateTime(candidate.startsAt) : 'Wizyta'}</p>
              <h3 className="mt-1 text-lg font-extrabold" style={{ color: 'var(--wd-dark)' }}>{candidate.workType}</h3>
              <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>{candidate.scopeCount} {candidate.scopeCount === 1 ? 'praca' : 'prace'} · {candidate.status ? statusName[candidate.status] ?? candidate.status : 'do przygotowania'}</p>
              {candidate.blockedReason && <p className="mt-1 max-w-md text-sm font-semibold" style={{ color: '#8C5718' }}>{candidate.blockedReason}</p>}
            </div>
            <button type="button" onClick={() => open(candidate)} disabled={busy !== null || Boolean(candidate.blockedReason)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: 'var(--wd-dark)' }}>
              {candidate.status ? <ArrowUpRight className="h-4 w-4" /> : <FilePenLine className="h-4 w-4" />}
              {busy === candidate.id ? 'Otwieranie…' : candidate.status ? 'Otwórz protokół' : 'Przygotuj protokół'}
            </button>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="border-t border-red-200 px-5 py-3 text-sm font-semibold text-red-800 sm:px-7">{error}</p>}
    </section>
  )
}
