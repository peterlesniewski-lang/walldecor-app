import { describe, expect, it } from 'vitest'
import { selectedOptionValues } from '@/lib/forms/select-options'

describe('selectedOptionValues', () => {
  it('copies selected multi-select values into a stable array', () => {
    const select = document.createElement('select')
    select.multiple = true

    for (const [value, selected] of [
      ['tag-fixed', false],
      ['tag-goods', true],
      ['tag-contractors', true],
    ] as const) {
      const option = document.createElement('option')
      option.value = value
      option.selected = selected
      select.append(option)
    }

    const values = selectedOptionValues(select)
    Array.from(select.options).forEach((option) => {
      option.selected = false
    })

    expect(values).toEqual(['tag-goods', 'tag-contractors'])
  })
})
