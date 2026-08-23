import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => { vi.unstubAllGlobals() })

  it('renders readonly label, help and Polish answer without mutating controls', () => {
    render(<ClientQuestionRenderer question={yesNoQuestion} value="YES" mode="readonly" />)

    expect(screen.getByText('Czy są glify?')).not.toBeNull()
    expect(screen.getByText('Jeśli nie masz pewności, wybierz „Nie wiem”.')).not.toBeNull()
    expect(screen.getByText('Tak')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Tak' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
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
    expect(displayFormAnswer('YES', 'YES_NO_UNKNOWN')).toBe('Tak')
    expect(displayFormAnswer('NO', 'YES_NO_UNKNOWN')).toBe('Nie')
    expect(displayFormAnswer('UNKNOWN', 'YES_NO_UNKNOWN')).toBe('Nie wiem')
    expect(displayFormAnswer([], 'MULTI')).toBe('Brak odpowiedzi')
    expect(displayFormAnswer('', 'TEXT')).toBe('Brak odpowiedzi')
  })

  it('does not translate reserved answer tokens for TEXT or SINGLE questions', () => {
    const textQuestion: FormQuestion = { key: 'opis', type: 'TEXT', label: 'Opis' }
    const singleQuestion: FormQuestion = { key: 'wariant', type: 'SINGLE', label: 'Wariant', options: ['UNKNOWN'] }
    const { rerender } = render(<ClientQuestionRenderer question={textQuestion} value="NO" mode="readonly" />)

    expect(screen.getByText('NO')).not.toBeNull()
    expect(screen.queryByText('Nie')).toBeNull()
    rerender(<ClientQuestionRenderer question={singleQuestion} value="UNKNOWN" mode="readonly" />)
    expect(screen.getByText('UNKNOWN')).not.toBeNull()
    expect(screen.queryByText('Nie wiem')).toBeNull()
  })

  it('keeps generated control ids unique and accepts an explicit id prefix', () => {
    const textQuestion: FormQuestion = { key: 'opis', type: 'TEXT', label: 'Opis' }
    const onChange = vi.fn()
    const { unmount } = render(<div>
      <ClientQuestionRenderer question={textQuestion} value={undefined} mode="interactive" onChange={onChange} />
      <ClientQuestionRenderer question={textQuestion} value={undefined} mode="interactive" onChange={onChange} />
    </div>)
    const controls = screen.getAllByLabelText('Opis') as HTMLTextAreaElement[]

    expect(controls[0].id).not.toBe(controls[1].id)
    unmount()
    render(<ClientQuestionRenderer question={textQuestion} value={undefined} mode="interactive" onChange={onChange} idPrefix="answers" />)
    expect((screen.getByLabelText('Opis') as HTMLTextAreaElement).id).toBe('answers-opis')
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
