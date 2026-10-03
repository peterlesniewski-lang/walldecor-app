import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunTaskList, type RunTask } from '@/components/operations/run-task-list'

const BANK: RunTask = { id: 'i1', title: 'Wyciąg bankowy', description: 'Pobierz z banku', status: 'todo', recurring: true }
const INVOICES: RunTask = { id: 'i2', title: 'Faktury kosztowe', description: null, status: 'done', recurring: true }
const VAT: RunTask = { id: 'i3', title: 'Raport VAT', description: null, status: 'todo', recurring: false }

function renderList(props: Partial<React.ComponentProps<typeof RunTaskList>> = {}) {
  const handlers = {
    onSelect: vi.fn<(id: string) => void>(),
    onToggleDone: vi.fn<(id: string) => void>(),
    onReorder: vi.fn<(orderedIds: string[]) => void>(),
    onEdit: vi.fn<(id: string) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
  }
  render(
    <RunTaskList
      items={[BANK, INVOICES, VAT]}
      selectedId="i1"
      canToggle
      canEdit
      {...handlers}
      {...props}
    />
  )
  return handlers
}

const checkbox = (title: string) => screen.getByRole('checkbox', { name: `Oznacz jako gotowe: ${title}` })
const menuButton = (title: string) => screen.getByRole('button', { name: `Opcje zadania: ${title}` })
const rowOf = (title: string) => screen.getAllByTestId('run-task-row').find((row) => within(row).queryByText(title)) as HTMLElement

async function openMenu(title: string) {
  await userEvent.click(menuButton(title))
}

describe('RunTaskList', () => {
  describe('rows', () => {
    it('should render one row per task', () => {
      renderList()

      expect(screen.getAllByTestId('run-task-row')).toHaveLength(3)
    })

    it('should render the rows in the given order', () => {
      renderList({ items: [VAT, BANK, INVOICES] })

      expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
        'Oznacz jako gotowe: Raport VAT',
        'Oznacz jako gotowe: Wyciąg bankowy',
        'Oznacz jako gotowe: Faktury kosztowe',
      ])
    })

    it('should show the description under the title', () => {
      renderList()

      expect(screen.queryByText('Pobierz z banku')).not.toBeNull()
    })

    it('should render nothing for an empty list', () => {
      renderList({ items: [] })

      expect(screen.queryAllByTestId('run-task-row')).toHaveLength(0)
    })

    it('should show a status badge for a task in progress', () => {
      renderList({ items: [{ ...BANK, status: 'in_progress' }] })

      expect(within(rowOf('Wyciąg bankowy')).queryByText('W toku')).not.toBeNull()
    })

    it('should show a status badge for a blocked task', () => {
      renderList({ items: [{ ...BANK, status: 'blocked' }] })

      expect(within(rowOf('Wyciąg bankowy')).queryByText('Bloker')).not.toBeNull()
    })

    it('should not show a status badge for a plain todo task', () => {
      renderList({ items: [BANK] })

      expect(within(rowOf('Wyciąg bankowy')).queryByText('Do zrobienia')).toBeNull()
    })
  })

  describe('checkbox', () => {
    it('should call onToggleDone with the task id when clicked', async () => {
      const { onToggleDone } = renderList()

      await userEvent.click(checkbox('Wyciąg bankowy'))

      expect(onToggleDone).toHaveBeenCalledWith('i1')
    })

    it('should call onToggleDone for a done task too, so it can be unticked', async () => {
      const { onToggleDone } = renderList()

      await userEvent.click(checkbox('Faktury kosztowe'))

      expect(onToggleDone).toHaveBeenCalledWith('i2')
    })

    it('should be disabled when canToggle is false', () => {
      renderList({ canToggle: false })

      expect((checkbox('Wyciąg bankowy') as HTMLButtonElement).disabled).toBe(true)
    })

    it('should not call onToggleDone when canToggle is false', async () => {
      const { onToggleDone } = renderList({ canToggle: false })

      await userEvent.click(checkbox('Wyciąg bankowy'))

      expect(onToggleDone).not.toHaveBeenCalled()
    })

    it('should be enabled when canToggle is true', () => {
      renderList({ canToggle: true })

      expect((checkbox('Wyciąg bankowy') as HTMLButtonElement).disabled).toBe(false)
    })

    it('should be checked for a done task', () => {
      renderList()

      expect(checkbox('Faktury kosztowe').getAttribute('aria-checked')).toBe('true')
    })

    it('should be unchecked for a todo task', () => {
      renderList()

      expect(checkbox('Wyciąg bankowy').getAttribute('aria-checked')).toBe('false')
    })

    it('should stay clickable for a task owner who cannot edit the list', async () => {
      const { onToggleDone } = renderList({ canEdit: false, canToggle: true })

      await userEvent.click(checkbox('Wyciąg bankowy'))

      expect(onToggleDone).toHaveBeenCalledWith('i1')
    })
  })

  describe('selection', () => {
    it('should call onSelect with the task id when the title is clicked', async () => {
      const { onSelect } = renderList()

      await userEvent.click(screen.getByText('Faktury kosztowe'))

      expect(onSelect).toHaveBeenCalledWith('i2')
    })

    it('should highlight the selected row', () => {
      renderList({ selectedId: 'i2' })

      expect(rowOf('Faktury kosztowe').className).toContain('bg-gray-50')
    })

    it('should not highlight the other rows', () => {
      renderList({ selectedId: 'i2' })

      expect(rowOf('Wyciąg bankowy').className).not.toContain('bg-gray-50')
    })
  })

  describe('editing controls', () => {
    it('should render a drag handle per task when canEdit is true', () => {
      renderList({ canEdit: true })

      expect(screen.getAllByRole('button', { name: /^Przeciągnij zadanie: / })).toHaveLength(3)
    })

    it('should name the drag handle after the task', () => {
      renderList({ canEdit: true })

      expect(screen.queryByRole('button', { name: 'Przeciągnij zadanie: Raport VAT' })).not.toBeNull()
    })

    it('should not render drag handles when canEdit is false', () => {
      renderList({ canEdit: false })

      expect(screen.queryAllByRole('button', { name: /^Przeciągnij zadanie: / })).toHaveLength(0)
    })

    it('should render a row menu per task when canEdit is true', () => {
      renderList({ canEdit: true })

      expect(screen.getAllByRole('button', { name: /^Opcje zadania: / })).toHaveLength(3)
    })

    it('should not render row menus when canEdit is false', () => {
      renderList({ canEdit: false })

      expect(screen.queryAllByRole('button', { name: /^Opcje zadania: / })).toHaveLength(0)
    })
  })

  describe('recurring marker', () => {
    it('should show the "tylko ten miesiąc" badge for a one-off task', () => {
      renderList()

      expect(within(rowOf('Raport VAT')).queryByText('tylko ten miesiąc')).not.toBeNull()
    })

    it('should not show the repeat icon for a one-off task', () => {
      renderList()

      expect(within(rowOf('Raport VAT')).queryByTitle('Powtarza się co miesiąc')).toBeNull()
    })

    it('should show the repeat icon for a recurring task', () => {
      renderList()

      expect(within(rowOf('Wyciąg bankowy')).queryByTitle('Powtarza się co miesiąc')).not.toBeNull()
    })

    it('should not show the "tylko ten miesiąc" badge for a recurring task', () => {
      renderList()

      expect(within(rowOf('Wyciąg bankowy')).queryByText('tylko ten miesiąc')).toBeNull()
    })
  })

  describe('row menu', () => {
    it('should keep the menu closed until the button is clicked', () => {
      renderList()

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('should open a menu with "Edytuj" and "Usuń"', async () => {
      renderList()

      await openMenu('Wyciąg bankowy')

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edytuj', 'Usuń'])
    })

    it('should call onEdit with the task id when "Edytuj" is clicked', async () => {
      const { onEdit } = renderList()
      await openMenu('Faktury kosztowe')

      await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj' }))

      expect(onEdit).toHaveBeenCalledWith('i2')
    })

    it('should close the menu after "Edytuj" is clicked', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')

      await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj' }))

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('should close the menu when Escape is pressed', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')

      await userEvent.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('should close the menu when the page is clicked elsewhere', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')

      await userEvent.click(document.body)

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('should close the menu when its button is clicked again', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')

      await openMenu('Wyciąg bankowy')

      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  describe('delete confirmation', () => {
    it('should ask "Usunąć to zadanie?" after "Usuń" is clicked', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')

      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      expect(screen.queryByText('Usunąć to zadanie?')).not.toBeNull()
    })

    it('should not call onDelete before the deletion is confirmed', async () => {
      const { onDelete } = renderList()
      await openMenu('Wyciąg bankowy')

      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      expect(onDelete).not.toHaveBeenCalled()
    })

    it('should call onDelete with the task id when "Tak, usuń" is clicked', async () => {
      const { onDelete } = renderList()
      await openMenu('Faktury kosztowe')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      await userEvent.click(screen.getByRole('button', { name: 'Tak, usuń' }))

      expect(onDelete).toHaveBeenCalledWith('i2')
    })

    it('should close the menu after the deletion is confirmed', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      await userEvent.click(screen.getByRole('button', { name: 'Tak, usuń' }))

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('should not call onDelete when "Nie" is clicked', async () => {
      const { onDelete } = renderList()
      await openMenu('Wyciąg bankowy')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      await userEvent.click(screen.getByRole('button', { name: 'Nie' }))

      expect(onDelete).not.toHaveBeenCalled()
    })

    it('should return to "Edytuj" and "Usuń" when "Nie" is clicked', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))

      await userEvent.click(screen.getByRole('button', { name: 'Nie' }))

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edytuj', 'Usuń'])
    })

    it('should ask again after the menu is closed and reopened', async () => {
      renderList()
      await openMenu('Wyciąg bankowy')
      await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }))
      await userEvent.keyboard('{Escape}')

      await openMenu('Wyciąg bankowy')

      expect(screen.queryByText('Usunąć to zadanie?')).toBeNull()
    })
  })

  // jsdom has no layout, so the rows are given fixed 40px boxes in DOM order. dnd-kit's keyboard sensor can then
  // move a row to the next/previous slot, which exercises handleDragEnd without a real pointer.
  describe('keyboard reordering', () => {
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const rows = Array.from(document.querySelectorAll('[data-testid="run-task-row"]'))
        const top = Math.max(rows.indexOf(this), 0) * 40
        return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 40, width: 300, height: 40, toJSON() {} } as DOMRect
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    async function pickUp(title: string) {
      screen.getByRole('button', { name: `Przeciągnij zadanie: ${title}` }).focus()
      await userEvent.keyboard(' ')
    }

    it('should report the new order when a task is moved one slot down', async () => {
      const { onReorder } = renderList()
      await pickUp('Wyciąg bankowy')

      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard(' ')

      expect(onReorder).toHaveBeenCalledWith(['i2', 'i1', 'i3'])
    })

    it('should report the new order when a task is moved one slot up', async () => {
      const { onReorder } = renderList()
      await pickUp('Raport VAT')

      await userEvent.keyboard('{ArrowUp}')
      await userEvent.keyboard(' ')

      expect(onReorder).toHaveBeenCalledWith(['i1', 'i3', 'i2'])
    })

    it('should not report an order when the task is dropped where it was', async () => {
      const { onReorder } = renderList()
      await pickUp('Wyciąg bankowy')

      await userEvent.keyboard(' ')

      expect(onReorder).not.toHaveBeenCalled()
    })

    it('should not report an order when the drag is cancelled with Escape', async () => {
      const { onReorder } = renderList()
      await pickUp('Wyciąg bankowy')

      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard('{Escape}')

      expect(onReorder).not.toHaveBeenCalled()
    })
  })
})
