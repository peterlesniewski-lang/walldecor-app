import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@/generated/prisma'
import { z } from 'zod'
import {
  type InstallationQuestionDefinition,
  InstallationQuestionSchemaError,
  validateInstallationQuestionDefinitions,
} from './question-schema'
import { INSTALLATION_ROLES, type InstallationRole } from './constants'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export class InstallationCatalogValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors).join(' ') || 'Dane katalogu montaży są niepoprawne.')
    this.name = 'InstallationCatalogValidationError'
  }
}

const requiredName = z.string().trim().min(1, 'Nazwa jest wymagana.').max(160)
const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().min(1).max(160).nullish(),
)
const optionalSortOrder = z.number().int().min(0).optional()

const categoryCreateSchema = z.object({ name: requiredName, sortOrder: optionalSortOrder }).strict()
const categoryUpdateSchema = z.object({ name: requiredName.optional(), sortOrder: optionalSortOrder }).strict()
const typeCreateSchema = z.object({ categoryId: z.string().trim().min(1), name: requiredName, sortOrder: optionalSortOrder }).strict()
const typeUpdateSchema = z.object({ name: requiredName.optional(), sortOrder: optionalSortOrder }).strict()
const productCreateSchema = z.object({
  typeId: z.string().trim().min(1), name: requiredName, manufacturer: optionalText, collection: optionalText, code: optionalText, sortOrder: optionalSortOrder,
}).strict()
const productUpdateSchema = z.object({
  name: requiredName.optional(), manufacturer: optionalText, collection: optionalText, code: optionalText, sortOrder: optionalSortOrder,
}).strict()
const templateCreateSchema = z.object({
  name: requiredName,
  actorId: z.string().trim().min(1).optional(),
  questions: z.unknown().optional(),
}).strict()
const templateUpdateSchema = z.object({ name: requiredName.optional(), questions: z.unknown().optional() }).strict()
const roomCreateSchema = z.object({ name: requiredName, sortOrder: optionalSortOrder }).strict()
const roomUpdateSchema = z.object({ name: requiredName.optional(), sortOrder: optionalSortOrder }).strict()
const scopeCreateSchema = z.object({ name: requiredName, sortOrder: optionalSortOrder }).strict()
const scopeUpdateSchema = z.object({ name: requiredName.optional(), sortOrder: optionalSortOrder }).strict()
const scopeProductCreateSchema = z.object({ catalogProductId: z.string().trim().min(1), sortOrder: optionalSortOrder }).strict()
const measurementCreateSchema = z.object({
  scopeId: z.string().trim().min(1).nullish(),
  elementName: requiredName,
  value: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Wartość musi być dziesiętnym tekstem bez notacji float.'),
  unit: z.enum(['MM', 'CM', 'M', 'M2']),
})
const measurementUpdateSchema = z.object({
  scopeId: z.string().trim().min(1).nullable().optional(),
  elementName: requiredName.optional(),
  value: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Wartość musi być dziesiętnym tekstem bez notacji float.').optional(),
  unit: z.enum(['MM', 'CM', 'M', 'M2']).optional(),
})

export type InstallationMeasurementActor = {
  userId: string
  role: InstallationRole
  /** Active employee identity derived from the authenticated session, when one exists. */
  employeeId: string | null
}

function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]))
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new InstallationCatalogValidationError(fieldErrors(result.error))
  return result.data
}

/** NFC + collapsed whitespace + Polish case fold is the catalog uniqueness policy. */
export function normalizeInstallationCatalogName(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL')
}

function optionalValue(value: string | null | undefined) {
  return value === undefined ? undefined : value ?? null
}

function validationError(field: string, message: string): never {
  throw new InstallationCatalogValidationError({ [field]: message })
}

async function nextSortOrder(db: InstallationDb, model: 'category' | 'type' | 'product' | 'room' | 'scope' | 'scopeProduct', parentId?: string) {
  if (model === 'category') {
    const result = await db.installationCatalogCategory.aggregate({ _max: { sortOrder: true } })
    return (result._max.sortOrder ?? -1) + 1
  }
  if (model === 'type') {
    const result = await db.installationCatalogType.aggregate({ where: { categoryId: parentId }, _max: { sortOrder: true } })
    return (result._max.sortOrder ?? -1) + 1
  }
  if (model === 'product') {
    const result = await db.installationCatalogProduct.aggregate({ where: { typeId: parentId }, _max: { sortOrder: true } })
    return (result._max.sortOrder ?? -1) + 1
  }
  if (model === 'room') {
    const result = await db.installationRoom.aggregate({ where: { orderId: parentId }, _max: { sortOrder: true } })
    return (result._max.sortOrder ?? -1) + 1
  }
  if (model === 'scope') {
    const result = await db.installationScope.aggregate({ where: { roomId: parentId }, _max: { sortOrder: true } })
    return (result._max.sortOrder ?? -1) + 1
  }
  const result = await db.installationScopeProduct.aggregate({ where: { scopeId: parentId }, _max: { sortOrder: true } })
  return (result._max.sortOrder ?? -1) + 1
}

function duplicateNameError() {
  return new InstallationCatalogValidationError({ name: 'Nazwa musi być unikalna na tym poziomie katalogu.' })
}

function translateCatalogError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateNameError()
  throw error
}

export async function createCatalogCategory(db: InstallationDb, input: unknown) {
  const value = parse(categoryCreateSchema, input)
  try {
    return await db.installationCatalogCategory.create({
      data: { name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name), sortOrder: value.sortOrder ?? await nextSortOrder(db, 'category') },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function updateCatalogCategory(db: InstallationDb, id: string, input: unknown) {
  const value = parse(categoryUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę kategorii.')
  try {
    return await db.installationCatalogCategory.update({
      where: { id },
      data: {
        ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name) }),
        ...(value.sortOrder === undefined ? {} : { sortOrder: value.sortOrder }),
      },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function archiveCatalogCategory(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const now = new Date()
    await tx.installationCatalogProduct.updateMany({ where: { type: { categoryId: id } }, data: { isActive: false, archivedAt: now } })
    await tx.installationCatalogType.updateMany({ where: { categoryId: id }, data: { isActive: false, archivedAt: now } })
    return tx.installationCatalogCategory.update({ where: { id }, data: { isActive: false, archivedAt: now } })
  })
}

export async function createCatalogType(db: InstallationDb, input: unknown) {
  const value = parse(typeCreateSchema, input)
  const category = await db.installationCatalogCategory.findUnique({ where: { id: value.categoryId }, select: { isActive: true } })
  if (!category?.isActive) validationError('categoryId', 'Wybierz aktywną kategorię katalogu.')
  try {
    return await db.installationCatalogType.create({
      data: { categoryId: value.categoryId, name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name), sortOrder: value.sortOrder ?? await nextSortOrder(db, 'type', value.categoryId) },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function updateCatalogType(db: InstallationDb, id: string, input: unknown) {
  const value = parse(typeUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę typu.')
  try {
    return await db.installationCatalogType.update({
      where: { id },
      data: {
        ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name) }),
        ...(value.sortOrder === undefined ? {} : { sortOrder: value.sortOrder }),
      },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function archiveCatalogType(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const now = new Date()
    await tx.installationCatalogProduct.updateMany({ where: { typeId: id }, data: { isActive: false, archivedAt: now } })
    return tx.installationCatalogType.update({ where: { id }, data: { isActive: false, archivedAt: now } })
  })
}

export async function createCatalogProduct(db: InstallationDb, input: unknown) {
  const value = parse(productCreateSchema, input)
  const type = await db.installationCatalogType.findUnique({ where: { id: value.typeId }, include: { category: { select: { isActive: true } } } })
  if (!type?.isActive || !type.category.isActive) validationError('typeId', 'Wybierz aktywny typ katalogu.')
  try {
    return await db.installationCatalogProduct.create({
      data: {
        typeId: value.typeId,
        name: value.name.trim().replace(/\s+/g, ' '),
        nameKey: normalizeInstallationCatalogName(value.name),
        manufacturer: optionalValue(value.manufacturer), collection: optionalValue(value.collection), code: optionalValue(value.code),
        sortOrder: value.sortOrder ?? await nextSortOrder(db, 'product', value.typeId),
      },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function updateCatalogProduct(db: InstallationDb, id: string, input: unknown) {
  const value = parse(productUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę produktu.')
  try {
    return await db.installationCatalogProduct.update({
      where: { id },
      data: {
        ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name) }),
        ...(value.manufacturer === undefined ? {} : { manufacturer: optionalValue(value.manufacturer) }),
        ...(value.collection === undefined ? {} : { collection: optionalValue(value.collection) }),
        ...(value.code === undefined ? {} : { code: optionalValue(value.code) }),
        ...(value.sortOrder === undefined ? {} : { sortOrder: value.sortOrder }),
      },
    })
  } catch (error) { translateCatalogError(error) }
}

export async function archiveCatalogProduct(db: InstallationDb, id: string) {
  return db.installationCatalogProduct.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } })
}

async function reorderRows<T extends { id: string }>(rows: T[], orderedIds: string[], update: (id: string, sortOrder: number) => Promise<unknown>) {
  if (new Set(orderedIds).size !== orderedIds.length || rows.length !== orderedIds.length || rows.some((row) => !orderedIds.includes(row.id))) {
    validationError('orderedIds', 'Kolejność musi zawierać każdą pozycję nadrzędnego elementu dokładnie raz.')
  }
  await Promise.all(orderedIds.map((id, sortOrder) => update(id, sortOrder)))
}

export async function reorderCatalogCategories(db: InstallationDb, orderedIds: string[]) {
  const rows = await db.installationCatalogCategory.findMany({ select: { id: true } })
  return reorderRows(rows, orderedIds, (id, sortOrder) => db.installationCatalogCategory.update({ where: { id }, data: { sortOrder } }))
}

export async function reorderCatalogTypes(db: InstallationDb, categoryId: string, orderedIds: string[]) {
  const rows = await db.installationCatalogType.findMany({ where: { categoryId }, select: { id: true } })
  return reorderRows(rows, orderedIds, (id, sortOrder) => db.installationCatalogType.update({ where: { id }, data: { sortOrder } }))
}

export async function reorderCatalogProducts(db: InstallationDb, typeId: string, orderedIds: string[]) {
  const rows = await db.installationCatalogProduct.findMany({ where: { typeId }, select: { id: true } })
  return reorderRows(rows, orderedIds, (id, sortOrder) => db.installationCatalogProduct.update({ where: { id }, data: { sortOrder } }))
}

export async function listInstallationCatalog(db: InstallationDb, options: { includeInactive?: boolean } = {}) {
  const activeOnly = options.includeInactive ? {} : { isActive: true }
  return db.installationCatalogCategory.findMany({
    where: activeOnly,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      types: {
        where: activeOnly,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { products: { where: activeOnly, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      },
    },
  })
}

function toPersistedQuestions(templateId: string, questions: InstallationQuestionDefinition[]) {
  return questions.map((question, sortOrder) => ({
    templateId,
    key: question.key,
    type: question.type,
    label: question.label,
    help: question.help ?? null,
    riskLevel: question.riskLevel ?? 'LOW',
    optionsJson: question.options ? JSON.stringify(question.options) : null,
    conditionJson: question.condition ? JSON.stringify({ questionKey: question.condition.questionKey, equals: question.condition.equals }) : null,
    sortOrder,
  }))
}

function parsedPersistedQuestions(templateId: string, questions: Array<{ key: string; type: string; label: string; help: string | null; riskLevel: string; optionsJson: string | null; conditionJson: string | null }>) {
  const result = questions.map((question) => ({
    key: question.key,
    type: question.type,
    label: question.label,
    ...(question.help ? { help: question.help } : {}),
    ...(question.riskLevel === 'LOW' ? {} : { riskLevel: question.riskLevel }),
    ...(question.optionsJson ? { options: JSON.parse(question.optionsJson) } : {}),
    ...(question.conditionJson ? { condition: JSON.parse(question.conditionJson) } : {}),
  }))
  try {
    return validateInstallationQuestionDefinitions(templateId, result)
  } catch (error) {
    if (error instanceof InstallationQuestionSchemaError) throw new InstallationCatalogValidationError({ questions: error.message })
    throw error
  }
}

const templateInclude = {
  questionDefinitions: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
} satisfies Prisma.InstallationFormTemplateInclude

async function getTemplateOrThrow(db: InstallationDb, id: string) {
  const template = await db.installationFormTemplate.findUnique({ where: { id }, include: templateInclude })
  if (!template) validationError('templateId', 'Szablon nie istnieje.')
  return template
}

export async function getInstallationFormTemplate(db: InstallationDb, id: string) {
  return db.installationFormTemplate.findUnique({ where: { id }, include: templateInclude })
}

export async function listInstallationFormTemplates(db: InstallationDb) {
  return db.installationFormTemplate.findMany({
    include: templateInclude,
    orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
  })
}

/** A card owns one immutable form instance; Task 3 reads this exact record. */
export async function getInstallationOrderFormSnapshot(db: InstallationDb, orderId: string) {
  return db.installationOrderFormSnapshot.findUnique({ where: { orderId } })
}

export async function createInstallationFormTemplate(db: PrismaClient, input: unknown) {
  const value = parse(templateCreateSchema, input)
  const familyId = randomUUID()
  return db.$transaction(async (tx) => {
    const template = await tx.installationFormTemplate.create({
      data: {
        familyId, name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name), version: 1, status: 'DRAFT', createdById: value.actorId ?? null,
      },
    })
    const questions = value.questions === undefined ? [] : validateQuestionsForTemplate(template.id, value.questions)
    if (questions.length > 0) await tx.installationQuestionDefinition.createMany({ data: toPersistedQuestions(template.id, questions) })
    return getTemplateOrThrow(tx, template.id)
  })
}

function validateQuestionsForTemplate(templateId: string, questions: unknown) {
  try {
    return validateInstallationQuestionDefinitions(templateId, questions)
  } catch (error) {
    if (error instanceof InstallationQuestionSchemaError) throw new InstallationCatalogValidationError({ questions: error.message })
    throw error
  }
}

export async function updateInstallationFormTemplateDraft(db: PrismaClient, id: string, input: unknown, actorId: string) {
  const value = parse(templateUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę szkicu szablonu.')
  return db.$transaction(async (tx) => {
    const current = await getTemplateOrThrow(tx, id)
    if (current.status !== 'DRAFT') validationError('templateId', 'Opublikowana wersja szablonu jest niemutowalna.')
    const questions = value.questions === undefined ? undefined : validateQuestionsForTemplate(id, value.questions)
    if (questions) {
      await tx.installationQuestionDefinition.deleteMany({ where: { templateId: id } })
      if (questions.length > 0) await tx.installationQuestionDefinition.createMany({ data: toPersistedQuestions(id, questions) })
    }
    await tx.installationFormTemplate.update({
      where: { id },
      data: {
        ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' '), nameKey: normalizeInstallationCatalogName(value.name) }),
        createdById: actorId,
      },
    })
    return getTemplateOrThrow(tx, id)
  })
}

export async function publishInstallationFormTemplate(db: PrismaClient, id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const template = await getTemplateOrThrow(tx, id)
    if (template.status === 'PUBLISHED') return template
    if (template.questionDefinitions.length === 0) validationError('questions', 'Nie można opublikować szablonu bez pytań.')
    parsedPersistedQuestions(template.id, template.questionDefinitions)
    await tx.installationFormTemplate.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), createdById: actorId } })
    return getTemplateOrThrow(tx, id)
  })
}

export async function createNextInstallationFormTemplateDraft(db: PrismaClient, publishedTemplateId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const source = await getTemplateOrThrow(tx, publishedTemplateId)
    if (source.status !== 'PUBLISHED') validationError('templateId', 'Nowy szkic można utworzyć wyłącznie z opublikowanej wersji.')
    const latest = await tx.installationFormTemplate.findFirst({ where: { familyId: source.familyId }, orderBy: { version: 'desc' }, select: { version: true } })
    const draft = await tx.installationFormTemplate.create({
      data: { familyId: source.familyId, name: source.name, nameKey: source.nameKey, version: (latest?.version ?? source.version) + 1, status: 'DRAFT', createdById: actorId },
    })
    const questions = parsedPersistedQuestions(source.id, source.questionDefinitions)
    if (questions.length > 0) await tx.installationQuestionDefinition.createMany({ data: toPersistedQuestions(draft.id, questions) })
    return getTemplateOrThrow(tx, draft.id)
  })
}

export async function createInstallationOrderFormSnapshot(db: PrismaClient, input: { orderId: string; templateId: string }, actorId: string) {
  return db.$transaction(async (tx) => {
    const [, template] = await Promise.all([
      assertActiveInstallationOrder(tx, input.orderId),
      getTemplateOrThrow(tx, input.templateId),
    ])
    if (template.status !== 'PUBLISHED') validationError('templateId', 'Snapshot wymaga opublikowanej wersji szablonu.')
    const existing = await tx.installationOrderFormSnapshot.findUnique({ where: { orderId: input.orderId }, select: { id: true } })
    if (existing) validationError('orderId', 'Karta ma już przypięty niezmienny formularz.')
    const questions = parsedPersistedQuestions(template.id, template.questionDefinitions)
    try {
      return await tx.installationOrderFormSnapshot.create({
        data: {
          orderId: input.orderId,
          templateId: template.id,
          templateVersion: template.version,
          schemaJson: JSON.stringify({ familyId: template.familyId, templateId: template.id, name: template.name, version: template.version, questions }),
          createdById: actorId,
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        validationError('orderId', 'Karta ma już przypięty niezmienny formularz.')
      }
      translateCatalogError(error)
    }
  })
}

const roomInclude = {
  scopes: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { scopeProducts: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }, measurements: { orderBy: { createdAt: 'asc' } } },
  },
  measurements: { where: { scopeId: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.InstallationRoomInclude

async function getRoomOrThrow(db: InstallationDb, id: string) {
  const room = await db.installationRoom.findUnique({ where: { id }, include: roomInclude })
  if (!room) validationError('roomId', 'Pomieszczenie nie istnieje.')
  return room
}

async function getScopeOrThrow(db: InstallationDb, id: string) {
  const scope = await db.installationScope.findUnique({ where: { id }, include: { room: { select: { orderId: true } } } })
  if (!scope) validationError('scopeId', 'Zakres nie istnieje.')
  return scope
}

async function assertActiveInstallationOrder(db: InstallationDb, orderId: string) {
  const order = await db.installationOrder.findUnique({ where: { id: orderId }, select: { archivedAt: true, status: true } })
  if (!order || order.archivedAt || order.status === 'ARCHIVED') validationError('orderId', 'Nie można zmienić nieistniejącej lub zarchiwizowanej karty.')
  return order
}

async function assertActiveRoomOrder(db: InstallationDb, room: { orderId: string }) {
  await assertActiveInstallationOrder(db, room.orderId)
}

async function assertActiveScopeOrder(db: InstallationDb, scope: { room: { orderId: string } }) {
  await assertActiveInstallationOrder(db, scope.room.orderId)
}

async function audit(db: InstallationDb, orderId: string, actorId: string, action: string, beforeJson?: string | null, afterJson?: string | null) {
  return db.installationAuditEvent.create({ data: { orderId, actorId, action, beforeJson: beforeJson ?? null, afterJson: afterJson ?? null } })
}

export async function createInstallationRoom(db: PrismaClient, orderId: string, input: unknown, actorId: string) {
  const value = parse(roomCreateSchema, input)
  return db.$transaction(async (tx) => {
    await assertActiveInstallationOrder(tx, orderId)
    const room = await tx.installationRoom.create({ data: { orderId, name: value.name.trim().replace(/\s+/g, ' '), sortOrder: value.sortOrder ?? await nextSortOrder(tx, 'room', orderId) }, include: roomInclude })
    await audit(tx, orderId, actorId, 'INSTALLATION_ROOM_CREATED', null, JSON.stringify({ id: room.id, name: room.name }))
    return room
  })
}

export async function updateInstallationRoom(db: PrismaClient, id: string, input: unknown, actorId: string) {
  const value = parse(roomUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę pomieszczenia.')
  return db.$transaction(async (tx) => {
    const current = await getRoomOrThrow(tx, id)
    await assertActiveRoomOrder(tx, current)
    const updated = await tx.installationRoom.update({ where: { id }, data: { ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' ') }), ...(value.sortOrder === undefined ? {} : { sortOrder: value.sortOrder }) }, include: roomInclude })
    await audit(tx, current.orderId, actorId, 'INSTALLATION_ROOM_UPDATED', JSON.stringify({ id: current.id, name: current.name, sortOrder: current.sortOrder }), JSON.stringify({ id: updated.id, name: updated.name, sortOrder: updated.sortOrder }))
    return updated
  })
}

export async function deleteInstallationRoom(db: PrismaClient, id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await getRoomOrThrow(tx, id)
    await assertActiveRoomOrder(tx, current)
    await tx.installationRoom.delete({ where: { id } })
    await audit(tx, current.orderId, actorId, 'INSTALLATION_ROOM_DELETED', JSON.stringify({ id: current.id, name: current.name }), null)
  })
}

export async function createInstallationScope(db: PrismaClient, roomId: string, input: unknown, actorId: string) {
  const value = parse(scopeCreateSchema, input)
  return db.$transaction(async (tx) => {
    const room = await getRoomOrThrow(tx, roomId)
    await assertActiveRoomOrder(tx, room)
    const scope = await tx.installationScope.create({ data: { roomId, name: value.name.trim().replace(/\s+/g, ' '), sortOrder: value.sortOrder ?? await nextSortOrder(tx, 'scope', roomId) }, include: { scopeProducts: true, measurements: true } })
    await audit(tx, room.orderId, actorId, 'INSTALLATION_SCOPE_CREATED', null, JSON.stringify({ id: scope.id, name: scope.name, roomId }))
    return scope
  })
}

export async function updateInstallationScope(db: PrismaClient, id: string, input: unknown, actorId: string) {
  const value = parse(scopeUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę zakresu.')
  return db.$transaction(async (tx) => {
    const current = await getScopeOrThrow(tx, id)
    await assertActiveScopeOrder(tx, current)
    const updated = await tx.installationScope.update({ where: { id }, data: { ...(value.name === undefined ? {} : { name: value.name.trim().replace(/\s+/g, ' ') }), ...(value.sortOrder === undefined ? {} : { sortOrder: value.sortOrder }) }, include: { scopeProducts: true, measurements: true } })
    await audit(tx, current.room.orderId, actorId, 'INSTALLATION_SCOPE_UPDATED', JSON.stringify({ id: current.id, name: current.name, sortOrder: current.sortOrder }), JSON.stringify({ id: updated.id, name: updated.name, sortOrder: updated.sortOrder }))
    return updated
  })
}

export async function deleteInstallationScope(db: PrismaClient, id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await getScopeOrThrow(tx, id)
    await assertActiveScopeOrder(tx, current)
    await tx.installationScope.delete({ where: { id } })
    await audit(tx, current.room.orderId, actorId, 'INSTALLATION_SCOPE_DELETED', JSON.stringify({ id: current.id, name: current.name }), null)
  })
}

export async function addInstallationScopeProduct(db: PrismaClient, scopeId: string, input: unknown, actorId: string) {
  const value = parse(scopeProductCreateSchema, input)
  return db.$transaction(async (tx) => {
    const [scope, product] = await Promise.all([
      getScopeOrThrow(tx, scopeId),
      tx.installationCatalogProduct.findUnique({ where: { id: value.catalogProductId }, include: { type: { include: { category: true } } } }),
    ])
    await assertActiveScopeOrder(tx, scope)
    if (!product?.isActive || !product.type.isActive || !product.type.category.isActive) validationError('catalogProductId', 'Nowy zakres może użyć tylko aktywnego produktu katalogowego.')
    const scopeProduct = await tx.installationScopeProduct.create({
      data: {
        scopeId, catalogProductId: product.id, productNameSnapshot: product.name, productCodeSnapshot: product.code,
        manufacturerSnapshot: product.manufacturer, collectionSnapshot: product.collection,
        sortOrder: value.sortOrder ?? await nextSortOrder(tx, 'scopeProduct', scopeId),
      },
    })
    await audit(tx, scope.room.orderId, actorId, 'INSTALLATION_SCOPE_PRODUCT_ADDED', null, JSON.stringify({ id: scopeProduct.id, catalogProductId: product.id, productNameSnapshot: product.name }))
    return scopeProduct
  })
}

export async function deleteInstallationScopeProduct(db: PrismaClient, id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.installationScopeProduct.findUnique({ where: { id }, include: { scope: { include: { room: { select: { orderId: true } } } } } })
    if (!current) validationError('scopeProductId', 'Produkt zakresu nie istnieje.')
    await assertActiveInstallationOrder(tx, current.scope.room.orderId)
    await tx.installationScopeProduct.delete({ where: { id } })
    await audit(tx, current.scope.room.orderId, actorId, 'INSTALLATION_SCOPE_PRODUCT_DELETED', JSON.stringify({ id: current.id, productNameSnapshot: current.productNameSnapshot }), null)
  })
}

function measurementAuditSnapshot(measurement: { id: string; roomId: string; scopeId: string | null; elementName: string; value: { toString(): string }; unit: string; source: string; authorId: string | null; authorContext: string | null; actorUserId: string | null; actorRole: string | null; createdAt: Date }) {
  return { id: measurement.id, roomId: measurement.roomId, scopeId: measurement.scopeId, elementName: measurement.elementName, value: measurement.value.toString(), unit: measurement.unit, source: measurement.source, authorId: measurement.authorId, authorContext: measurement.authorContext, actorUserId: measurement.actorUserId, actorRole: measurement.actorRole, createdAt: measurement.createdAt.toISOString() }
}

function measurementProvenance(actor: InstallationMeasurementActor) {
  if (!actor.userId || !INSTALLATION_ROLES.includes(actor.role)) validationError('actor', 'Brak poprawnego kontekstu uwierzytelnionego użytkownika.')
  if ((actor.role === 'EMPLOYEE' || actor.role === 'INSTALLER') && !actor.employeeId) validationError('actor', 'Brak aktywnego pracownika dla autora pomiaru.')
  return {
    source: actor.role === 'INSTALLER' ? 'INSTALLER' : 'EMPLOYEE',
    authorId: actor.employeeId,
    authorContext: `${actor.role}:${actor.userId}`,
    actorUserId: actor.userId,
    actorRole: actor.role,
  }
}

async function assertMeasurementScopeBelongsToRoom(db: InstallationDb, roomId: string, scopeId: string | null | undefined) {
  if (!scopeId) return
  const scope = await db.installationScope.findUnique({ where: { id: scopeId }, select: { roomId: true } })
  if (!scope || scope.roomId !== roomId) validationError('scopeId', 'Zakres pomiaru musi należeć do tego samego pomieszczenia.')
}

export async function addInstallationMeasurement(db: PrismaClient, roomId: string, input: unknown, actor: InstallationMeasurementActor) {
  const value = parse(measurementCreateSchema, input)
  return db.$transaction(async (tx) => {
    const room = await getRoomOrThrow(tx, roomId)
    await assertActiveRoomOrder(tx, room)
    await assertMeasurementScopeBelongsToRoom(tx, roomId, value.scopeId)
    const measurement = await tx.installationMeasurement.create({ data: { roomId, scopeId: value.scopeId ?? null, elementName: value.elementName.trim().replace(/\s+/g, ' '), value: value.value, unit: value.unit, ...measurementProvenance(actor) } })
    await audit(tx, room.orderId, actor.userId, 'INSTALLATION_MEASUREMENT_CREATED', null, JSON.stringify(measurementAuditSnapshot(measurement)))
    return measurement
  })
}

export async function updateInstallationMeasurement(db: PrismaClient, id: string, input: unknown, actor: InstallationMeasurementActor) {
  const value = parse(measurementUpdateSchema, input)
  if (Object.keys(value).length === 0) validationError('form', 'Wskaż zmianę pomiaru.')
  return db.$transaction(async (tx) => {
    measurementProvenance(actor)
    const current = await tx.installationMeasurement.findUnique({ where: { id }, include: { room: { select: { orderId: true } } } })
    if (!current) validationError('measurementId', 'Pomiar nie istnieje.')
    await assertActiveInstallationOrder(tx, current.room.orderId)
    const nextScopeId = value.scopeId === undefined ? current.scopeId : value.scopeId
    await assertMeasurementScopeBelongsToRoom(tx, current.roomId, nextScopeId)
    const updated = await tx.installationMeasurement.update({
      where: { id },
      data: {
        ...(value.scopeId === undefined ? {} : { scopeId: value.scopeId }),
        ...(value.elementName === undefined ? {} : { elementName: value.elementName.trim().replace(/\s+/g, ' ') }),
        ...(value.value === undefined ? {} : { value: value.value }),
        ...(value.unit === undefined ? {} : { unit: value.unit }),
      },
    })
    await audit(tx, current.room.orderId, actor.userId, 'INSTALLATION_MEASUREMENT_UPDATED', JSON.stringify(measurementAuditSnapshot(current)), JSON.stringify(measurementAuditSnapshot(updated)))
    return updated
  })
}

export async function deleteInstallationMeasurement(db: PrismaClient, id: string, actor: InstallationMeasurementActor) {
  return db.$transaction(async (tx) => {
    measurementProvenance(actor)
    const current = await tx.installationMeasurement.findUnique({ where: { id }, include: { room: { select: { orderId: true } } } })
    if (!current) validationError('measurementId', 'Pomiar nie istnieje.')
    await assertActiveInstallationOrder(tx, current.room.orderId)
    await tx.installationMeasurement.delete({ where: { id } })
    await audit(tx, current.room.orderId, actor.userId, 'INSTALLATION_MEASUREMENT_DELETED', JSON.stringify(measurementAuditSnapshot(current)), null)
  })
}

export async function getInstallationOrderRooms(db: InstallationDb, orderId: string) {
  return db.installationRoom.findMany({ where: { orderId }, include: roomInclude, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
}

export async function reorderInstallationRooms(db: PrismaClient, orderId: string, orderedIds: string[]) {
  return db.$transaction(async (tx) => {
    await assertActiveInstallationOrder(tx, orderId)
    const rows = await tx.installationRoom.findMany({ where: { orderId }, select: { id: true } })
    return reorderRows(rows, orderedIds, (id, sortOrder) => tx.installationRoom.update({ where: { id }, data: { sortOrder } }))
  })
}

export async function reorderInstallationScopes(db: PrismaClient, roomId: string, orderedIds: string[]) {
  return db.$transaction(async (tx) => {
    await assertActiveRoomOrder(tx, await getRoomOrThrow(tx, roomId))
    const rows = await tx.installationScope.findMany({ where: { roomId }, select: { id: true } })
    return reorderRows(rows, orderedIds, (id, sortOrder) => tx.installationScope.update({ where: { id }, data: { sortOrder } }))
  })
}

export async function reorderInstallationScopeProducts(db: PrismaClient, scopeId: string, orderedIds: string[]) {
  return db.$transaction(async (tx) => {
    await assertActiveScopeOrder(tx, await getScopeOrThrow(tx, scopeId))
    const rows = await tx.installationScopeProduct.findMany({ where: { scopeId }, select: { id: true } })
    return reorderRows(rows, orderedIds, (id, sortOrder) => tx.installationScopeProduct.update({ where: { id }, data: { sortOrder } }))
  })
}
