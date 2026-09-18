'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ClientQuestionRenderer } from './client-form/question-renderer'
import type { HistoricalAnswerView } from '@/lib/installations/form-history'
import type { FormQuestion } from '@/lib/installations/form-visibility'

export type InstallationFormRevisionView = {
  formSubmissionId: string
  revisionNumber: number
  status: string
  submittedAt: Date | string | null
  templateVersion: number
  questions: FormQuestion[]
  answers: HistoricalAnswerView[]
}

export type InstallationFormRevisionFile = {
  id: string
  formSubmissionId: string | null
  questionKey: string | null
  originalFilename: string
  status: string
  softDeletedAt: Date | string | null
}

function submissionDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleString('pl-PL') : 'szkic bez daty wysłania'
}

function PreviewFileContent({ revision, question, files }: {
  revision: InstallationFormRevisionView
  question: FormQuestion
  files: readonly InstallationFormRevisionFile[]
}) {
  const matchingFiles = files.filter((file) =>
    file.formSubmissionId === revision.formSubmissionId &&
    file.questionKey === question.key &&
    file.status === 'READY' &&
    file.softDeletedAt === null,
  )
  if (matchingFiles.length === 0) {
    return <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Pliki są zapisane w sekcji dokumentów</p>
  }
  return <ul className="mt-2 list-disc pl-5 text-sm" aria-label={`Pliki: ${question.label}`}>
    {matchingFiles.map((file) => <li key={file.id}>{file.originalFilename}</li>)}
  </ul>
}

export function InstallationFormRevisionPanel({
  revisions,
  files = [],
}: {
  revisions: InstallationFormRevisionView[]
  files?: InstallationFormRevisionFile[]
}) {
  const [previewedRevisionId, setPreviewedRevisionId] = useState<string | null>(null)
  const panelId = useId()
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const closePreviewRef = useRef<HTMLButtonElement | null>(null)
  const preview = revisions.find((revision) => revision.formSubmissionId === previewedRevisionId) ?? null
  const previewId = (formSubmissionId: string) => `form-revision-preview-${panelId}-${formSubmissionId}`
  const latest = [...revisions].filter((revision) => revision.status === 'SUBMITTED').sort((a, b) => b.revisionNumber - a.revisionNumber)[0]

  useEffect(() => {
    if (previewedRevisionId) closePreviewRef.current?.focus()
  }, [previewedRevisionId])

  function closePreview() {
    setPreviewedRevisionId(null)
    openerRef.current?.focus()
  }

  if (revisions.length === 0) return null

  return <section className="mt-6 rounded-xl border p-4" aria-labelledby="form-revisions-heading" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <h3 id="form-revisions-heading" className="font-bold" style={{ color: 'var(--wd-dark)' }}>Odpowiedzi klienta</h3>
    {latest && <div className="mt-3"><p className="text-sm">Wypełniony · wersja {latest.revisionNumber} · {submissionDate(latest.submittedAt)}</p><button type="button" className="mt-2 min-h-11 rounded-md border px-4 text-sm font-bold" aria-expanded={previewedRevisionId === latest.formSubmissionId} aria-controls={previewId(latest.formSubmissionId)} onClick={(event) => { openerRef.current = event.currentTarget; setPreviewedRevisionId(latest.formSubmissionId) }}>Zobacz odpowiedzi klienta</button></div>}
    {revisions.some((revision) => revision.status !== 'SUBMITTED') && <p className="mt-2 text-sm">{latest ? 'Klient rozpoczął korektę — nie została jeszcze wysłana.' : 'Klient rozpoczął wypełnianie — formularz nie został jeszcze wysłany.'}</p>}
    <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Historia odpowiedzi</summary><div className="mt-4 grid gap-3">
      {revisions.map((revision) => <article key={revision.formSubmissionId} className="rounded-lg border p-3" style={{ borderColor: 'rgba(30,30,30,.12)', background: '#FAFAF8' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold">Wersja {revision.revisionNumber} · {revision.status === 'SUBMITTED' ? 'wysłana' : 'szkic'}</p>
          <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{submissionDate(revision.submittedAt)}</p>
        </div>
        {revision.answers.length > 0 ? <dl className="mt-3 grid gap-2 text-sm">
          {revision.answers.map((answer) => <div key={answer.questionKey} className="grid gap-1 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-3">
            <dt className="font-semibold" style={{ color: 'var(--wd-dark)' }}>{answer.label}</dt>
            <dd>{answer.displayValue}</dd>
          </div>)}
        </dl> : <p className="mt-3 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak zapisanych odpowiedzi.</p>}
        <button
          type="button"
          className="mt-4 min-h-11 w-full rounded-md border px-4 text-sm font-bold"
          aria-expanded={previewedRevisionId === revision.formSubmissionId}
          aria-controls={previewId(revision.formSubmissionId)}
          onClick={(event) => { openerRef.current = event.currentTarget; setPreviewedRevisionId(revision.formSubmissionId) }}
        >
          Podgląd jak klient · wersja {revision.revisionNumber}
        </button>
      </article>)}
    </div></details>
    {preview && <section id={previewId(preview.formSubmissionId)} className="mt-5 w-full border-t pt-5" aria-label={`Podgląd formularza klienta, wersja ${preview.revisionNumber}`} style={{ borderColor: 'rgba(30,30,30,.12)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold" style={{ color: 'var(--wd-dark)' }}>Podgląd formularza klienta · wersja {preview.revisionNumber}</h3>
        <button ref={closePreviewRef} type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={closePreview}>Zamknij podgląd</button>
      </div>
      <div className="mt-4 grid gap-4">
        {preview.questions.map((question) => {
          const answer = preview.answers.find((candidate) => candidate.questionKey === question.key)
          return <ClientQuestionRenderer
            key={question.key}
            question={question}
            questions={preview.questions}
            value={answer?.value}
            mode="readonly"
            fileContent={question.type === 'FILE' ? <PreviewFileContent revision={preview} question={question} files={files} /> : undefined}
          />
        })}
      </div>
    </section>}
  </section>
}
