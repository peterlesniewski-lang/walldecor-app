import Link from 'next/link'
import { ArrowRight, BookMarked, ShieldCheck, UserRoundCheck, Wrench } from 'lucide-react'
import type { InstallationGuide } from '@/lib/installations/guide-catalog'

const audienceIcon = {
  COORDINATOR: UserRoundCheck,
  INSTALLER: Wrench,
  ADMIN: ShieldCheck,
} as const

function updatedLabel(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' })
    .format(new Date(`${value}T12:00:00+02:00`))
}

export function InstallationGuideList({ guides }: { guides: InstallationGuide[] }) {
  return (
    <section className="mx-auto max-w-6xl" aria-labelledby="installation-guides-heading">
      <div className="rounded-2xl border px-6 py-7 sm:px-8" style={{ background: 'linear-gradient(135deg, #FCF8F0 0%, #FFFFFF 60%)', borderColor: 'rgba(106, 78, 42, 0.18)', boxShadow: 'var(--card-shadow)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="data-label" style={{ color: '#8C5718' }}>Montaże · pomoc w pracy</p>
            <h1 id="installation-guides-heading" className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>
              Instrukcje montaży
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: 'var(--wd-text-muted)' }}>
              Krótkie, aktualne procedury do pracy na karcie — dostępne według roli, bez wyszukiwania w ogólnej Wiki.
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: '#E9D7BA', color: '#70420B' }} aria-hidden="true">
            <BookMarked className="h-5 w-5" />
          </div>
        </div>
      </div>

      {guides.length === 0 ? (
        <div className="mt-5 rounded-2xl border px-6 py-10 text-center" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--wd-dark)' }}>Brak instrukcji dla tego konta</h2>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Jeśli jesteś instalatorem, poproś administratora o sprawdzenie aktywnego powiązania konta z pracownikiem.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {guides.map((guide) => {
            const Icon = audienceIcon[guide.audience]
            return (
              <Link
                key={guide.slug}
                href={`/installations/instrukcje/${guide.slug}`}
                className="group rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: '0 1px 2px rgba(30, 30, 30, 0.04)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold" style={{ background: '#F4EBDD', color: '#70420B' }}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {guide.audienceLabel}
                  </span>
                  <ArrowRight className="mt-1 h-5 w-5 transition group-hover:translate-x-1" style={{ color: '#8C5718' }} aria-hidden="true" />
                </div>
                <h2 className="mt-5 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>{guide.title}</h2>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--wd-text-muted)' }}>{guide.summary}</p>
                <p className="mt-5 border-t pt-3 text-xs" style={{ borderColor: 'rgba(30, 30, 30, 0.08)', color: 'var(--wd-text-muted)' }}>
                  Aktualizacja: {updatedLabel(guide.updatedAt)}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
