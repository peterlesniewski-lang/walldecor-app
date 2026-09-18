import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TemplateTestPreview } from '@/components/installations/template-test-preview'
import { ClientQuestionRenderer } from '@/components/installations/client-form/question-renderer'
import type { FormQuestion } from '@/lib/installations/form-visibility'

const questions: FormQuestion[] = [
  { key: 'windows', label: 'Okna?', type: 'YES_NO_UNKNOWN' },
  { key: 'count', label: 'Liczba okien', type: 'NUMBER', condition: { questionKey: 'windows', equals: 'YES' } },
  { key: 'reveals', label: 'Glify?', type: 'YES_NO_UNKNOWN', condition: { questionKey: 'windows', equals: 'YES' } },
  { key: 'depth', label: 'Głębokość', type: 'NUMBER', condition: { questionKey: 'reveals', equals: 'YES' } },
  { key: 'other', label: 'Kolejne główne', type: 'TEXT' },
]

function depth(label: string) {
  return screen.getByText(label).closest('[data-question-depth]')?.getAttribute('data-question-depth')
}

describe('Question hierarchy in client previews', () => {
  it('keeps siblings aligned, indents descendants by ancestry and restores root alignment after conditions change', async () => {
    const user = userEvent.setup()
    render(<TemplateTestPreview questions={questions} onClose={() => {}} />)
    expect(depth('Okna?')).toBe('0')
    await user.click(within(screen.getByRole('group', { name: 'Okna?' })).getByRole('button', { name: 'Tak', exact: true }))
    expect(depth('Liczba okien')).toBe('1')
    expect(depth('Glify?')).toBe('1')
    await user.click(within(screen.getByRole('group', { name: 'Glify?' })).getByRole('button', { name: 'Tak', exact: true }))
    expect(depth('Głębokość')).toBe('2')
    expect(depth('Kolejne główne')).toBe('0')
    await user.click(within(screen.getByRole('group', { name: 'Okna?' })).getByRole('button', { name: 'Nie', exact: true }))
    expect(screen.queryByText('Głębokość')).toBeNull()
    expect(depth('Kolejne główne')).toBe('0')
  })

  it('uses the same true depth in readonly answers, independent of array order', () => {
    render(<ClientQuestionRenderer question={questions[3]} questions={[...questions].reverse()} value="15" mode="readonly" />)
    expect(depth('Głębokość')).toBe('2')
  })

  it('preserves actual deep ancestry for layout caps without treating depth as the list index', () => {
    const chain: FormQuestion[] = Array.from({ length: 7 }, (_, index) => ({
      key: `q${index}`, label: `Pytanie ${index}`, type: 'TEXT',
      ...(index ? { condition: { questionKey: `q${index - 1}`, equals: 'YES' } } : {}),
    }))
    render(<ClientQuestionRenderer question={chain[6]} questions={chain} value="opis" mode="readonly" />)
    expect(depth('Pytanie 6')).toBe('6')
  })

  it('safely falls back to root layout for missing or cyclic parents', () => {
    const orphan: FormQuestion = { key: 'orphan', label: 'Bez rodzica', type: 'TEXT', condition: { questionKey: 'missing', equals: 'YES' } }
    const cycle: FormQuestion = { key: 'cycle', label: 'Cykl', type: 'TEXT', condition: { questionKey: 'cycle', equals: 'YES' } }
    render(<><ClientQuestionRenderer question={orphan} questions={[orphan]} value="" mode="readonly" /><ClientQuestionRenderer question={cycle} questions={[cycle]} value="" mode="readonly" /></>)
    expect(depth('Bez rodzica')).toBe('0')
    expect(depth('Cykl')).toBe('0')
  })
})
