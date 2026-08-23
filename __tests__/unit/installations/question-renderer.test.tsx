import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClientQuestionRenderer } from '@/components/installations/client-form/question-renderer'
import { displayFormAnswer } from '@/lib/installations/form-answer-display'
import type { FormQuestion } from '@/lib/installations/form-visibility'

const yesNoQuestion: FormQuestion = {
  key: 'glify',
  type: 'YES_NO_UNKNOWN',
  label: 'Czy są glify?',
  help: 'Jeśli nie masz pewności, wybierz „Nie wiem”.',
}

describe('ClientQuestionRenderer', () => {
  it('renders readonly label, help and Polish answer without mutating controls', () => {
    const onChange = vi.fn()

    render(<ClientQuestionRenderer question={yesNoQuestion} value="YES" mode="readonly" onChange={onChange} />)

    expect(screen.getByText('Czy są glify?')).not.toBeNull()
    expect(screen.getByText('Jeśli nie masz pewności, wybierz „Nie wiem”.')).not.toBeNull()
    expect(screen.getByText('Tak')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Tak' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps interactive answer controls and reports a selected choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ClientQuestionRenderer question={yesNoQuestion} value={undefined} mode="interactive" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Tak' }))

    expect(onChange).toHaveBeenCalledWith('YES')
  })

  it('formats arrays and missing answers for readonly output', () => {
    const multiQuestion: FormQuestion = {
      key: 'zakres',
      type: 'MULTI',
      label: 'Jaki zakres?',
      options: ['Ściana', 'Sufit'],
    }
    const { rerender } = render(<ClientQuestionRenderer question={multiQuestion} value={['Ściana', 'Sufit']} mode="readonly" />)

    expect(screen.getByText('Ściana, Sufit')).not.toBeNull()
    rerender(<ClientQuestionRenderer question={multiQuestion} value={undefined} mode="readonly" />)
    expect(screen.getByText('Brak odpowiedzi')).not.toBeNull()
    expect(displayFormAnswer('YES')).toBe('Tak')
    expect(displayFormAnswer('NO')).toBe('Nie')
    expect(displayFormAnswer('UNKNOWN')).toBe('Nie wiem')
    expect(displayFormAnswer([])).toBe('Brak odpowiedzi')
    expect(displayFormAnswer('')).toBe('Brak odpowiedzi')
  })

  it('renders FILE content without owning upload or network behavior', () => {
    const onChange = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fileQuestion: FormQuestion = {
      key: 'zdjecie',
      type: 'FILE',
      label: 'Zdjęcie referencyjne',
      required: true,
    }

    render(<ClientQuestionRenderer question={fileQuestion} value={undefined} mode="interactive" onChange={onChange} fileContent={<p>Wybierz plik</p>} />)

    expect(screen.getByText('Wybierz plik')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})
