import Link from 'next/link'
import { ArrowLeft, CheckCircle2, CircleAlert, ListTree, ShieldCheck } from 'lucide-react'
import type { InstallationGuide } from '@/lib/installations/guide-catalog'

function updatedLabel(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' })
    .format(new Date(`${value}T12:00:00+02:00`))
}

function sectionId(index: number) {
  return `section-${index + 1}`
}

export function InstallationGuideArticle({ guide }: { guide: InstallationGuide }) {
  return (
    <article className="mx-auto max-w-5xl">
      <Link href="/installations/instrukcje" className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" style={{ color: '#8C5718' }}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Wszystkie instrukcje montaży
      </Link>

      <header className="mt-5 rounded-2xl border px-6 py-7 sm:px-8" style={{ background: 'linear-gradient(135deg, #FCF8F0 0%, #FFFFFF 60%)', borderColor: 'rgba(106, 78, 42, 0.18)', boxShadow: 'var(--card-shadow)' }}>
        <p className="data-label" style={{ color: '#8C5718' }}>{guide.audienceLabel}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: 'var(--wd-dark)' }}>{guide.title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7" style={{ color: 'var(--wd-text-muted)' }}>{guide.summary}</p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: '#F4EBDD', color: '#70420B' }}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Aktualizacja instrukcji: {updatedLabel(guide.updatedAt)}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border p-4 lg:sticky lg:top-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)' }} aria-label="Spis treści">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--wd-dark)' }}><ListTree className="h-4 w-4" style={{ color: '#8C5718' }} aria-hidden="true" /> Spis treści</div>
          <ol className="mt-3 space-y-2 text-sm">
            {guide.sections.map((section, index) => <li key={section.title}><a className="leading-5 underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={`#${sectionId(index)}`} style={{ color: '#6A5237' }}>{section.title}</a></li>)}
          </ol>
        </aside>

        <div className="space-y-5">
          {guide.sections.map((section, index) => (
            <section id={sectionId(index)} key={section.title} className="scroll-mt-6 rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: '0 1px 2px rgba(30, 30, 30, 0.04)' }}>
              <h2 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>{section.title}</h2>
              {section.introduction && <p className="mt-2 text-sm leading-6" style={{ color: 'var(--wd-text-muted)' }}>{section.introduction}</p>}
              <ol className="mt-5 space-y-3">
                {section.steps.map((step, stepIndex) => (
                  <li className="flex gap-3 text-sm leading-6" key={step}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold" style={{ background: '#F4EBDD', color: '#70420B' }}>{stepIndex + 1}</span>
                    <span style={{ color: 'var(--wd-dark)' }}>{step}</span>
                  </li>
                ))}
              </ol>
              {section.attention && <p className="mt-5 flex gap-2 rounded-xl border px-3 py-3 text-sm leading-6" style={{ background: '#FFF8E8', borderColor: '#E7CCA0', color: '#6E4811' }}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{section.attention}</p>}
            </section>
          ))}

          <div className="rounded-xl border p-4 text-sm leading-6" style={{ background: '#F5F1EB', borderColor: 'rgba(30, 30, 30, 0.1)', color: 'var(--wd-text-muted)' }}>
            <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--wd-dark)' }}><CheckCircle2 className="h-4 w-4" style={{ color: '#4E7A56' }} aria-hidden="true" /> Gdy instrukcja nie odpowiada na sytuację</div>
            <p className="mt-1">Zapisz fakt na karcie montażu i skonsultuj kolejne działanie z opiekunem lub administratorem. Nie rozwiązuj wątpliwości przez zmianę danych klienta poza aplikacją.</p>
          </div>
        </div>
      </div>
    </article>
  )
}
