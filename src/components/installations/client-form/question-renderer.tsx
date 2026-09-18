'use client'

import { useId, type CSSProperties, type ReactNode } from 'react'
import { displayFormAnswer } from '@/lib/installations/form-answer-display'
import type { FormAnswerValue, FormQuestion } from '@/lib/installations/form-visibility'
import styles from './client-installation-form.module.css'

type ClientQuestionRendererBaseProps = {
  question: FormQuestion
  questions?: readonly FormQuestion[]
  value: FormAnswerValue | undefined
  fileContent?: ReactNode
  idPrefix?: string
  error?: string
  errorId?: string
}

export type ClientQuestionRendererProps = ClientQuestionRendererBaseProps & ({
  mode: 'interactive'
  onChange: (value: FormAnswerValue | null) => void
} | {
  mode: 'readonly'
  onChange?: never
})

function RequiredMark({ question }: { question: FormQuestion }) {
  return question.required ? <span className={styles.required}>*</span> : null
}

function OptionalClear({ question, value, onChange, kind }: { question: FormQuestion; value: FormAnswerValue | undefined; onChange: (value: FormAnswerValue | null) => void; kind: 'choice' | 'answer' }) {
  if (question.required || value === undefined) return null
  const label = kind === 'choice' ? 'Wyczyść wybór' : 'Wyczyść odpowiedź'
  return <div className={styles.clearRow}>
    <button type="button" className={styles.clearAnswer} aria-label={`${label}: ${question.label}`} onClick={() => onChange(null)}>{label}</button>
  </div>
}

function ReadonlyQuestion({ question, value, fileContent }: Pick<ClientQuestionRendererBaseProps, 'question' | 'value' | 'fileContent'>) {
  return <article className={styles.question}>
    <strong className={styles.questionTitle}>{question.label}<RequiredMark question={question} /></strong>
    <div className={styles.questionBody}>
      {question.help && <p className={styles.help}>{question.help}</p>}
      {question.type === 'FILE' && fileContent !== undefined
        ? fileContent
        : <output className={styles.answerOutput}>{displayFormAnswer(value, question.type)}</output>}
    </div>
  </article>
}

/** Presentation only: follow actual parent keys, never the visible list index. */
function questionDepth(question: FormQuestion, questions: readonly FormQuestion[]): number {
  const byKey = new Map(questions.map((item) => [item.key, item]))
  const visited = new Set([question.key])
  let current = question
  let depth = 0
  while (current.condition) {
    const parent = byKey.get(current.condition.questionKey)
    if (!parent || visited.has(parent.key)) return 0
    visited.add(parent.key)
    depth += 1
    current = parent
  }
  return depth
}

export function ClientQuestionRenderer(props: ClientQuestionRendererProps) {
  const generatedErrorId = useId()
  const errorId = props.errorId ?? `${generatedErrorId}-error`
  const depth = questionDepth(props.question, props.questions ?? [])
  return <div className={`${styles.questionHierarchy} ${props.error ? styles.questionInvalid : ''}`} data-question-error={props.error ? 'true' : undefined} data-question-depth={depth} style={{ '--question-depth': depth } as CSSProperties}>
    <QuestionContent {...props} errorId={errorId} />
    {props.error && <p id={errorId} className={styles.questionError}><span aria-hidden="true">⚠ </span>{props.error}</p>}
  </div>
}

function QuestionContent(props: ClientQuestionRendererProps) {
  const generatedId = useId()
  const { question, value, fileContent, idPrefix } = props
  if (props.mode === 'readonly') return <ReadonlyQuestion question={question} value={value} fileContent={fileContent} />

  const { onChange } = props
  const change = (next: FormAnswerValue | null) => onChange(next)
  const inputId = `${idPrefix ?? generatedId}-${question.key}`
  const validation = { 'aria-invalid': props.error ? true as const : undefined, 'aria-describedby': props.error ? props.errorId : undefined }

  if (question.type === 'FILE') return <>{fileContent}</>

  if (question.type === 'YES_NO_UNKNOWN') return <fieldset className={styles.question} {...validation}>
    <legend className={styles.questionTitle}>{question.label}<RequiredMark question={question} /></legend>
    <div className={styles.questionBody}>
      {question.help && <p className={styles.help}>{question.help}</p>}
      <div className={styles.choiceGrid}>{([['YES', 'Tak'], ['NO', 'Nie'], ['UNKNOWN', 'Nie wiem']] as const).map(([choice, label]) => <button type="button" key={choice} className={styles.choice} {...validation} aria-pressed={value === choice} onClick={() => change(choice)}>{label}</button>)}</div>
      <OptionalClear question={question} value={value} onChange={change} kind="choice" />
    </div>
  </fieldset>

  if (question.type === 'MULTI') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className={styles.question} {...validation}>
      <legend className={styles.questionTitle}>{question.label}<RequiredMark question={question} /></legend>
      <div className={styles.questionBody}>
        {question.help && <p className={styles.help}>{question.help}</p>}
        <div className={styles.checkList}>{(question.options ?? []).map((option) => <label className={styles.check} key={option}><input type="checkbox" {...validation} checked={selected.includes(option)} onChange={() => change(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{option}</label>)}</div>
        <OptionalClear question={question} value={value} onChange={change} kind="choice" />
      </div>
    </fieldset>
  }

  if (question.type === 'SINGLE') return <div className={styles.question}>
    <label className={styles.questionTitle} htmlFor={inputId}>{question.label}<RequiredMark question={question} /></label>
    <div className={styles.questionBody}>
      <select id={inputId} {...validation} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)}><option value="">Wybierz odpowiedź</option>{(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
      <OptionalClear question={question} value={value} onChange={change} kind="choice" />
    </div>
  </div>

  const multiline = question.type === 'TEXT'
  return <div className={styles.question}>
    <label className={styles.questionTitle} htmlFor={inputId}>{question.label}<RequiredMark question={question} /></label>
    <div className={styles.questionBody}>
      {multiline
        ? <textarea id={inputId} {...validation} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)} />
        : <input id={inputId} {...validation} className={styles.field} inputMode="decimal" value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)} />}
      <OptionalClear question={question} value={value} onChange={change} kind="answer" />
    </div>
  </div>
}
