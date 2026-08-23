'use client'

import { useMemo, useState } from 'react'
import { ClientQuestionRenderer } from '@/components/installations/client-form/question-renderer'
import { evaluateVisibleFormQuestions, filterVisibleAnswerValues, type FormAnswerValue, type FormQuestion } from '@/lib/installations/form-visibility'

export type TemplateTestPreviewProps = {
  questions: readonly FormQuestion[]
  onClose: () => void
}

export function TemplateTestPreview({ questions, onClose }: TemplateTestPreviewProps) {
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({})
  const visible = useMemo(() => evaluateVisibleFormQuestions(questions, answers), [questions, answers])

  function reset() {
    setAnswers({})
  }

  function updateAnswer(question: FormQuestion, value: FormAnswerValue | null) {
    setAnswers((current) => {
      const next = { ...current }
      if (value === null) delete next[question.key]
      else next[question.key] = value
      return filterVisibleAnswerValues(questions, next)
    })
  }

  if (questions.length === 0) {
    return <section className="wd-template-preview" aria-label="Podgląd testowy"><p className="wd-template-warning">Dodaj pytania, aby uruchomić próbę formularza.</p><button type="button" className="wd-template-button wd-template-button--quiet" onClick={onClose}>Wróć do mapy</button></section>
  }

  return <section className="wd-template-preview" aria-label="Test formularza">
    <div className="wd-template-preview__heading">
      <div><p className="data-label">Lokalna próba</p><h3>Tak zobaczy to klient</h3><p>Odpowiedzi zostają tylko w tej przeglądarce. Możesz przejść każdą widoczną gałąź.</p></div>
      <div className="wd-template-preview__actions"><button type="button" className="wd-template-button wd-template-button--quiet" onClick={reset}>Resetuj próbę</button><button type="button" className="wd-template-button wd-template-button--quiet" onClick={onClose}>Wróć do mapy</button></div>
    </div>
    <div className="wd-template-preview__client">
      {visible.length === 0 && <p className="wd-template-warning">Nie ma dostępnej ścieżki dla bieżących odpowiedzi.</p>}
      {visible.map((question) => question.type === 'FILE'
        ? <ClientQuestionRenderer
            key={question.key}
            question={question}
            value={answers[question.key]}
            mode="readonly"
            idPrefix="template-test"
            fileContent={<p className="wd-template-file-placeholder">Pliki będą dostępne w formularzu klienta</p>}
          />
        : <ClientQuestionRenderer
            key={question.key}
            question={question}
            value={answers[question.key]}
            mode="interactive"
            idPrefix="template-test"
            onChange={(value) => updateAnswer(question, value)}
          />)}
    </div>
  </section>
}
