'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormQuestion } from '@/lib/installations/form-visibility'
import { buildQuestionForest, flattenQuestionForest, nextQuestionKey, questionSubtreeKeys, removeQuestionSubtree, moveQuestionWithinBranch, appendQuestionAtPlacement, type QuestionPlacement, type QuestionTreeBranch, type QuestionTreeNode } from '@/lib/installations/question-tree'
import { validateInstallationQuestionDefinitions } from '@/lib/installations/question-schema'
import { TemplateQuestionEditor, templateQuestionRiskLabels, templateQuestionTypeLabels } from './template-question-editor'
import { TemplateTestPreview } from './template-test-preview'

export type TemplatePathDesignerProps = {
  draftId?: string
  questions: readonly FormQuestion[]
  busy: boolean
  onPersist: (questions: FormQuestion[]) => Promise<void>
  onDraftStatusChange?: (draftId: string, status: TemplateDraftStatus) => void
}

export type TemplateDraftStatus = {
  publishable: boolean
  dirty: boolean
}

type EditingState = {
  initial?: FormQuestion
  placement: QuestionPlacement
  nextKey?: string
}

const riskTone: Record<NonNullable<FormQuestion['riskLevel']>, string> = {
  LOW: 'wd-template-pill--low',
  MEDIUM: 'wd-template-pill--medium',
  HIGH: 'wd-template-pill--high',
}

function descendantsLabel(count: number): string {
  if (count === 1) return 'pytanie podrzędne'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'pytania podrzędne'
    : 'pytań podrzędnych'
}

function validateDraft(questions: readonly FormQuestion[]) {
  if (questions.length === 0) return false
  try {
    const validated = validateInstallationQuestionDefinitions('draft', questions)
    return buildQuestionForest(validated).detached.length === 0
  } catch {
    return false
  }
}

function validationMessage(questions: readonly FormQuestion[], detachedCount: number) {
  if (questions.length === 0) return 'Dodaj pierwsze pytanie, aby zbudować mapę i uruchomić próbę.'
  if (detachedCount > 0) {
    const label = detachedCount === 1 ? 'pytanie' : detachedCount % 10 >= 2 && detachedCount % 10 <= 4 && (detachedCount % 100 < 12 || detachedCount % 100 > 14) ? 'pytania' : 'pytań'
    return `Nie można ułożyć pełnej ścieżki: ${detachedCount} ${label} nie ma prawidłowego rodzica lub odpowiedzi.`
  }
  return 'Nie można przetestować ani opublikować szkicu, dopóki pytania nie przejdą walidacji.'
}

export function TemplatePathDesigner({ draftId = 'local-draft', questions, busy, onPersist, onDraftStatusChange }: TemplatePathDesignerProps) {
  const [localQuestions, setLocalQuestions] = useState<FormQuestion[]>(() => [...questions])
  const [isSynced, setIsSynced] = useState(true)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [deleteKey, setDeleteKey] = useState<string | null>(null)
  const [view, setView] = useState<'design' | 'test'>('design')
  const [error, setError] = useState('')
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const confirmationRef = useRef<HTMLDivElement>(null)
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null)
  const rootActionRef = useRef<HTMLButtonElement | null>(null)
  const designerRef = useRef<HTMLElement | null>(null)
  const retryActionRef = useRef<HTMLButtonElement | null>(null)
  const shouldFocusRetryAfterFailedDelete = useRef(false)

  // The designer keeps a recoverable local draft while a failed PATCH is retried.
  // This synchronizes only incoming catalog updates, including a draft switch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalQuestions([...questions])
    setIsSynced(true)
    setEditing(null)
    setDeleteKey(null)
    setView('design')
    setError('')
    setCollapsedKeys(new Set())
  }, [questions])
  useEffect(() => {
    if (deleteKey) confirmationRef.current?.focus()
  }, [deleteKey])
  useEffect(() => {
    if (shouldFocusRetryAfterFailedDelete.current && !isSynced && deleteKey === null && error) {
      retryActionRef.current?.focus()
      shouldFocusRetryAfterFailedDelete.current = false
    }
  }, [deleteKey, error, isSynced])

  const forest = useMemo(() => buildQuestionForest(localQuestions), [localQuestions])
  const canUseDraft = useMemo(() => validateDraft(localQuestions), [localQuestions])
  const invalidMessage = validationMessage(localQuestions, forest.detached.length)
  const hasDuplicateKeys = useMemo(() => {
    const seenKeys = new Set<string>()
    return localQuestions.some((question) => {
      if (seenKeys.has(question.key)) return true
      seenKeys.add(question.key)
      return false
    })
  }, [localQuestions])

  useEffect(() => {
    onDraftStatusChange?.(draftId, { publishable: canUseDraft && isSynced, dirty: !isSynced })
  }, [canUseDraft, draftId, isSynced, onDraftStatusChange])

  async function persist(next: FormQuestion[]) {
    setLocalQuestions(next)
    setIsSynced(false)
    setError('')
    onDraftStatusChange?.(draftId, { publishable: false, dirty: true })
    try {
      await onPersist(next)
      setIsSynced(true)
      onDraftStatusChange?.(draftId, { publishable: validateDraft(next), dirty: false })
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : 'Nie udało się zapisać zmian. Spróbuj ponownie.')
      throw persistError
    }
  }

  function addQuestion(placement: QuestionPlacement) {
    setError('')
    setEditing({ placement, nextKey: nextQuestionKey(localQuestions) })
  }

  async function saveQuestion(question: FormQuestion) {
    const next = editing?.initial
      ? flattenQuestionForest(buildQuestionForest(localQuestions)).map((item) => item.key === editing.initial?.key ? question : item)
      : appendQuestionAtPlacement(localQuestions, question, editing?.placement ?? { parentKey: null, equals: null })
    await persist(next)
    setEditing(null)
  }

  async function moveQuestion(key: string, direction: 'UP' | 'DOWN') {
    try { await persist(moveQuestionWithinBranch(localQuestions, key, direction)) } catch { /* message remains visible and the local draft is retained */ }
  }

  async function confirmDelete() {
    if (!deleteKey || busy) return
    if (hasDuplicateKeys) {
      setDeleteKey(null)
      setError('Nie można bezpiecznie usunąć pytania: mapa ma zduplikowane klucze. Napraw klucze przed usuwaniem.')
      return
    }
    const deletionPayload = removeQuestionSubtree(localQuestions, deleteKey)
    setDeleteKey(null)
    try {
      await persist(deletionPayload)
      const focusTarget = rootActionRef.current ?? designerRef.current
      focusTarget?.focus()
    } catch {
      shouldFocusRetryAfterFailedDelete.current = true
    }
  }

  async function retryPersist() {
    if (busy || isSynced) return
    try { await persist(localQuestions) } catch { /* the retained local map can be retried again */ }
  }

  function discardLocalChanges() {
    setLocalQuestions([...questions])
    setIsSynced(true)
    setEditing(null)
    setDeleteKey(null)
    setView('design')
    setError('')
    setCollapsedKeys(new Set())
    onDraftStatusChange?.(draftId, { publishable: validateDraft(questions), dirty: false })
  }

  function cancelDelete() {
    if (busy) return
    setDeleteKey(null)
    deleteOpenerRef.current?.focus()
  }

  function startDelete(question: FormQuestion, opener: HTMLButtonElement) {
    if (hasDuplicateKeys) {
      setError('Nie można bezpiecznie usunąć pytania: mapa ma zduplikowane klucze. Napraw klucze przed usuwaniem.')
      return
    }
    deleteOpenerRef.current = opener
    setDeleteKey(question.key)
  }

  function renderBranch(branch: QuestionTreeBranch<FormQuestion>, parent: FormQuestion, depth: number) {
    const indented = depth <= 3
    return <div className="wd-template-branch" key={`${parent.key}-${branch.value}`} data-path-depth={depth} data-path-indent={indented ? 'step' : 'none'} style={{ marginLeft: indented ? '16px' : '0px', paddingInlineStart: '0px' }}>
      <div className="wd-template-branch__line" aria-hidden />
      <div className="wd-template-branch__heading">
        <span className="wd-template-branch__label">Odpowiedź: {branch.label}</span>
        {depth > 3 && <span className="wd-template-pill">Poziom {depth}</span>}
        <button type="button" className="wd-template-button wd-template-button--small" onClick={() => addQuestion({ parentKey: parent.key, equals: branch.value })} disabled={busy} aria-label={`Dodaj pytanie po odpowiedzi ${branch.label}`}>+ Dodaj pytanie</button>
      </div>
      <div className="wd-template-branch__children" aria-label={`Pytania po odpowiedzi ${branch.label}`}>
        {branch.children.map((child, index) => renderNode(child, depth, branch.children, index, { parentKey: parent.key, equals: branch.value }))}
      </div>
    </div>
  }

  function renderNode(node: QuestionTreeNode<FormQuestion>, depth: number, siblings: readonly QuestionTreeNode<FormQuestion>[], index: number, placement: QuestionPlacement) {
    const question = node.question
    return <div className="wd-template-node" key={`${placement.parentKey ?? 'root'}:${placement.equals ?? 'root'}:${index}:${question.key}`}>
      <article className="wd-template-card" aria-label={`Pytanie: ${question.label}`}>
        <div className="wd-template-card__body">
          <div className="wd-template-card__copy"><span className="wd-template-card__number">{depth + 1}</span><h4>{question.label}</h4>{question.help && <p>{question.help}</p>}</div>
          <div className="wd-template-card__meta"><span>{templateQuestionTypeLabels[question.type]}</span><span className={`wd-template-pill ${riskTone[question.riskLevel ?? 'LOW']}`}>Ryzyko: {templateQuestionRiskLabels[question.riskLevel ?? 'LOW']}</span>{question.required && <span className="wd-template-pill">Obowiązkowa</span>}</div>
        </div>
        <div className="wd-template-card__actions">
          {node.branches.length > 0 && <button type="button" className="wd-template-button wd-template-button--small" onClick={() => setCollapsedKeys((current) => {
            const next = new Set(current)
            if (next.has(question.key)) next.delete(question.key)
            else next.add(question.key)
            return next
          })} disabled={busy} aria-expanded={!collapsedKeys.has(question.key)} aria-controls={`template-branches-${question.key}`} aria-label={`${collapsedKeys.has(question.key) ? 'Rozwiń' : 'Zwiń'} gałęzie pytania ${question.label}`}>{collapsedKeys.has(question.key) ? 'Rozwiń' : 'Zwiń'}</button>}
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => setEditing({ initial: question, placement })} disabled={busy} aria-label={`Edytuj pytanie ${question.label}`}>Edytuj</button>
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => moveQuestion(question.key, 'UP')} disabled={busy || index === 0} aria-label={`Góra: ${question.label}`}>Góra</button>
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => moveQuestion(question.key, 'DOWN')} disabled={busy || index === siblings.length - 1} aria-label={`Dół: ${question.label}`}>Dół</button>
          <button type="button" className="wd-template-button wd-template-button--small wd-template-button--danger" onClick={(event) => startDelete(question, event.currentTarget)} disabled={busy} aria-label={`Usuń pytanie ${question.label}`}>Usuń</button>
        </div>
      </article>
      {!collapsedKeys.has(question.key) && <div id={`template-branches-${question.key}`} className="wd-template-branches" aria-label={`Gałęzie pytania ${question.label}`}>
        {node.branches.map((branch) => renderBranch(branch, question, depth + 1))}
      </div>}
    </div>
  }

  if (editing) return <div className="wd-template-designer"><TemplateQuestionEditor initial={editing.initial} placement={editing.placement} nextKey={editing.nextKey} onCancel={() => setEditing(null)} onSave={saveQuestion} /></div>
  if (view === 'test') return <div className="wd-template-designer"><TemplateTestPreview questions={localQuestions} onClose={() => setView('design')} /></div>

  return <section ref={designerRef} tabIndex={-1} className="wd-template-designer" aria-label="Projektant ścieżki formularza">
    <div className="wd-template-designer__toolbar">
      <div><p className="data-label">Mapa ścieżek</p><h3>Ułóż rozmowę klienta</h3><p>Każda odpowiedź prowadzi bezpośrednio do kolejnego pytania. Przeciąganie nie jest potrzebne: kolejność zmieniasz przyciskiem w obrębie jednej gałęzi.</p></div>
      <div className="wd-template-designer__toolbar-actions"><button type="button" className="wd-template-button wd-template-button--quiet" onClick={() => setView('test')} disabled={busy || !canUseDraft} aria-label="Testuj formularz">Testuj formularz</button></div>
    </div>

    {(error || !canUseDraft) && <p className={error ? 'wd-template-error' : 'wd-template-warning'} role={error ? 'alert' : 'status'}>{error || invalidMessage}</p>}
    {!isSynced && <div className="wd-template-retry-actions"><button ref={retryActionRef} type="button" className="wd-template-button wd-template-button--quiet" onClick={() => void retryPersist()} disabled={busy}>Ponów zapis</button><button type="button" className="wd-template-button wd-template-button--danger" onClick={discardLocalChanges} disabled={busy}>Odrzuć niezapisane zmiany</button></div>}
    {localQuestions.length === 0 ? <div className="wd-template-empty"><p>Utwórz mapę od pierwszego pytania.</p><button ref={rootActionRef} type="button" className="wd-template-button wd-template-button--primary" onClick={() => addQuestion({ parentKey: null, equals: null })} disabled={busy}>+ Dodaj pierwsze pytanie</button></div> : <div className="wd-template-map">
      {forest.roots.map((node, index) => renderNode(node, 0, forest.roots, index, { parentKey: null, equals: null }))}
      <button ref={rootActionRef} type="button" className="wd-template-root-action" aria-label="Następne pytanie główne" onClick={() => addQuestion({ parentKey: null, equals: null })} disabled={busy}>+ Następne pytanie główne</button>
    </div>}

    {deleteKey && (() => {
      const question = localQuestions.find((item) => item.key === deleteKey)
      if (!question) return null
      const count = Math.max(0, questionSubtreeKeys(localQuestions, deleteKey).size - 1)
      const label = question.label
      return <div ref={confirmationRef} className="wd-template-confirm" role="alertdialog" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelDelete() } }} aria-labelledby="template-delete-title" aria-describedby="template-delete-description">
        <h4 id="template-delete-title">Potwierdź usunięcie</h4>
        <p id="template-delete-description">{count > 0 ? `Usunąć pytanie i ${count} ${descendantsLabel(count)}?` : 'Usunąć pytanie?'}</p>
        <div className="wd-template-card__actions"><button type="button" className="wd-template-button wd-template-button--quiet" onClick={cancelDelete} disabled={busy} aria-label="Anuluj usuwanie">Anuluj</button><button type="button" className="wd-template-button wd-template-button--danger" onClick={() => void confirmDelete()} disabled={busy} aria-label={`Potwierdź usunięcie pytania ${label}`}>Usuń pytanie</button></div>
      </div>
    })()}
  </section>
}
