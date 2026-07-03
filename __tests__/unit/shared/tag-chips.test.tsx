import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TagChips } from '@/components/shared/tag-chips'

const groups = [
  {
    id: 'group-behavior',
    name: 'Charakter kosztu',
    slug: 'behavior',
    tags: [
      { id: 'tag-fixed', name: 'Stały', slug: 'fixed' },
      { id: 'tag-variable', name: 'Zmienny', slug: 'variable' },
    ],
  },
  {
    id: 'group-role',
    name: 'Typ wydatku',
    slug: 'role',
    tags: [
      { id: 'tag-goods', name: 'Zakup towarów i materiałów', slug: 'goods' },
    ],
  },
]

describe('TagChips', () => {
  it('shows helper tooltips for groups and tags', () => {
    render(<TagChips groups={groups} value={[]} onChange={() => {}} />)

    expect(screen.getByTitle(/break-even/)).toBeTruthy()
    expect(screen.getByTitle(/abonament/)).toBeTruthy()
    expect(screen.getByTitle(/towarów i materiałów/i)).toBeTruthy()
  })

  it('creates a custom tag in open groups and selects it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onCreateTag = vi.fn().mockResolvedValue({
      id: 'tag-legal',
      name: 'Usługi prawne',
      slug: 'uslugi-prawne',
    })

    render(<TagChips groups={groups} value={[]} onChange={onChange} onCreateTag={onCreateTag} />)

    expect(screen.queryByRole('button', { name: 'Dodaj tag do Charakter kosztu' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Dodaj tag do Typ wydatku' }))
    const form = screen.getByRole('form', { name: 'Dodaj tag do Typ wydatku' })
    await user.type(within(form).getByLabelText('Nowy tag w Typ wydatku'), 'Usługi prawne')
    await user.click(within(form).getByRole('button', { name: 'Zapisz nowy tag' }))

    expect(onCreateTag).toHaveBeenCalledWith(groups[1], 'Usługi prawne')
    expect(onChange).toHaveBeenCalledWith(['tag-legal'])
  })
})
