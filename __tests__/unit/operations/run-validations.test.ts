import { describe, expect, it } from 'vitest'
import {
  CreateChecklistRunItemSchema,
  ReorderChecklistRunItemsSchema,
  RUN_ITEM_STRUCTURE_FIELDS,
  UpdateChecklistRunItemSchema,
} from '@/lib/validations/operations'

describe('CreateChecklistRunItemSchema', () => {
  it('should default recurring to true', () => {
    const parsed = CreateChecklistRunItemSchema.parse({ title: 'Faktura od dostawcy' })

    expect(parsed.recurring).toBe(true)
  })

  it('should accept null description and null procedure from the form', () => {
    const result = CreateChecklistRunItemSchema.safeParse({
      title: 'Faktura od dostawcy',
      description: null,
      procedureId: null,
      recurring: false,
    })

    expect(result.success).toBe(true)
  })

  it('should keep a one-off task as non-recurring', () => {
    const parsed = CreateChecklistRunItemSchema.parse({ title: 'Faktura od dostawcy', recurring: false })

    expect(parsed.recurring).toBe(false)
  })

  it('should trim the title', () => {
    const parsed = CreateChecklistRunItemSchema.parse({ title: '  Faktura od dostawcy  ' })

    expect(parsed.title).toBe('Faktura od dostawcy')
  })

  it('should reject a title shorter than 3 characters', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'ab' }).success).toBe(false)
  })

  it('should reject a title longer than 200 characters', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false)
  })

  it('should accept a title of exactly 200 characters', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'a'.repeat(200) }).success).toBe(true)
  })

  it('should reject a description longer than 2000 characters', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'Faktura', description: 'a'.repeat(2001) }).success).toBe(false)
  })

  it('should reject an empty procedure id', () => {
    expect(CreateChecklistRunItemSchema.safeParse({ title: 'Faktura', procedureId: '' }).success).toBe(false)
  })
})

describe('UpdateChecklistRunItemSchema', () => {
  it('should accept switching recurring off', () => {
    expect(UpdateChecklistRunItemSchema.parse({ recurring: false })).toEqual({ recurring: false })
  })

  it('should reject a non-boolean recurring value', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ recurring: 'no' }).success).toBe(false)
  })

  it('should accept unlinking a procedure with null', () => {
    expect(UpdateChecklistRunItemSchema.parse({ procedureId: null })).toEqual({ procedureId: null })
  })

  it('should reject an empty procedure id', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ procedureId: '' }).success).toBe(false)
  })

  it('should accept clearing the description with null', () => {
    expect(UpdateChecklistRunItemSchema.parse({ description: null })).toEqual({ description: null })
  })

  it('should trim the description', () => {
    expect(UpdateChecklistRunItemSchema.parse({ description: '  Opis  ' })).toEqual({ description: 'Opis' })
  })

  it('should reject a description longer than 2000 characters', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false)
  })

  it('should accept a status-only update as before', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ status: 'done' }).success).toBe(true)
  })

  it('should trim the title', () => {
    expect(UpdateChecklistRunItemSchema.parse({ title: '  Faktura  ' })).toEqual({ title: 'Faktura' })
  })

  it('should reject a title shorter than 3 characters', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ title: 'x' }).success).toBe(false)
  })

  it('should reject a title longer than 200 characters', () => {
    expect(UpdateChecklistRunItemSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false)
  })
})

describe('RUN_ITEM_STRUCTURE_FIELDS', () => {
  it('should list exactly the update fields that are neither status, note nor owner', () => {
    const structureKeys = Object.keys(UpdateChecklistRunItemSchema.shape).filter(
      (key) => !['status', 'note', 'ownerId'].includes(key),
    )

    expect([...RUN_ITEM_STRUCTURE_FIELDS].sort()).toEqual(structureKeys.sort())
  })
})

describe('ReorderChecklistRunItemsSchema', () => {
  it('should accept a list of item ids', () => {
    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds: ['a', 'b'] }).success).toBe(true)
  })

  it('should reject an empty list', () => {
    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds: [] }).success).toBe(false)
  })

  it('should reject an empty item id', () => {
    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds: ['a', ''] }).success).toBe(false)
  })

  it('should accept exactly 200 item ids', () => {
    const itemIds = Array.from({ length: 200 }, (_, index) => `item-${index}`)

    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds }).success).toBe(true)
  })

  it('should reject more than 200 item ids', () => {
    const itemIds = Array.from({ length: 201 }, (_, index) => `item-${index}`)

    expect(ReorderChecklistRunItemsSchema.safeParse({ itemIds }).success).toBe(false)
  })
})
