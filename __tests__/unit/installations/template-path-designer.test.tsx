import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplatePathDesigner } from '@/components/installations/template-path-designer'
import type { FormQuestion } from '@/lib/installations/form-visibility'

const root: FormQuestion = {
  key: 'okna',
  type: 'YES_NO_UNKNOWN',
  label: 'Czy są okna?',
  help: 'Podaj stan okien.',
  riskLevel: 'MEDIUM',
  required: true,
}

const child: FormQuestion = {
  key: 'glify',
  type: 'YES_NO_UNKNOWN',
  label: 'Czy są glify?',
  condition: { questionKey: 'okna', equals: 'YES' },
}

const singleChild: FormQuestion = {
  key: 'strona',
  type: 'SINGLE',
  label: 'Która strona?',
  options: ['Lewa', 'Prawa'],
  condition: { questionKey: 'glify', equals: 'YES' },
}

const detached: FormQuestion = {
  key: 'odłączone',
  type: 'TEXT',
  label: 'Pytanie bez rodzica',
  condition: { questionKey: 'nie-istnieje', equals: 'YES' },
}

function renderDesigner(questions: FormQuestion[], onPersist = vi.fn().mockResolvedValue(undefined)) {
  return { onPersist, ...render(<TemplatePathDesigner questions={questions} busy={false} onPersist={onPersist} />) }
}

describe('TemplatePathDesigner', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('adds a child under Tak with a persisted condition and no technical fields in the editor', async () => {
    const user = userEvent.setup()
    const onPersist = vi.fn().mockResolvedValue(undefined)
    renderDesigner([root], onPersist)

    await user.click(screen.getByRole('button', { name: 'Dodaj pytanie po odpowiedzi Tak' }))
    expect(screen.queryByLabelText('Klucz pytania')).toBeNull()
    expect(screen.queryByLabelText('Warunek: klucz pytania')).toBeNull()
    expect(screen.queryByLabelText('Warunek: równa się')).toBeNull()
    await user.type(screen.getByLabelText('Treść pytania'), 'Czy glify są równe?')
    await user.selectOptions(screen.getByLabelText('Typ odpowiedzi'), 'SINGLE')
    await user.type(screen.getByLabelText('Opcje odpowiedzi'), 'Tak\nNie')
    await user.click(screen.getByRole('checkbox', { name: 'Odpowiedź obowiązkowa' }))
    await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))

    await vi.waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1))
    expect(onPersist.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'question-1', type: 'SINGLE', label: 'Czy glify są równe?', required: true, options: ['Tak', 'Nie'], condition: { questionKey: 'okna', equals: 'YES' } }),
    ]))
  })

  it('keeps three visible levels and carries a parent subtree while moving siblings only', async () => {
    const user = userEvent.setup()
    const onPersist = vi.fn().mockResolvedValue(undefined)
    renderDesigner([root, child, singleChild, { ...singleChild, key: 'druga', label: 'Druga strona', condition: { questionKey: 'glify', equals: 'YES' } }], onPersist)

    expect(screen.getByText('Czy są okna?')).toBeTruthy()
    expect(screen.getByText('Czy są glify?')).toBeTruthy()
    expect(screen.getByText('Która strona?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Góra: Druga strona' }))
    await vi.waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1))
    const moved = onPersist.mock.calls[0]?.[0] as FormQuestion[]
    expect(moved.map((question) => question.key)).toEqual(['okna', 'glify', 'druga', 'strona'])
    expect(moved.find((question) => question.key === 'glify')?.condition).toEqual({ questionKey: 'okna', equals: 'YES' })
  })

  it('edits a label without renaming its internal key', async () => {
    const user = userEvent.setup()
    const onPersist = vi.fn().mockResolvedValue(undefined)
    renderDesigner([root], onPersist)
    await user.click(screen.getByRole('button', { name: 'Edytuj pytanie Czy są okna?' }))
    const label = screen.getByLabelText('Treść pytania')
    await user.clear(label)
    await user.type(label, 'Czy w pomieszczeniu są okna?')
    await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))
    await vi.waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1))
    expect(onPersist.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ key: 'okna', label: 'Czy w pomieszczeniu są okna?' })])
  })

  it('requires confirmation, reports subtree count, and leaves data unchanged on cancel', async () => {
    const user = userEvent.setup()
    const onPersist = vi.fn().mockResolvedValue(undefined)
    renderDesigner([root, child, singleChild], onPersist)
    await user.click(screen.getByRole('button', { name: 'Usuń pytanie Czy są okna?' }))
    expect(screen.getByText('Usunąć pytanie i 2 pytania podrzędne?')).toBeTruthy()
    const confirmation = screen.getByRole('alertdialog')
    expect(document.activeElement).toBe(confirmation)
    expect(confirmation.getAttribute('aria-modal')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Anuluj usuwanie' }))
    expect(onPersist).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Usuń pytanie Czy są okna?' }))
    await user.click(screen.getByRole('button', { name: 'Potwierdź usunięcie pytania Czy są okna?' }))
    await vi.waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1))
    expect(onPersist.mock.calls[0]?.[0]).toEqual([])
  })

  it('tests the local form path with the shared engine, reset and a FILE placeholder without fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const questions: FormQuestion[] = [
      root,
      { ...child, label: 'Czy można wejść?', key: 'wejscie' },
      { key: 'zdjecie', type: 'FILE', label: 'Zdjęcie', condition: { questionKey: 'wejscie', equals: 'YES' } },
    ]
    renderDesigner(questions)
    await user.click(screen.getByRole('button', { name: 'Testuj formularz' }))
    await user.click(screen.getByRole('button', { name: 'Tak' }))
    expect(screen.getByText('Czy można wejść?')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Tak' })[1]!)
    expect(screen.getByText('Pliki będą dostępne w formularzu klienta')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Resetuj próbę' }))
    expect(screen.queryByText('Czy można wejść?')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows a SINGLE answer through the same local path engine', async () => {
    const user = userEvent.setup()
    const singleRoot: FormQuestion = {
      key: 'strona',
      type: 'SINGLE',
      label: 'Która strona?',
      options: ['Lewa', 'Prawa'],
    }
    const singleChildQuestion: FormQuestion = {
      key: 'wnetrze',
      type: 'TEXT',
      label: 'Opisz lewą stronę',
      condition: { questionKey: 'strona', equals: 'Lewa' },
    }
    renderDesigner([singleRoot, singleChildQuestion])

    await user.click(screen.getByRole('button', { name: 'Testuj formularz' }))
    await user.selectOptions(screen.getByLabelText('Która strona?'), 'Lewa')

    expect(screen.getByText('Opisz lewą stronę')).toBeTruthy()
  })

  it('keeps a failed local draft visible so the editor can retry it', async () => {
    const user = userEvent.setup()
    const onPersist = vi.fn()
      .mockRejectedValueOnce(new Error('Nie udało się zapisać pytań. Spróbuj ponownie.'))
      .mockResolvedValueOnce(undefined)
    renderDesigner([root], onPersist)

    await user.click(screen.getByRole('button', { name: 'Dodaj pytanie po odpowiedzi Tak' }))
    await user.type(screen.getByLabelText('Treść pytania'), 'Czy można wejść?')
    await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nie udało się zapisać pytań. Spróbuj ponownie.')

    await user.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(screen.getByText('Czy można wejść?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edytuj pytanie Czy można wejść?' }))
    await user.click(screen.getByRole('button', { name: 'Zapisz pytanie' }))

    await vi.waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2))
  })

  it('shows a Polish warning and disables testing for invalid, detached or empty drafts', () => {
    const invalidChoice: FormQuestion = { key: 'wybor', type: 'SINGLE', label: 'Wybór bez opcji' }
    const { rerender } = render(<TemplatePathDesigner questions={[root, invalidChoice]} busy={false} onPersist={vi.fn()} />)
    expect(screen.getByText(/Nie można przetestować ani opublikować szkicu/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Testuj formularz' })).toHaveProperty('disabled', true)
    rerender(<TemplatePathDesigner questions={[root, detached]} busy={false} onPersist={vi.fn()} />)
    expect(screen.getByText(/Nie można ułożyć pełnej ścieżki/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Testuj formularz' })).toHaveProperty('disabled', true)
    rerender(<TemplatePathDesigner questions={[]} busy={false} onPersist={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Dodaj pierwsze pytanie/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Testuj formularz' })).toHaveProperty('disabled', true)
  })

  it('renders a narrow layout without an explicit horizontal overflow style', () => {
    const { container } = renderDesigner([root])
    expect(container.querySelector('[style*="overflow-x"]')).toBeNull()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
    expect(within(container).getByRole('button', { name: 'Następne pytanie główne' })).toBeTruthy()
  })

  it('keeps deep paths within three visual indents and labels deeper branches', () => {
    const fourth: FormQuestion = {
      key: 'dostep',
      type: 'YES_NO_UNKNOWN',
      label: 'Czy jest dostęp?',
      condition: { questionKey: 'strona', equals: 'Lewa' },
    }
    const fifth: FormQuestion = {
      key: 'uwaga',
      type: 'TEXT',
      label: 'Dodatkowa uwaga',
      condition: { questionKey: 'dostep', equals: 'YES' },
    }

    const { container } = renderDesigner([root, child, singleChild, fourth, fifth])

    expect(screen.getAllByText('Poziom 4').length).toBeGreaterThan(0)
    const thirdDepthBranch = container.querySelector<HTMLElement>('[data-path-depth="3"]')
    const deepestBranch = container.querySelector<HTMLElement>('[data-path-depth="4"]')
    expect(thirdDepthBranch?.dataset.pathIndent).toBe('step')
    expect(thirdDepthBranch?.style.marginLeft).toBe('16px')
    expect(thirdDepthBranch?.style.paddingInlineStart).toBe('0px')
    expect(deepestBranch?.dataset.pathIndent).toBe('none')
    expect(deepestBranch?.style.marginLeft).toBe('0px')
    expect(deepestBranch?.style.paddingInlineStart).toBe('0px')
  })
})
