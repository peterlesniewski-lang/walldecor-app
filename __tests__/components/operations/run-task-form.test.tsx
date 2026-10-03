import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RunTaskForm, type TaskFormValues } from '@/components/operations/run-task-form'

const PROCEDURES = [
  { id: 'proc-1', title: 'Jak pobrać wyciąg bankowy' },
  { id: 'proc-2', title: 'Jak wystawić fakturę' },
]

function renderForm(props: Partial<React.ComponentProps<typeof RunTaskForm>> = {}) {
  const onSubmit = vi.fn<(values: TaskFormValues) => void>()
  const onCancel = vi.fn()
  render(
    <RunTaskForm
      mode="add"
      procedureOptions={PROCEDURES}
      saving={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  )
  return { onSubmit, onCancel }
}

const titleInput = () => screen.getByLabelText('Tytuł zadania') as HTMLInputElement
const descriptionInput = () => screen.getByLabelText('Opis (opcjonalnie)') as HTMLTextAreaElement
const procedureSelect = () => screen.getByLabelText('Procedura „jak to zrobić” (opcjonalnie)') as HTMLSelectElement
const recurringSwitch = () => screen.getByRole('switch', { name: 'Powtarzaj co miesiąc' })

describe('RunTaskForm', () => {
  describe('add mode', () => {
    it('should show the "Nowe zadanie" heading', () => {
      renderForm()

      expect(screen.queryByRole('heading', { name: 'Nowe zadanie' })).not.toBeNull()
    })

    it('should offer an "Dodaj" submit button', () => {
      renderForm()

      expect(screen.queryByRole('button', { name: 'Dodaj' })).not.toBeNull()
    })

    it('should start with an empty title', () => {
      renderForm()

      expect(titleInput().value).toBe('')
    })

    it('should repeat the task every month by default', () => {
      renderForm()

      expect(recurringSwitch().getAttribute('aria-checked')).toBe('true')
    })

    it('should list the procedures after the "Bez procedury" option', () => {
      renderForm()

      expect(Array.from(procedureSelect().options).map((option) => option.text)).toEqual([
        'Bez procedury',
        'Jak pobrać wyciąg bankowy',
        'Jak wystawić fakturę',
      ])
    })
  })

  describe('validation', () => {
    it('should show an inline error when the title has fewer than 3 characters', async () => {
      renderForm()
      await userEvent.type(titleInput(), 'ab')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(screen.getByRole('alert').textContent).toBe('Tytuł musi mieć co najmniej 3 znaki.')
    })

    it('should not submit when the title has fewer than 3 characters', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'ab')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should not submit when the title is only whitespace', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), '     ')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should not show an error before the first submit', () => {
      renderForm()

      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('submit', () => {
    it('should send the trimmed title with empty optional fields as null and recurring on', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), '  Wyciąg bankowy  ')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Wyciąg bankowy',
        description: null,
        procedureId: null,
        recurring: true,
      })
    })

    it('should send a null description when the description is only whitespace', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.type(descriptionInput(), '   ')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].description).toBeNull()
    })

    it('should send the trimmed description when it is filled in', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.type(descriptionInput(), ' Pobierz z banku ')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].description).toBe('Pobierz z banku')
    })

    it('should send the chosen procedure id', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.selectOptions(procedureSelect(), 'Jak wystawić fakturę')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].procedureId).toBe('proc-2')
    })

    it('should send a null procedure id after choosing "Bez procedury" again', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.selectOptions(procedureSelect(), 'Jak wystawić fakturę')
      await userEvent.selectOptions(procedureSelect(), 'Bez procedury')

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].procedureId).toBeNull()
    })

    it('should send recurring false after the switch is toggled off', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.click(recurringSwitch())

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].recurring).toBe(false)
    })

    it('should send recurring true after the switch is toggled off and on again', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')
      await userEvent.click(recurringSwitch())
      await userEvent.click(recurringSwitch())

      await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }))

      expect(onSubmit.mock.calls[0][0].recurring).toBe(true)
    })

    it('should submit when the Enter key is pressed in the title field', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy{Enter}')

      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('should disable the submit button while saving', () => {
      renderForm({ saving: true })

      expect((screen.getByRole('button', { name: 'Dodaj' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('recurring switch', () => {
    it('should flip aria-checked when clicked', async () => {
      renderForm()

      await userEvent.click(recurringSwitch())

      expect(recurringSwitch().getAttribute('aria-checked')).toBe('false')
    })

    it('should mark the task as "tylko ten miesiąc" when switched off', async () => {
      renderForm()

      await userEvent.click(recurringSwitch())

      expect(screen.queryByText('(tylko ten miesiąc)')).not.toBeNull()
    })

    it('should not show the "tylko ten miesiąc" hint while switched on', () => {
      renderForm()

      expect(screen.queryByText('(tylko ten miesiąc)')).toBeNull()
    })
  })

  describe('edit mode', () => {
    const initial: TaskFormValues = {
      title: 'Faktury kosztowe',
      description: 'Wszystkie z danego miesiąca',
      procedureId: 'proc-2',
      recurring: false,
    }

    it('should show the "Edytuj zadanie" heading', () => {
      renderForm({ mode: 'edit', initial })

      expect(screen.queryByRole('heading', { name: 'Edytuj zadanie' })).not.toBeNull()
    })

    it('should offer a "Zapisz" submit button', () => {
      renderForm({ mode: 'edit', initial })

      expect(screen.queryByRole('button', { name: 'Zapisz' })).not.toBeNull()
    })

    it('should prefill the title', () => {
      renderForm({ mode: 'edit', initial })

      expect(titleInput().value).toBe('Faktury kosztowe')
    })

    it('should prefill the description', () => {
      renderForm({ mode: 'edit', initial })

      expect(descriptionInput().value).toBe('Wszystkie z danego miesiąca')
    })

    it('should prefill the procedure', () => {
      renderForm({ mode: 'edit', initial })

      expect(procedureSelect().value).toBe('proc-2')
    })

    it('should prefill the recurring switch', () => {
      renderForm({ mode: 'edit', initial })

      expect(recurringSwitch().getAttribute('aria-checked')).toBe('false')
    })

    it('should prefill empty fields when the task has no description or procedure', () => {
      renderForm({ mode: 'edit', initial: { title: 'Raport VAT', description: null, procedureId: null, recurring: true } })

      expect([descriptionInput().value, procedureSelect().value]).toEqual(['', ''])
    })

    it('should submit the edited values', async () => {
      const { onSubmit } = renderForm({ mode: 'edit', initial })
      await userEvent.clear(titleInput())
      await userEvent.type(titleInput(), 'Faktury sprzedażowe')

      await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }))

      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Faktury sprzedażowe',
        description: 'Wszystkie z danego miesiąca',
        procedureId: 'proc-2',
        recurring: false,
      })
    })
  })

  describe('cancel', () => {
    it('should call onCancel when "Anuluj" is clicked', async () => {
      const { onCancel } = renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should not submit when "Anuluj" is clicked', async () => {
      const { onSubmit } = renderForm()
      await userEvent.type(titleInput(), 'Wyciąg bankowy')

      await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }))

      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
