'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './client-installation-form.module.css'

type AnswerValue = string | string[]
type PendingAnswerValue = AnswerValue | null
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
  visitFee: null | {
    grossAmount: string
    clauseText: string
    clauseVersion: number
    snapshotDigest: string
    clientAcceptedAt: string | null
  }
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

type AutosaveAttempt = {
  revisionNumber: number
  draftVersion: number
  clientMutationId: string
  answers: Record<string, PendingAnswerValue>
}

type SubmitAttempt = Omit<AutosaveAttempt, 'answers'> & { visitFeeAccepted?: true; visitFeeSnapshotDigest?: string }

function isEmptyAnswer(value: PendingAnswerValue) {
  return value === null || (Array.isArray(value) && value.length === 0)
}

function sameAnswerValue(left: PendingAnswerValue | undefined, right: PendingAnswerValue) {
  if (left === right) return true
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])
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
  const [visitFeeAccepted, setVisitFeeAccepted] = useState(Boolean(initialProjection.visitFee?.clientAcceptedAt))
  const answersRef = useRef(answers)
  const pendingRef = useRef<Record<string, PendingAnswerValue>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submissionRef = useRef(projection.submission)
  const saveLoopRef = useRef<Promise<boolean> | null>(null)
  const autosaveAttemptRef = useRef<AutosaveAttempt | null>(null)
  const submitAttemptRef = useRef<SubmitAttempt | null>(null)
  const correctionMutationIdRef = useRef<string | null>(null)
  const visible = useMemo(() => visibleQuestions(projection.form.questions, answers), [projection.form.questions, answers])
  const groups = useMemo(() => questionGroups(visible), [visible])
  const unknownSelected = Object.entries(answers).some(([key, value]) => projection.form.questions.find((question) => question.key === key)?.type === 'YES_NO_UNKNOWN' && value === 'UNKNOWN')

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { submissionRef.current = projection.submission }, [projection.submission])
  // A 409 may refresh this screen with any different legal snapshot field.
  // In that case the customer must explicitly tick the confirmation again;
  // only a persisted acceptance can carry state between fee snapshots.
  useEffect(() => { setVisitFeeAccepted(Boolean(projection.visitFee?.clientAcceptedAt)) }, [
    projection.visitFee?.grossAmount,
    projection.visitFee?.clauseVersion,
    projection.visitFee?.snapshotDigest,
    projection.visitFee?.clientAcceptedAt,
  ])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function adoptSubmission(submission: Submission, preservePending = false) {
    const pendingAnswers = preservePending
      ? Object.fromEntries(Object.entries(pendingRef.current).flatMap(([key, value]) => value === null ? [] : [[key, value]]))
      : {}
    const nextAnswers = { ...mapAnswers(submission), ...pendingAnswers }
    submissionRef.current = submission
    setProjection((current) => ({ ...current, submission, canStartCorrection: submission.status === 'SUBMITTED' }))
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
  }

  async function reloadLatestProjection(): Promise<ClientFormProjection | null> {
    const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return null
    const latest = await response.json() as ClientFormProjection
    if (!latest?.submission) return null
    submissionRef.current = latest.submission
    const pendingAnswers = Object.fromEntries(Object.entries(pendingRef.current).flatMap(([key, value]) => value === null ? [] : [[key, value]]))
    answersRef.current = { ...mapAnswers(latest.submission), ...pendingAnswers }
    setProjection(latest)
    setAnswers(answersRef.current)
    return latest
  }

  function autosaveWasApplied(submission: Submission, attempt: AutosaveAttempt) {
    if (submission.status !== 'DRAFT' || submission.revisionNumber !== attempt.revisionNumber || submission.draftVersion < attempt.draftVersion + 1) return false
    const saved = mapAnswers(submission)
    return Object.entries(attempt.answers).every(([key, value]) =>
      isEmptyAnswer(value) ? saved[key] === undefined : sameAnswerValue(saved[key], value),
    )
  }

  function acknowledgeAutosave(attempt: AutosaveAttempt) {
    for (const [key, value] of Object.entries(attempt.answers)) {
      if (sameAnswerValue(pendingRef.current[key], value)) delete pendingRef.current[key]
    }
  }

  function persist(): Promise<boolean> {
    if (saveLoopRef.current) return saveLoopRef.current
    let drained = false
    const loop = (async () => {
      while (Object.keys(pendingRef.current).length > 0 || autosaveAttemptRef.current) {
        if (!autosaveAttemptRef.current) {
          const submission = submissionRef.current
          if (submission.status !== 'DRAFT') return false
          autosaveAttemptRef.current = {
            revisionNumber: submission.revisionNumber,
            draftVersion: submission.draftVersion,
            clientMutationId: mutationId(),
            answers: { ...pendingRef.current },
          }
        }
        const attempt = autosaveAttemptRef.current
        setSaveState('saving'); setError('')
        try {
          const response = await fetch('/api/public/installations/' + encodeURIComponent(token) + '/autosave', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revisionNumber: attempt.revisionNumber, draftVersion: attempt.draftVersion, clientMutationId: attempt.clientMutationId, answers: Object.entries(attempt.answers).map(([questionKey, value]) => ({ questionKey, value })) }),
          })
          if (response.status === 409) {
            const latest = await reloadLatestProjection()
            if (!latest) throw new Error('Nie udało się pobrać nowszej wersji formularza.')
            if (autosaveWasApplied(latest.submission, attempt)) acknowledgeAutosave(attempt)
            autosaveAttemptRef.current = null
            continue
          }
          if (!response.ok) throw new Error('Nie udało się zapisać odpowiedzi.')
          const next = await response.json() as Submission
          acknowledgeAutosave(attempt)
          autosaveAttemptRef.current = null
          adoptSubmission(next, true)
        } catch {
          const latest = await reloadLatestProjection().catch(() => null)
          if (latest && autosaveWasApplied(latest.submission, attempt)) {
            acknowledgeAutosave(attempt)
            autosaveAttemptRef.current = null
            continue
          }
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

  function queueAnswer(questionKey: string, value: PendingAnswerValue) {
    const next = { ...answersRef.current }
    if (value === null) delete next[questionKey]
    else next[questionKey] = value
    answersRef.current = next
    setAnswers(next)
    pendingRef.current[questionKey] = value
    submitAttemptRef.current = null
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
    const attempt = submitAttemptRef.current ?? {
      revisionNumber: submission.revisionNumber,
      draftVersion: submission.draftVersion,
      clientMutationId: mutationId(),
      ...(projection.visitFee && !projection.visitFee.clientAcceptedAt && visitFeeAccepted ? {
        visitFeeAccepted: true as const,
        visitFeeSnapshotDigest: projection.visitFee.snapshotDigest,
      } : {}),
    }
    submitAttemptRef.current = attempt
    setSubmitting(true); setError('')
    try {
      const response = await fetch('/api/public/installations/' + encodeURIComponent(token) + '/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt),
      })
      const data = await response.json() as Submission | { error?: string }
      if (!response.ok) {
        const message = 'error' in data && typeof data.error === 'string' ? data.error : 'Nie udało się wysłać formularza.'
        // A concrete 4xx means this exact request did not commit. Rebase on
        // the current draft and deliberately start a new logical submit only
        // when the customer clicks again. Transport failures remain below.
        if (response.status >= 400 && response.status < 500) {
          const latest = await reloadLatestProjection().catch(() => null)
          if (latest?.submission.status === 'SUBMITTED' && latest.submission.revisionNumber === attempt.revisionNumber) {
            submitAttemptRef.current = null
            setSaveState('saved')
            return
          }
          submitAttemptRef.current = null
          setError(response.status === 409
            ? 'Formularz został zapisany w nowszej wersji. Odświeżyliśmy dane — sprawdź je i spróbuj ponownie.'
            : message)
          return
        }
        throw new Error(message)
      }
      submitAttemptRef.current = null
      adoptSubmission(data as Submission); setSaveState('saved')
    } catch (caught) {
      const latest = await reloadLatestProjection().catch(() => null)
      if (latest?.submission.status === 'SUBMITTED' && latest.submission.revisionNumber === attempt.revisionNumber) {
        submitAttemptRef.current = null
        setSaveState('saved')
        return
      }
      setError(caught instanceof Error ? caught.message : 'Nie udało się wysłać formularza.')
    } finally { setSubmitting(false) }
  }

  async function startCorrection() {
    setSubmitting(true); setError('')
    const clientMutationId = correctionMutationIdRef.current ?? mutationId()
    correctionMutationIdRef.current = clientMutationId
    try {
      const response = await fetch('/api/public/installations/' + encodeURIComponent(token) + '/correction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientMutationId }),
      })
      if (!response.ok) throw new Error('Nie udało się rozpocząć korekty.')
      const draft = await response.json() as Submission
      correctionMutationIdRef.current = null
      pendingRef.current = {}; adoptSubmission(draft); setSaveState('saved')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Nie udało się rozpocząć korekty.') } finally { setSubmitting(false) }
  }

  async function acceptVisitFee() {
    const fee = projection.visitFee
    if (!fee || fee.clientAcceptedAt || !visitFeeAccepted) return
    setSubmitting(true); setError('')
    try {
      const response = await fetch('/api/public/installations/' + encodeURIComponent(token) + '/accept-visit-fee', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, snapshotDigest: fee.snapshotDigest }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null
        if (response.status === 409) await reloadLatestProjection()
        throw new Error(data?.error ?? 'Nie udało się potwierdzić informacji o opłacie.')
      }
      const refreshed = await response.json() as ClientFormProjection
      submissionRef.current = refreshed.submission
      setProjection(refreshed)
      setAnswers(mapAnswers(refreshed.submission))
      setVisitFeeAccepted(Boolean(refreshed.visitFee?.clientAcceptedAt))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się potwierdzić informacji o opłacie.')
    } finally { setSubmitting(false) }
  }

  const submitted = projection.submission.status === 'SUBMITTED'
  const requiresVisitFeeAcceptance = Boolean(projection.visitFee && !projection.visitFee.clientAcceptedAt)
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
        {projection.visitFee && <section className={styles.fee} aria-labelledby="visit-fee-heading">
          <p className={styles.feeKicker}>Do potwierdzenia przed montażem</p>
          <h2 id="visit-fee-heading">Informacja o ewentualnej opłacie za podjazd</h2>
          <p className={styles.feeAmount}><strong>{projection.visitFee.grossAmount.replace('.', ',')} zł brutto</strong></p>
          <p className={styles.feeClause}>{projection.visitFee.clauseText}</p>
          {projection.visitFee.clientAcceptedAt ? <p className={styles.feeAccepted}>Informację o opłacie potwierdzono.</p> : <>
            <label className={styles.feeCheck}>
              <input type="checkbox" checked={visitFeeAccepted} onChange={(event) => setVisitFeeAccepted(event.target.checked)} />
              <span>Akceptuję informację o opłacie w dokładnej kwocie {projection.visitFee.grossAmount.replace('.', ',')} zł brutto.</span>
            </label>
            <button type="button" className={styles.submit} disabled={submitting || !visitFeeAccepted} onClick={() => void acceptVisitFee()}>{submitting ? 'Potwierdzanie…' : 'Potwierdź informację o opłacie'}</button>
          </>}
        </section>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <section className={styles.section} aria-labelledby="questions-heading">
          <h2 id="questions-heading" className={styles.sectionHeading}>Krótka rozmowa o miejscu montażu</h2>
          <p className={styles.sectionHelp}>Odpowiadaj po kolei. Formularz zapisuje zmiany automatycznie.</p>
          <div className={styles.questions}>{groups.map((group, index) => <div className={styles.questionGroup} key={group.map((question) => question.key).join(':')} aria-label={`Część ${index + 1} formularza`}>
            {group.map((question) => <QuestionControl key={question.key} token={token} question={question} value={answers[question.key]} loadExistingFiles={projection.submission.revisionNumber > 1} onChange={(value) => queueAnswer(question.key, value)} />)}
          </div>)}</div>
        </section>
        {unknownSelected && <p className={styles.unknown}><strong>Ustalimy przed montażem.</strong> Nie musisz teraz wpisywać przybliżonego wymiaru.</p>}
        {projection.visitFee && <section className={styles.fee} aria-labelledby="visit-fee-heading">
          <p className={styles.feeKicker}>Przed wysłaniem</p>
          <h2 id="visit-fee-heading">Informacja o ewentualnej opłacie za podjazd</h2>
          <p className={styles.feeAmount}><strong>{projection.visitFee.grossAmount.replace('.', ',')} zł brutto</strong></p>
          <p className={styles.feeClause}>{projection.visitFee.clauseText}</p>
          {projection.visitFee.clientAcceptedAt ? <p className={styles.feeAccepted}>Informację potwierdzono wraz z formularzem.</p> : <label className={styles.feeCheck}>
            <input
              type="checkbox"
              checked={visitFeeAccepted}
              onChange={(event) => {
                setVisitFeeAccepted(event.target.checked)
                submitAttemptRef.current = null
              }}
            />
            <span>Akceptuję informację o opłacie w dokładnej kwocie {projection.visitFee.grossAmount.replace('.', ',')} zł brutto.</span>
          </label>}
        </section>}
        <div className={styles.statusRow} role="status" aria-live="polite">
          {saveState === 'saving' && <span className={styles.statusSaving}>Zapisywanie…</span>}
          {saveState === 'saved' && <span className={styles.statusSaved}>Wszystko zapisane</span>}
          {saveState === 'error' && <><span>Wystąpił błąd zapisu.</span><button type="button" className={styles.secondary} onClick={() => void persist()}>Spróbuj ponownie</button></>}
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className={styles.submit} disabled={submitting || (requiresVisitFeeAcceptance && !visitFeeAccepted)}>{submitting ? 'Wysyłanie…' : 'Wyślij formularz'}</button>
      </form>}
    </div>
  </main>
}

function OptionalClear({ question, value, onChange }: { question: Question; value: AnswerValue | undefined; onChange: (value: PendingAnswerValue) => void }) {
  if (question.required || value === undefined) return null
  return <button type="button" className={styles.secondary} aria-label={'Wyczyść odpowiedź: ' + question.label} onClick={() => onChange(null)}>Wyczyść odpowiedź</button>
}

function ClientFileControl({ token, question, loadExistingFiles }: { token: string; question: Question; loadExistingFiles: boolean }) {
  const [files, setFiles] = useState<Array<{ id: string; originalFilename: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [handoff, setHandoff] = useState<null | { id: string; qrSvg: string; expiresAt: string }>(null)

  const refreshFiles = useCallback(async () => {
    const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/files?questionKey=${encodeURIComponent(question.key)}`, { cache: 'no-store' })
    if (!response.ok) return false
    const data = await response.json() as { files?: Array<{ id: string; originalFilename: string }> }
    setFiles(data.files ?? [])
    return true
  }, [question.key, token])

  // A FILE control can mount with files inherited from a submitted revision
  // after the customer explicitly opens a correction. Load them without
  // requiring a new QR handoff or a duplicate upload.
  useEffect(() => { if (loadExistingFiles) void refreshFiles() }, [loadExistingFiles, refreshFiles])

  useEffect(() => {
    if (!handoff) return
    let stopped = false
    const poll = () => { void refreshFiles().then((ok) => { if (!ok && !stopped) setMessage('Nie udało się odświeżyć listy plików.') }) }
    poll()
    const interval = window.setInterval(poll, 2_500)
    return () => { stopped = true; window.clearInterval(interval) }
  }, [handoff, refreshFiles]) // Polling exists only during a live desktop-to-phone handoff.

  async function upload(file: File | undefined) {
    if (!file || uploading) return
    setUploading(true); setMessage('Dodajemy plik…')
    const data = new FormData()
    data.set('questionKey', question.key)
    data.set('file', file)
    try {
      const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/files`, { method: 'POST', body: data })
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(result?.error ?? 'Nie udało się dodać pliku.')
      }
      await refreshFiles()
      setMessage('Plik został dodany.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się dodać pliku.')
    } finally { setUploading(false) }
  }

  async function createHandoff() {
    setMessage('Przygotowujemy kod dla telefonu…')
    try {
      const response = await fetch(`/api/public/installations/${encodeURIComponent(token)}/handoffs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionKey: question.key }),
      })
      if (!response.ok) throw new Error('Nie udało się przygotować kodu dla telefonu.')
      const result = await response.json() as { handoffId: string; qrSvg: string; expiresAt: string }
      setHandoff({ id: result.handoffId, qrSvg: result.qrSvg, expiresAt: result.expiresAt })
      setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się przygotować kodu dla telefonu.') }
  }

  async function stopHandoff() {
    const current = handoff
    if (!current) return
    setHandoff(null)
    await fetch(`/api/public/installations/${encodeURIComponent(token)}/handoffs/${encodeURIComponent(current.id)}`, { method: 'DELETE' }).catch(() => undefined)
  }

  return <article className={styles.question}>
    <strong>{question.label}{question.required && <span className={styles.required}>*</span>}</strong>
    {question.help && <p className={styles.help}>{question.help}</p>}
    <p className={styles.fileNotice}>Dodaj plik, jeśli go masz. Zdjęcie można też przekazać z telefonu — nie musisz robić go teraz.</p>
    <label className={styles.filePicker}>
      <span>{uploading ? 'Dodawanie pliku…' : 'Wybierz plik'}</span>
      <input aria-label={`Dodaj plik: ${question.label}`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading} onChange={(event) => void upload(event.currentTarget.files?.[0])} />
    </label>
    <button type="button" className={styles.secondary} disabled={uploading || Boolean(handoff)} onClick={() => void createHandoff()}>Dodaj z telefonu</button>
    {handoff && <section className={styles.handoff} aria-label={`Kod telefonu: ${question.label}`}>
      <img className={styles.qr} alt="Kod QR do dodania pliku z telefonu" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(handoff.qrSvg)}`} />
      <div><strong>Otwórz aparat telefonu i zeskanuj kod.</strong><p>Po dodaniu pliku lista odświeży się automatycznie. Kod jest ważny do {new Date(handoff.expiresAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.</p><button type="button" className={styles.secondary} onClick={() => void stopHandoff()}>Zakończ przekazanie</button></div>
    </section>}
    {files.length > 0 && <ul className={styles.fileList} aria-label={`Dodane pliki: ${question.label}`}>{files.map((file) => <li key={file.id}>{file.originalFilename}</li>)}</ul>}
    {message && <p className={styles.fileMessage} role="status">{message}</p>}
  </article>
}

function QuestionControl({ token, question, value, loadExistingFiles, onChange }: { token: string; question: Question; value: AnswerValue | undefined; loadExistingFiles: boolean; onChange: (value: PendingAnswerValue) => void }) {
  if (question.type === 'FILE') return <ClientFileControl token={token} question={question} loadExistingFiles={loadExistingFiles} />
  if (question.type === 'YES_NO_UNKNOWN') return <fieldset className={styles.question}>
    <legend>{question.label}{question.required && <span className={styles.required}>*</span>}</legend>{question.help && <p className={styles.help}>{question.help}</p>}
    <div className={styles.choiceGrid}>{([['YES', 'Tak'], ['NO', 'Nie'], ['UNKNOWN', 'Nie wiem']] as const).map(([choice, label]) => <button type="button" key={choice} className={styles.choice} aria-pressed={value === choice} onClick={() => onChange(choice)}>{label}</button>)}</div>
    <OptionalClear question={question} value={value} onChange={onChange} />
  </fieldset>
  if (question.type === 'MULTI') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className={styles.question}><legend>{question.label}{question.required && <span className={styles.required}>*</span>}</legend><div className={styles.checkList}>{(question.options ?? []).map((option) => <label className={styles.check} key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{option}</label>)}</div><OptionalClear question={question} value={value} onChange={onChange} /></fieldset>
  }
  if (question.type === 'SINGLE') return <div className={styles.question}><label htmlFor={question.key}>{question.label}{question.required && <span className={styles.required}>*</span>}</label><select id={question.key} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)}><option value="">Wybierz odpowiedź</option>{(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select><OptionalClear question={question} value={value} onChange={onChange} /></div>
  const multiline = question.type === 'TEXT'
  return <div className={styles.question}><label htmlFor={question.key}>{question.label}{question.required && <span className={styles.required}>*</span>}</label>{multiline ? <textarea id={question.key} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)} /> : <input id={question.key} className={styles.field} inputMode="decimal" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)} />}<OptionalClear question={question} value={value} onChange={onChange} /></div>
}
