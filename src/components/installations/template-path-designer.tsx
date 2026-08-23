'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormQuestion } from '@/lib/installations/form-visibility'
import { buildQuestionForest, flattenQuestionForest, nextQuestionKey, removeQuestionSubtree, moveQuestionWithinBranch, appendQuestionAtPlacement, type QuestionPlacement, type QuestionTreeBranch, type QuestionTreeNode } from '@/lib/installations/question-tree'
import { validateInstallationQuestionDefinitions } from '@/lib/installations/question-schema'
import { TemplateQuestionEditor, templateQuestionRiskLabels, templateQuestionTypeLabels } from './template-question-editor'
import { TemplateTestPreview } from './template-test-preview'

export type TemplatePathDesignerProps = {
  questions: readonly FormQuestion[]
  busy: boolean
  onPersist: (questions: FormQuestion[]) => Promise<void>
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

function descendants(node: QuestionTreeNode<FormQuestion>): number {
  return node.branches.reduce((total, branch) => total + branch.children.reduce((branchTotal, child) => branchTotal + 1 + descendants(child), 0), 0)
}

function descendantsLabel(count: number): string {
  if (count === 1) return 'pytanie podrzędne'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'pytania podrzędne'
    : 'pytań podrzędnych'
}

function findNode(nodes: readonly QuestionTreeNode<FormQuestion>[], key: string): QuestionTreeNode<FormQuestion> | null {
  for (const node of nodes) {
    if (node.question.key === key) return node
    const nested = findNode(node.branches.flatMap((branch) => branch.children), key)
    if (nested) return nested
  }
  return null
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
  if (detachedCount > 0) return `Nie można ułożyć pełnej ścieżki: ${detachedCount} pytanie${detachedCount === 1 ? '' : 'a'} nie ma prawidłowego rodzica lub odpowiedzi.`
  return 'Nie można przetestować ani opublikować szkicu, dopóki pytania nie przejdą walidacji.'
}

export function TemplatePathDesigner({ questions, busy, onPersist }: TemplatePathDesignerProps) {
  const [localQuestions, setLocalQuestions] = useState<FormQuestion[]>(() => [...questions])
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [deleteKey, setDeleteKey] = useState<string | null>(null)
  const [view, setView] = useState<'design' | 'test'>('design')
  const [error, setError] = useState('')
  const confirmationRef = useRef<HTMLDivElement>(null)

  // The designer keeps a recoverable local draft while a failed PATCH is retried.
  // This synchronizes only incoming catalog updates, including a draft switch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLocalQuestions([...questions]) }, [questions])
  useEffect(() => {
    if (deleteKey) confirmationRef.current?.focus()
  }, [deleteKey])

  const forest = useMemo(() => buildQuestionForest(localQuestions), [localQuestions])
  const canUseDraft = useMemo(() => validateDraft(localQuestions), [localQuestions])
  const invalidMessage = validationMessage(localQuestions, forest.detached.length)

  async function persist(next: FormQuestion[]) {
    setLocalQuestions(next)
    setError('')
    try {
      await onPersist(next)
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
    if (!deleteKey) return
    try {
      await persist(removeQuestionSubtree(localQuestions, deleteKey))
      setDeleteKey(null)
    } catch { /* message remains visible and the confirmation can be retried */ }
  }

  function renderBranch(branch: QuestionTreeBranch<FormQuestion>, parent: FormQuestion, depth: number) {
    return <div className="wd-template-branch" key={`${parent.key}-${branch.value}`} style={{ marginLeft: depth <= 3 ? '16px' : '0px' }}>
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
    return <div className="wd-template-node" key={question.key}>
      <article className="wd-template-card" aria-label={`Pytanie: ${question.label}`}>
        <div className="wd-template-card__body">
          <div className="wd-template-card__copy"><span className="wd-template-card__number">{depth + 1}</span><h4>{question.label}</h4>{question.help && <p>{question.help}</p>}</div>
          <div className="wd-template-card__meta"><span>{templateQuestionTypeLabels[question.type]}</span><span className={`wd-template-pill ${riskTone[question.riskLevel ?? 'LOW']}`}>Ryzyko: {templateQuestionRiskLabels[question.riskLevel ?? 'LOW']}</span>{question.required && <span className="wd-template-pill">Obowiązkowa</span>}</div>
        </div>
        <div className="wd-template-card__actions">
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => setEditing({ initial: question, placement })} disabled={busy} aria-label={`Edytuj pytanie ${question.label}`}>Edytuj</button>
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => moveQuestion(question.key, 'UP')} disabled={busy || index === 0} aria-label={`Góra: ${question.label}`}>Góra</button>
          <button type="button" className="wd-template-button wd-template-button--small" onClick={() => moveQuestion(question.key, 'DOWN')} disabled={busy || index === siblings.length - 1} aria-label={`Dół: ${question.label}`}>Dół</button>
          <button type="button" className="wd-template-button wd-template-button--small wd-template-button--danger" onClick={() => setDeleteKey(question.key)} disabled={busy} aria-label={`Usuń pytanie ${question.label}`}>Usuń</button>
        </div>
      </article>
      <div className="wd-template-branches" aria-label={`Gałęzie pytania ${question.label}`}>
        {node.branches.map((branch) => renderBranch(branch, question, depth + 1))}
      </div>
    </div>
  }

  if (editing) return <div className="wd-template-designer"><TemplateQuestionEditor initial={editing.initial} placement={editing.placement} nextKey={editing.nextKey} onCancel={() => setEditing(null)} onSave={saveQuestion} /></div>
  if (view === 'test') return <div className="wd-template-designer"><TemplateTestPreview questions={localQuestions} onClose={() => setView('design')} /></div>

  return <section className="wd-template-designer" aria-label="Projektant ścieżki formularza">
    <div className="wd-template-designer__toolbar">
      <div><p className="data-label">Mapa ścieżek</p><h3>Ułóż rozmowę klienta</h3><p>Każda odpowiedź prowadzi bezpośrednio do kolejnego pytania. Przeciąganie nie jest potrzebne: kolejność zmieniasz przyciskiem w obrębie jednej gałęzi.</p></div>
      <div className="wd-template-designer__toolbar-actions"><button type="button" className="wd-template-button wd-template-button--quiet" onClick={() => setView('test')} disabled={busy || !canUseDraft} aria-label="Testuj formularz">Testuj formularz</button></div>
    </div>

    {(error || !canUseDraft) && <p className={error ? 'wd-template-error' : 'wd-template-warning'} role={error ? 'alert' : 'status'}>{error || invalidMessage}</p>}
    {localQuestions.length === 0 ? <div className="wd-template-empty"><p>Utwórz mapę od pierwszego pytania.</p><button type="button" className="wd-template-button wd-template-button--primary" onClick={() => addQuestion({ parentKey: null, equals: null })} disabled={busy}>+ Dodaj pierwsze pytanie</button></div> : <div className="wd-template-map">
      {forest.roots.map((node, index) => renderNode(node, 0, forest.roots, index, { parentKey: null, equals: null }))}
      <button type="button" className="wd-template-root-action" aria-label="Następne pytanie główne" onClick={() => addQuestion({ parentKey: null, equals: null })} disabled={busy}>+ Następne pytanie główne</button>
    </div>}

    {deleteKey && (() => {
      const node = findNode(forest.roots, deleteKey)
      const count = node ? descendants(node) : 0
      const label = node?.question.label ?? 'to pytanie'
      return <div ref={confirmationRef} className="wd-template-confirm" role="alertdialog" aria-modal="true" tabIndex={-1} aria-labelledby="template-delete-title" aria-describedby="template-delete-description">
        <h4 id="template-delete-title">Potwierdź usunięcie</h4>
        <p id="template-delete-description">{count > 0 ? `Usunąć pytanie i ${count} ${descendantsLabel(count)}?` : 'Usunąć pytanie?'}</p>
        <div className="wd-template-card__actions"><button type="button" className="wd-template-button wd-template-button--quiet" onClick={() => setDeleteKey(null)} aria-label="Anuluj usuwanie">Anuluj</button><button type="button" className="wd-template-button wd-template-button--danger" onClick={() => void confirmDelete()} aria-label={`Potwierdź usunięcie pytania ${label}`}>Usuń pytanie</button></div>
      </div>
    })()}
  </section>
}
