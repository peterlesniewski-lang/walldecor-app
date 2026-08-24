'use client'

import { useRef, useState } from 'react'
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
    {matchingFiles.map((file) => <li key={`${file.formSubmissionId}:${file.questionKey}:${file.originalFilename}`}>{file.originalFilename}</li>)}
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
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const preview = revisions.find((revision) => revision.formSubmissionId === previewedRevisionId) ?? null

  function closePreview() {
    setPreviewedRevisionId(null)
    openerRef.current?.focus()
  }

  if (revisions.length === 0) return null

  return <section className="mt-6 rounded-xl border p-4" aria-labelledby="form-revisions-heading" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30,30,30,.12)', boxShadow: 'var(--card-shadow)' }}>
    <p className="data-label">Historia formularza</p>
    <h2 id="form-revisions-heading" className="mt-1 text-xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>Wersje odpowiedzi klienta</h2>
    <div className="mt-4 grid gap-3">
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
          onClick={(event) => { openerRef.current = event.currentTarget; setPreviewedRevisionId(revision.formSubmissionId) }}
        >
          Podgląd jak klient · wersja {revision.revisionNumber}
        </button>
      </article>)}
    </div>
    {preview && <section className="mt-5 w-full border-t pt-5" aria-label={`Podgląd formularza klienta, wersja ${preview.revisionNumber}`} style={{ borderColor: 'rgba(30,30,30,.12)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold" style={{ color: 'var(--wd-dark)' }}>Podgląd formularza klienta · wersja {preview.revisionNumber}</h3>
        <button type="button" className="min-h-11 rounded-md border px-4 text-sm font-bold" onClick={closePreview}>Zamknij podgląd</button>
      </div>
      <div className="mt-4 grid gap-4">
        {preview.questions.map((question) => {
          const answer = preview.answers.find((candidate) => candidate.questionKey === question.key)
          return <ClientQuestionRenderer
            key={question.key}
            question={question}
            value={answer?.value}
            mode="readonly"
            fileContent={question.type === 'FILE' ? <PreviewFileContent revision={preview} question={question} files={files} /> : undefined}
          />
        })}
      </div>
    </section>}
  </section>
}
