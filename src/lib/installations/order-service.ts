import { randomInt } from 'node:crypto'
import { Prisma, PrismaClient } from '@/generated/prisma'
import {
  InstallationOrderValidationError,
  parseCreateInstallationOrder,
  parseUpdateInstallationOrder,
} from './schemas'
import { assertInstallationOrderCanUseStatus } from './readiness'

type InstallationDb = PrismaClient | Prisma.TransactionClient

const orderInclude = {
  client: true,
  primaryEmployee: { select: { id: true, firstName: true, lastName: true, active: true } },
  backupEmployee: { select: { id: true, firstName: true, lastName: true, active: true } },
  delegations: { orderBy: { createdAt: 'desc' } },
  installerAssignments: { select: { employeeId: true } },
  auditEvents: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.InstallationOrderInclude

type OrderWithRelations = Prisma.InstallationOrderGetPayload<{ include: typeof orderInclude }>

export class InstallationOrderNotFoundError extends Error {
  constructor() {
    super('Nie znaleziono zlecenia montażu.')
    this.name = 'InstallationOrderNotFoundError'
  }
}

function orderAuditSnapshot(order: OrderWithRelations) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    client: {
      id: order.client.id,
      name: order.client.name,
      email: order.client.email,
      phone: order.client.phone,
    },
    address: {
      street: order.addressStreet,
      buildingNumber: order.addressBuildingNumber,
      apartmentNumber: order.addressApartmentNumber,
      postalCode: order.addressPostalCode,
      city: order.addressCity,
    },
    primaryEmployeeId: order.primaryEmployeeId,
    backupEmployeeId: order.backupEmployeeId,
    archivedAt: order.archivedAt?.toISOString() ?? null,
  }
}

async function findActiveEmployeeIds(db: InstallationDb, employeeIds: string[]) {
  const activeEmployees = await db.employee.findMany({
    where: { id: { in: employeeIds }, active: true },
    select: { id: true },
  })
  return new Set(activeEmployees.map((employee) => employee.id))
}

async function assertActiveOwners(db: InstallationDb, primaryEmployeeId: string, backupEmployeeId: string) {
  const activeEmployeeIds = await findActiveEmployeeIds(db, [primaryEmployeeId, backupEmployeeId])
  const fieldErrors: Record<string, string> = {}
  if (!activeEmployeeIds.has(primaryEmployeeId)) {
    fieldErrors.primaryEmployeeId = 'Wybrany opiekun nie jest aktywnym pracownikiem.'
  }
  if (!activeEmployeeIds.has(backupEmployeeId)) {
    fieldErrors.backupEmployeeId = 'Wybrany zastępca nie jest aktywnym pracownikiem.'
  }
  if (Object.keys(fieldErrors).length > 0) throw new InstallationOrderValidationError(fieldErrors)
}

/**
 * SQLite serializes writers, so this one statement either sees a committed
 * active order or marks the employee inactive before a later order can pass
 * its active-owner validation. Do not split this into a count followed by an
 * update: that would reopen the ownership race.
 */
export async function deactivateEmployeeIfNoActiveInstallationOrder(db: PrismaClient, employeeId: string) {
  return db.$executeRaw`
    UPDATE "Employee"
    SET "active" = ${false}
    WHERE "id" = ${employeeId}
      AND NOT EXISTS (
        SELECT 1
        FROM "InstallationOrder"
        WHERE "archivedAt" IS NULL
          AND ("primaryEmployeeId" = ${employeeId} OR "backupEmployeeId" = ${employeeId})
      )
  `
}

async function nextInstallationNumber(db: InstallationDb) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const number = `MON-${date}-${String(randomInt(0, 10_000)).padStart(4, '0')}`
    const existing = await db.installationOrder.findUnique({ where: { number }, select: { id: true } })
    if (!existing) return number
  }
  throw new Error('Nie udało się nadać unikalnego numeru zlecenia montażu.')
}

async function fetchOrderOrThrow(db: InstallationDb, id: string) {
  const order = await db.installationOrder.findUnique({ where: { id }, include: orderInclude })
  if (!order) throw new InstallationOrderNotFoundError()
  return order
}

function resolvedOptionalPatchValue<T>(
  patch: object | undefined,
  key: string,
  current: T | null,
): T | null {
  if (patch && Object.hasOwn(patch, key)) {
    const value = (patch as Record<string, unknown>)[key]
    if (value !== undefined) return (value as T | null) ?? null
  }
  return current
}

export async function createInstallationOrder(
  db: PrismaClient,
  input: unknown,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    const parsed = await parseCreateInstallationOrder(input, {
      isEmployeeActive: async (employeeId) => (await findActiveEmployeeIds(tx, [employeeId])).has(employeeId),
    })
    await assertActiveOwners(tx, parsed.primaryEmployeeId, parsed.backupEmployeeId)

    const client = await tx.installationClient.create({ data: parsed.client })
    const order = await tx.installationOrder.create({
      data: {
        number: await nextInstallationNumber(tx),
        status: parsed.status ?? 'DRAFT',
        clientId: client.id,
        addressStreet: parsed.address.street,
        addressBuildingNumber: parsed.address.buildingNumber,
        addressApartmentNumber: parsed.address.apartmentNumber,
        addressPostalCode: parsed.address.postalCode,
        addressCity: parsed.address.city,
        primaryEmployeeId: parsed.primaryEmployeeId,
        backupEmployeeId: parsed.backupEmployeeId,
        scheduledAt: parsed.scheduledAt,
        externalSystem: parsed.externalSystem,
        externalId: parsed.externalId,
      },
      include: orderInclude,
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId: order.id,
        actorId,
        action: 'INSTALLATION_ORDER_CREATED',
        afterJson: JSON.stringify(orderAuditSnapshot(order)),
        metadataJson: JSON.stringify({ source: 'installation-order-service' }),
      },
    })
    return fetchOrderOrThrow(tx, order.id)
  })
}

export async function listInstallationOrders(db: InstallationDb, options: { includeArchived?: boolean } = {}) {
  return db.installationOrder.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  })
}

export async function getInstallationOrder(db: InstallationDb, id: string) {
  return db.installationOrder.findUnique({ where: { id }, include: orderInclude })
}

export async function updateInstallationOrder(
  db: PrismaClient,
  id: string,
  input: unknown,
  actorId: string,
) {
  const update = parseUpdateInstallationOrder(input)
  return db.$transaction(async (tx) => {
    const current = await fetchOrderOrThrow(tx, id)
    if (current.archivedAt) {
      throw new InstallationOrderValidationError({ form: 'Nie można edytować zarchiwizowanego zlecenia.' })
    }

    const addressBuildingNumber = resolvedOptionalPatchValue(
      update.address,
      'buildingNumber',
      current.addressBuildingNumber,
    )
    const addressApartmentNumber = resolvedOptionalPatchValue(
      update.address,
      'apartmentNumber',
      current.addressApartmentNumber,
    )
    const scheduledAt = resolvedOptionalPatchValue(update, 'scheduledAt', current.scheduledAt)
    const externalSystem = resolvedOptionalPatchValue(update, 'externalSystem', current.externalSystem)
    const externalId = resolvedOptionalPatchValue(update, 'externalId', current.externalId)
    const normalized = {
      client: {
        name: update.client?.name ?? current.client.name,
        email: update.client?.email ?? current.client.email,
        phone: update.client?.phone ?? current.client.phone,
      },
      address: {
        street: update.address?.street ?? current.addressStreet,
        buildingNumber: addressBuildingNumber ?? undefined,
        apartmentNumber: addressApartmentNumber ?? undefined,
        postalCode: update.address?.postalCode ?? current.addressPostalCode,
        city: update.address?.city ?? current.addressCity,
      },
      primaryEmployeeId: update.primaryEmployeeId ?? current.primaryEmployeeId,
      backupEmployeeId: update.backupEmployeeId ?? current.backupEmployeeId,
      status: update.status ?? current.status,
      scheduledAt,
      externalSystem: externalSystem ?? undefined,
      externalId: externalId ?? undefined,
    }
    const parsed = await parseCreateInstallationOrder(normalized, {
      isEmployeeActive: async (employeeId) => (await findActiveEmployeeIds(tx, [employeeId])).has(employeeId),
    })
    await assertActiveOwners(tx, parsed.primaryEmployeeId, parsed.backupEmployeeId)
    await assertInstallationOrderCanUseStatus(tx, id, current.status, parsed.status ?? current.status)

    await tx.installationClient.update({
      where: { id: current.clientId },
      data: parsed.client,
    })

    const before = orderAuditSnapshot(current)
    const updated = await tx.installationOrder.update({
      where: { id },
      data: {
        status: parsed.status ?? current.status,
        addressStreet: parsed.address.street,
        addressBuildingNumber,
        addressApartmentNumber,
        addressPostalCode: parsed.address.postalCode,
        addressCity: parsed.address.city,
        primaryEmployeeId: parsed.primaryEmployeeId,
        backupEmployeeId: parsed.backupEmployeeId,
        scheduledAt,
        externalSystem,
        externalId,
      },
      include: orderInclude,
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId: id,
        actorId,
        action: 'INSTALLATION_ORDER_UPDATED',
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(orderAuditSnapshot(updated)),
      },
    })
    return fetchOrderOrThrow(tx, id)
  })
}

export async function archiveInstallationOrder(db: PrismaClient, id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const current = await fetchOrderOrThrow(tx, id)
    if (current.archivedAt) return current

    const before = orderAuditSnapshot(current)
    const archived = await tx.installationOrder.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
      include: orderInclude,
    })
    await tx.installationAuditEvent.create({
      data: {
        orderId: id,
        actorId,
        action: 'INSTALLATION_ORDER_ARCHIVED',
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(orderAuditSnapshot(archived)),
      },
    })
    return fetchOrderOrThrow(tx, id)
  })
}
