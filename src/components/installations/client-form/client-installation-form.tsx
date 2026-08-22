'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './client-installation-form.module.css'

type AnswerValue = string | string[]
type Question = {
  key: string
  type: 'YES_NO_UNKNOWN' | 'NUMBER' | 'DIMENSION' | 'TEXT' | 'SINGLE' | 'MULTI' | 'FILE'
  label: string
  help?: string
  required?: boolean
  options?: string[]
  condition?: { questionKey: string; equals: string }
}
type Submission = {
  status: 'DRAFT' | 'SUBMITTED'; revisionNumber: number; draftVersion: number; submittedAt: string | null
  answers: Array<{ questionKey: string; value: AnswerValue; isUnknown: boolean }>
}
export type ClientFormProjection = {
  brand: 'WallDecor'; number: string; contact: { label: 'WallDecor'; email: string }
  rooms: Array<{ name: string; scopes: Array<{ name: string; products: Array<{ name: string; code: string | null; manufacturer: string | null; collection: string | null }> }> }>
  form: { templateVersion: number; questions: Question[] }
  submission: Submission
  canStartCorrection: boolean
}

function mapAnswers(submission: Submission): Record<string, AnswerValue> {
  return Object.fromEntries(submission.answers.map((answer) => [answer.questionKey, answer.value]))
}

function visibleQuestions(questions: Question[], answers: Record<string, AnswerValue>) {
  return questions.filter((question) => !question.condition || answers[question.condition.questionKey] === question.condition.equals)
}

function questionGroups(questions: Question[]) {
  if (questions.length <= 4) return [questions]
  const groupCount = Math.ceil(questions.length / 4)
  const baseSize = Math.floor(questions.length / groupCount)
  const extra = questions.length % groupCount
  let cursor = 0
  return Array.from({ length: groupCount }, (_, index) => {
    const group = questions.slice(cursor, cursor + baseSize + (index < extra ? 1 : 0))
    cursor += group.length
    return group
  })
}

function mutationId() {
  return globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function JobMap({ rooms }: Pick<ClientFormProjection, 'rooms'>) {
  return <aside className={styles.map} aria-label="Mapa zlecenia">
    <h2>Mapa zlecenia</h2>
    <p className={styles.mapIntro}>Przejrzyj miejsca i zakresy, których dotyczy rozmowa przed montażem.</p>
    {rooms.length === 0 ? <p className={styles.mapIntro}>Zakres zostanie potwierdzony z opiekunem.</p> : <ul className={styles.roomList}>
      {rooms.map((room) => <li className={styles.room} key={room.name}>
        <span className={styles.roomDot} aria-hidden />
        <span><strong>{room.name}</strong>{room.scopes.map((scope) => <span className={styles.scope} key={scope.name}>{scope.name}{scope.products.length ? ` · ${scope.products.map((product) => product.name).join(', ')}` : ''}</span>)}</span>
      </li>)}
    </ul>}
  </aside>
}

export function ClientInstallationForm({ token, initialProjection }: { token: string; initialProjection: ClientFormProjection }) {
  const [projection, setProjection] = useState(initialProjection)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => mapAnswers(initialProjection.submission))
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const answersRef = useRef(answers)
  const pendingRef = useRef<Record<string, AnswerValue>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submissionRef = useRef(projection.submission)
  const saveLoopRef = useRef<Promise<boolean> | null>(null)
  const visible = useMemo(() => visibleQuestions(projection.form.questions, answers), [projection.form.questions, answers])
  const groups = useMemo(() => questionGroups(visible), [visible])
  const unknownSelected = Object.entries(answers).some(([key, value]) => projection.form.questions.find((question) => question.key === key)?.type === 'YES_NO_UNKNOWN' && value === 'UNKNOWN')

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { submissionRef.current = projection.submission }, [projection.submission])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function adoptSubmission(submission: Submission, preservePending = false) {
    const pendingAnswers = preservePending
      ? Object.fromEntries(Object.keys(pendingRef.current).flatMap((key) => answersRef.current[key] === undefined ? [] : [[key, answersRef.current[key]]]))
      : {}
    const nextAnswers = { ...mapAnswers(submission), ...pendingAnswers }
    submissionRef.current = submission
    setProjection((current) => ({ ...current, submission, canStartCorrection: submission.status === 'SUBMITTED' }))
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
  }

  async function reconcileAfterConflict(): Promise<boolean> {
    const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return false
    const latest = await response.json() as ClientFormProjection
    submissionRef.current = latest.submission
    const pendingAnswers = Object.fromEntries(Object.keys(pendingRef.current).flatMap((key) => answersRef.current[key] === undefined ? [] : [[key, answersRef.current[key]]]))
    answersRef.current = { ...mapAnswers(latest.submission), ...pendingAnswers }
    setProjection(latest)
    setAnswers(answersRef.current)
    return true
  }

  function persist(): Promise<boolean> {
    if (saveLoopRef.current) return saveLoopRef.current
    let drained = false
    const loop = (async () => {
      while (Object.keys(pendingRef.current).length > 0) {
        const submission = submissionRef.current
        if (submission.status !== 'DRAFT') return false
        const sent = Object.fromEntries(Object.entries(pendingRef.current))
        setSaveState('saving'); setError('')
        try {
          const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/autosave`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revisionNumber: submission.revisionNumber, draftVersion: submission.draftVersion, clientMutationId: mutationId(), answers: Object.entries(sent).map(([questionKey, value]) => ({ questionKey, value })) }),
          })
          if (response.status === 409) {
            if (!await reconcileAfterConflict()) throw new Error('Nie udało się pobrać nowszej wersji formularza.')
            continue
          }
          if (!response.ok) throw new Error('Nie udało się zapisać odpowiedzi.')
          const next = await response.json() as Submission
          for (const [key, value] of Object.entries(sent)) if (pendingRef.current[key] === value) delete pendingRef.current[key]
          adoptSubmission(next, true)
        } catch {
          setSaveState('error'); setError('Nie udało się zapisać. Spróbuj ponownie — Twoje odpowiedzi pozostają na ekranie.')
          return false
        }
      }
      drained = true
      setSaveState('saved')
      return true
    })()
    saveLoopRef.current = loop
    void loop.finally(() => {
      if (saveLoopRef.current === loop) saveLoopRef.current = null
      // Continue only after a successful drain to catch a change made in the
      // tiny gap before finalization. Failures keep their pending value and
      // remain visible until the client explicitly chooses retry.
      if (drained && Object.keys(pendingRef.current).length > 0) void persist()
    })
    return loop
  }

  function queueAnswer(questionKey: string, value: AnswerValue) {
    const next = { ...answersRef.current, [questionKey]: value }
    answersRef.current = next
    setAnswers(next)
    pendingRef.current[questionKey] = value
    // A local change is not saved until the queue reaches the server.  Mark it
    // immediately so a debounce window can never claim that a newer answer is
    // already persisted.
    setSaveState('saving'); setError('')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void persist() }, 550)
  }

  async function submit() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!await persist()) return
    const submission = submissionRef.current
    setSubmitting(true); setError('')
    try {
      const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionNumber: submission.revisionNumber, draftVersion: submission.draftVersion, clientMutationId: mutationId() }),
      })
      const data = await response.json() as Submission | { error?: string }
      if (!response.ok) throw new Error('error' in data ? data.error : 'Nie udało się wysłać formularza.')
      adoptSubmission(data as Submission); setSaveState('saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się wysłać formularza.')
    } finally { setSubmitting(false) }
  }

  async function startCorrection() {
    setSubmitting(true); setError('')
    try {
      const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/correction`, { method: 'POST' })
      if (!response.ok) throw new Error('Nie udało się rozpocząć korekty.')
      const draft = await response.json() as Submission
      pendingRef.current = {}; adoptSubmission(draft); setSaveState('saved')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Nie udało się rozpocząć korekty.') } finally { setSubmitting(false) }
  }

  const submitted = projection.submission.status === 'SUBMITTED'
  return <main className={styles.shell}>
    <div className={styles.frame}>
      <p className={styles.kicker}>{projection.brand} · przygotowanie montażu</p>
      <h1 className={styles.title}>Dzień dobry.</h1>
      <p className={styles.lead}>Kilka krótkich odpowiedzi pomoże nam przygotować montaż. W razie niepewności wybierz „Nie wiem” — ustalimy to razem przed terminem.</p>
      <p className={styles.contact}>Kontakt: {projection.contact.label} · <a href={`mailto:${projection.contact.email}`}>{projection.contact.email}</a></p>
      <p className={`${styles.kicker} ${styles.mono}`} style={{ marginTop: 16 }}>{projection.number} · wersja formularza {projection.form.templateVersion}</p>
      <JobMap rooms={projection.rooms} />
      {submitted ? <section className={styles.confirmation} aria-live="polite">
        <strong>Formularz został wysłany.</strong><br />Zapisaliśmy wersję {projection.submission.revisionNumber}. Odpowiedzi wymagające ustalenia omówimy przed montażem.
        <div style={{ marginTop: 12 }}><button type="button" className={styles.secondary} onClick={() => void startCorrection()} disabled={submitting}>Zgłoś korektę</button></div>
      </section> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <section className={styles.section} aria-labelledby="questions-heading">
          <h2 id="questions-heading" className={styles.sectionHeading}>Krótka rozmowa o miejscu montażu</h2>
          <p className={styles.sectionHelp}>Odpowiadaj po kolei. Formularz zapisuje zmiany automatycznie.</p>
          <div className={styles.questions}>{groups.map((group, index) => <div className={styles.questionGroup} key={group.map((question) => question.key).join(':')} aria-label={`Część ${index + 1} formularza`}>
            {group.map((question) => <QuestionControl key={question.key} question={question} value={answers[question.key]} onChange={(value) => queueAnswer(question.key, value)} />)}
          </div>)}</div>
        </section>
        {unknownSelected && <p className={styles.unknown}><strong>Ustalimy przed montażem.</strong> Nie musisz teraz wpisywać przybliżonego wymiaru.</p>}
        <div className={styles.statusRow} role="status" aria-live="polite">
          {saveState === 'saving' && <span className={styles.statusSaving}>Zapisywanie…</span>}
          {saveState === 'saved' && <span className={styles.statusSaved}>Wszystko zapisane</span>}
          {saveState === 'error' && <><span>Wystąpił błąd zapisu.</span><button type="button" className={styles.secondary} onClick={() => void persist()}>Spróbuj ponownie</button></>}
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className={styles.submit} disabled={submitting}>{submitting ? 'Wysyłanie…' : 'Wyślij formularz'}</button>
      </form>}
    </div>
  </main>
}

function QuestionControl({ question, value, onChange }: { question: Question; value: AnswerValue | undefined; onChange: (value: AnswerValue) => void }) {
  if (question.type === 'FILE') return <article className={styles.question} data-testid="task5-file-step" data-task5-replace="private-upload-handoff">
    <strong>{question.label}</strong><p className={styles.fileNotice}>Dokumenty i zdjęcia dodamy w kroku plików. Ten etap nie blokuje teraz wysłania formularza.</p>{/* TASK5_FILE_UPLOAD_REPLACEMENT */}
  </article>
  if (question.type === 'YES_NO_UNKNOWN') return <fieldset className={styles.question}>
    <legend>{question.label}{question.required && <span className={styles.required}>*</span>}</legend>{question.help && <p className={styles.help}>{question.help}</p>}
    <div className={styles.choiceGrid}>{([['YES', 'Tak'], ['NO', 'Nie'], ['UNKNOWN', 'Nie wiem']] as const).map(([choice, label]) => <button type="button" key={choice} className={styles.choice} aria-pressed={value === choice} onClick={() => onChange(choice)}>{label}</button>)}</div>
  </fieldset>
  if (question.type === 'MULTI') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className={styles.question}><legend>{question.label}{question.required && <span className={styles.required}>*</span>}</legend><div className={styles.checkList}>{(question.options ?? []).map((option) => <label className={styles.check} key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{option}</label>)}</div></fieldset>
  }
  if (question.type === 'SINGLE') return <div className={styles.question}><label htmlFor={question.key}>{question.label}{question.required && <span className={styles.required}>*</span>}</label><select id={question.key} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">Wybierz odpowiedź</option>{(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
  const multiline = question.type === 'TEXT'
  return <div className={styles.question}><label htmlFor={question.key}>{question.label}{question.required && <span className={styles.required}>*</span>}</label>{multiline ? <textarea id={question.key} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} /> : <input id={question.key} className={styles.field} inputMode="decimal" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />}</div>
}
