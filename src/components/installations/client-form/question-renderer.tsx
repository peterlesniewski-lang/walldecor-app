'use client'

import type { ReactNode } from 'react'
import { displayFormAnswer } from '@/lib/installations/form-answer-display'
import type { FormAnswerValue, FormQuestion } from '@/lib/installations/form-visibility'
import styles from './client-installation-form.module.css'

export type ClientQuestionRendererProps = {
  question: FormQuestion
  value: FormAnswerValue | undefined
  mode: 'interactive' | 'readonly'
  onChange?: (value: FormAnswerValue | null) => void
  fileContent?: ReactNode
  idPrefix?: string
}

function RequiredMark({ question }: { question: FormQuestion }) {
  return question.required ? <span className={styles.required}>*</span> : null
}

function OptionalClear({ question, value, onChange }: { question: FormQuestion; value: FormAnswerValue | undefined; onChange: (value: FormAnswerValue | null) => void }) {
  if (question.required || value === undefined) return null
  return <button type="button" className={styles.secondary} aria-label={'Wyczyść odpowiedź: ' + question.label} onClick={() => onChange(null)}>Wyczyść odpowiedź</button>
}

function ReadonlyQuestion({ question, value, fileContent }: Pick<ClientQuestionRendererProps, 'question' | 'value' | 'fileContent'>) {
  return <article className={styles.question}>
    <strong className={styles.readonlyLabel}>{question.label}<RequiredMark question={question} /></strong>
    {question.help && <p className={styles.help}>{question.help}</p>}
    {question.type === 'FILE' && fileContent !== undefined
      ? fileContent
      : <output className={styles.answerOutput}>{displayFormAnswer(value)}</output>}
  </article>
}

export function ClientQuestionRenderer({ question, value, mode, onChange, fileContent, idPrefix }: ClientQuestionRendererProps) {
  if (mode === 'readonly') return <ReadonlyQuestion question={question} value={value} fileContent={fileContent} />

  const change = (next: FormAnswerValue | null) => onChange?.(next)
  const inputId = idPrefix ? `${idPrefix}-${question.key}` : question.key

  if (question.type === 'FILE') return <>{fileContent}</>

  if (question.type === 'YES_NO_UNKNOWN') return <fieldset className={styles.question}>
    <legend>{question.label}<RequiredMark question={question} /></legend>
    {question.help && <p className={styles.help}>{question.help}</p>}
    <div className={styles.choiceGrid}>{([['YES', 'Tak'], ['NO', 'Nie'], ['UNKNOWN', 'Nie wiem']] as const).map(([choice, label]) => <button type="button" key={choice} className={styles.choice} aria-pressed={value === choice} onClick={() => change(choice)}>{label}</button>)}</div>
    <OptionalClear question={question} value={value} onChange={change} />
  </fieldset>

  if (question.type === 'MULTI') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className={styles.question}>
      <legend>{question.label}<RequiredMark question={question} /></legend>
      {question.help && <p className={styles.help}>{question.help}</p>}
      <div className={styles.checkList}>{(question.options ?? []).map((option) => <label className={styles.check} key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => change(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{option}</label>)}</div>
      <OptionalClear question={question} value={value} onChange={change} />
    </fieldset>
  }

  if (question.type === 'SINGLE') return <div className={styles.question}>
    <label htmlFor={inputId}>{question.label}<RequiredMark question={question} /></label>
    <select id={inputId} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)}><option value="">Wybierz odpowiedź</option>{(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
    <OptionalClear question={question} value={value} onChange={change} />
  </div>

  const multiline = question.type === 'TEXT'
  return <div className={styles.question}>
    <label htmlFor={inputId}>{question.label}<RequiredMark question={question} /></label>
    {multiline
      ? <textarea id={inputId} className={styles.field} value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)} />
      : <input id={inputId} className={styles.field} inputMode="decimal" value={typeof value === 'string' ? value : ''} onChange={(event) => change(event.target.value || null)} />}
    <OptionalClear question={question} value={value} onChange={change} />
  </div>
}
