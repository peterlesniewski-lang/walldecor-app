import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@/generated/prisma'
import sharp from 'sharp'

type InstallationDb = PrismaClient | Prisma.TransactionClient

export type AcceptanceWorkResult = 'DONE' | 'PARTIAL' | 'NOT_DONE'
export type AcceptanceResult = { scopeId: string; result: AcceptanceWorkResult; note: string }
export type AcceptanceSnapshot = {
  orderNumber: string
  clientName: string
  address: string
  visitId: string
  visitStartsAt: string | null
  visitEndsAt: string | null
  workType: string
  installerName: string
  items: Array<{
    scopeId: string
    scopeName: string
    roomName: string
    products: Array<{ name: string; code: string | null; manufacturer: string | null; collection: string | null; batch: string | null }>
  }>
}

export class AcceptanceProtocolError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION', message: string) {
    super(message)
    this.name = 'AcceptanceProtocolError'
  }
}

function present(row: {
  id: string; orderId: string; visitId: string; groupKey: string; revision: number; installerId: string; status: string;
  snapshotJson: string; resultsJson: string | null; contentHash: string | null; installerSignedAt: Date | null;
}) {
  return {
    id: row.id, orderId: row.orderId, visitId: row.visitId, groupKey: row.groupKey,
    revision: row.revision, installerId: row.installerId, status: row.status,
    snapshot: JSON.parse(row.snapshotJson) as AcceptanceSnapshot,
    results: row.resultsJson ? JSON.parse(row.resultsJson) as AcceptanceResult[] : [],
    contentHash: row.contentHash,
    installerSignedAt: row.installerSignedAt,
  }
}

/** A work type is a catalog category; an uncategorized scope remains its own group. */
export function acceptanceGroupKey(scope: { id: string; catalogCategoryId: string | null }) {
  return scope.catalogCategoryId ? `category:${scope.catalogCategoryId}` : `scope:${scope.id}`
}

function responsibleInstallerIds(scopes: Array<{ assignments: Array<{ employeeId: string; employee: { active: boolean } }> }>) {
  if (!scopes.length) return []
  return scopes[0].assignments.filter((assignment) => assignment.employee.active && scopes.every((scope) =>
    scope.assignments.some((candidate) => candidate.employeeId === assignment.employeeId && candidate.employee.active),
  )).map((assignment) => assignment.employeeId)
}

export async function listAcceptanceCandidates(db: InstallationDb, orderId: string, installerId: string) {
  const now = new Date()
  const visits = await db.installationVisit.findMany({
    where: {
      orderId, status: { in: ['CONFIRMED', 'COMPLETED'] }, startsAt: { lte: now }, order: { archivedAt: null },
      scopes: { some: { scope: { assignments: { some: { employeeId: installerId, employee: { active: true } } } } } },
    },
    select: {
      id: true, startsAt: true,
      scopes: { select: { scope: { select: {
        id: true, name: true, catalogCategoryId: true,
        catalogCategory: { select: { name: true } },
        assignments: { select: { employeeId: true, employee: { select: { active: true } } } },
      } } } },
      acceptanceProtocols: { where: { revision: 1 }, select: { id: true, groupKey: true, status: true, installerId: true } },
    },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
  })
  return visits.flatMap((visit) => {
    const grouped = new Map<string, { id: string; visitId: string; startsAt: Date | null; groupKey: string; workType: string; scopeCount: number; status: string | null; blockedReason: string | null }>()
    const allScopes = visit.scopes.map(({ scope }) => scope)
    for (const scope of allScopes) {
      if (!scope.assignments.some((assignment) => assignment.employeeId === installerId && assignment.employee.active)) continue
      const groupKey = acceptanceGroupKey(scope)
      if (grouped.has(groupKey)) continue
      const groupScopes = allScopes.filter((candidate) => acceptanceGroupKey(candidate) === groupKey)
      const responsible = responsibleInstallerIds(groupScopes)
      if (responsible.length === 1 && responsible[0] !== installerId) continue
      const protocol = visit.acceptanceProtocols.find((item) => item.groupKey === groupKey && item.installerId === installerId)
      grouped.set(groupKey, {
        id: protocol?.id ?? `${visit.id}:${groupKey}`,
        visitId: visit.id, startsAt: visit.startsAt, groupKey,
        workType: scope.catalogCategory?.name ?? scope.name,
        scopeCount: groupScopes.length, status: protocol?.status ?? null,
        blockedReason: responsible.length !== 1 ? 'Opiekun musi wskazać jednego odpowiedzialnego wykonawcę dla tego rodzaju prac.' : null,
      })
    }
    return [...grouped.values()]
  })
}

export async function createAcceptanceDraft(db: PrismaClient, input: { orderId: string; visitId: string; groupKey: string; installerId: string }) {
  return db.$transaction(async (tx) => {
    const existing = await tx.installationAcceptanceProtocol.findUnique({
      where: { visitId_groupKey_revision: { visitId: input.visitId, groupKey: input.groupKey, revision: 1 } },
    })
    if (existing) {
      if (existing.installerId !== input.installerId || existing.orderId !== input.orderId) throw new AcceptanceProtocolError('CONFLICT', 'Protokół ma innego odpowiedzialnego wykonawcę.')
      return present(existing)
    }
    const visit = await tx.installationVisit.findFirst({
      where: { id: input.visitId, orderId: input.orderId, status: { in: ['CONFIRMED', 'COMPLETED'] }, startsAt: { lte: new Date() }, order: { archivedAt: null } },
      include: {
        order: { include: { client: true } },
        scopes: { include: { scope: { include: {
          room: true, catalogCategory: true,
          assignments: { include: { employee: { select: { active: true } } } },
          scopeProducts: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        } } } },
      },
    })
    if (!visit) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono rozpoczętej wizyty.')
    const installer = await tx.employee.findFirst({ where: { id: input.installerId, active: true }, select: { firstName: true, lastName: true } })
    if (!installer) throw new AcceptanceProtocolError('FORBIDDEN', 'Wykonawca jest nieaktywny.')
    const groupedScopes = visit.scopes.map(({ scope }) => scope).filter((scope) => acceptanceGroupKey(scope) === input.groupKey)
    if (!groupedScopes.length) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono prac tego rodzaju podczas wizyty.')
    const responsible = responsibleInstallerIds(groupedScopes)
    if (responsible.length !== 1) throw new AcceptanceProtocolError('CONFLICT', 'Opiekun musi wskazać jednego odpowiedzialnego wykonawcę dla tego rodzaju prac.')
    if (responsible[0] !== input.installerId) throw new AcceptanceProtocolError('FORBIDDEN', 'Wykonawca nie odpowiada za wszystkie prace tego rodzaju.')
    groupedScopes.sort((a, b) => a.room.sortOrder - b.room.sortOrder || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    const firstScope = groupedScopes[0]
    const address = [visit.order.addressStreet, visit.order.addressBuildingNumber, visit.order.addressApartmentNumber ? `/${visit.order.addressApartmentNumber}` : null, visit.order.addressPostalCode, visit.order.addressCity].filter(Boolean).join(' ')
    const snapshot: AcceptanceSnapshot = {
      orderNumber: visit.order.number,
      clientName: visit.order.client.name,
      address,
      visitId: visit.id,
      visitStartsAt: visit.startsAt?.toISOString() ?? null,
      visitEndsAt: visit.endsAt?.toISOString() ?? null,
      workType: firstScope.catalogCategory?.name ?? firstScope.name,
      installerName: `${installer.firstName} ${installer.lastName}`.trim(),
      items: groupedScopes.map((scope) => ({
        scopeId: scope.id, scopeName: scope.name, roomName: scope.room.name,
        products: scope.scopeProducts.map((product) => ({
          name: product.productNameSnapshot ?? '', code: product.productCodeSnapshot,
          manufacturer: product.manufacturerSnapshot, collection: product.collectionSnapshot, batch: product.batchSnapshot,
        })),
      })),
    }
    try {
      const created = await tx.installationAcceptanceProtocol.create({ data: {
        orderId: input.orderId, visitId: input.visitId, groupKey: input.groupKey,
        installerId: input.installerId, snapshotJson: JSON.stringify(snapshot),
      } })
      return present(created)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AcceptanceProtocolError('CONFLICT', 'Protokół został równocześnie utworzony. Odśwież kartę.')
      }
      throw error
    }
  })
}

export async function getAcceptanceProtocol(db: InstallationDb, protocolId: string, installerId: string) {
  const row = await db.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, installerId } })
  if (!row) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono protokołu.')
  return present(row)
}

export async function signatureBytes(dataUrl: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new AcceptanceProtocolError('VALIDATION', 'Złóż podpis przed zapisaniem protokołu.')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length < 60 || bytes.length > 256_000 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new AcceptanceProtocolError('VALIDATION', 'Podpis musi być poprawnym obrazem PNG do 256 kB.')
  }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 1_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width < 200 || info.height < 70 || info.width > 1200 || info.height > 500) throw new Error('size')
    let inkCount = 0
    let minX = info.width; let maxX = 0; let minY = info.height; let maxY = 0
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const index = (y * info.width + x) * 4
        if (data[index + 3] < 40 || data[index] + data[index + 1] + data[index + 2] > 630) continue
        inkCount += 1
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    }
    if (inkCount < 80 || maxX - minX < 35 || maxY - minY < 6) throw new Error('blank')
  } catch {
    throw new AcceptanceProtocolError('VALIDATION', 'Złóż czytelny podpis w polu podpisu.')
  }
  return bytes
}

export async function signAcceptanceProtocol(db: PrismaClient, protocolId: string, installerId: string, input: { results: AcceptanceResult[]; signature: string }) {
  const row = await db.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, installerId } })
  if (!row) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono protokołu.')
  if (row.status !== 'DRAFT') throw new AcceptanceProtocolError('CONFLICT', 'Ten protokół został już podpisany.')
  const snapshot = JSON.parse(row.snapshotJson) as AcceptanceSnapshot
  const requiredIds = snapshot.items.map((item) => item.scopeId).sort()
  const actualIds = input.results.map((item) => item.scopeId).sort()
  if (requiredIds.length !== actualIds.length || requiredIds.some((id, index) => id !== actualIds[index])) {
    throw new AcceptanceProtocolError('VALIDATION', 'Oznacz wynik każdej pracy dokładnie raz.')
  }
  for (const result of input.results) {
    if (!['DONE', 'PARTIAL', 'NOT_DONE'].includes(result.result) || typeof result.note !== 'string' || result.note.length > 2000) {
      throw new AcceptanceProtocolError('VALIDATION', 'Wynik pracy jest niepoprawny.')
    }
    if (result.result !== 'DONE' && !result.note.trim()) throw new AcceptanceProtocolError('VALIDATION', 'Opisz pracę wykonaną częściowo albo niewykonaną.')
  }
  const bytes = await signatureBytes(input.signature)
  const results = snapshot.items.map((item) => input.results.find((result) => result.scopeId === item.scopeId)!)
  await db.$transaction(async (tx) => {
    // The card can remain open while a visit is cancelled or assignments change.
    // Check the live visit again at the moment the installer signs.
    const visit = await tx.installationVisit.findFirst({
      where: { id: row.visitId, orderId: row.orderId, status: { in: ['CONFIRMED', 'COMPLETED'] }, startsAt: { lte: new Date() }, order: { archivedAt: null } },
      select: { scopes: { select: { scope: { select: {
        id: true, catalogCategoryId: true,
        assignments: { select: { employeeId: true, employee: { select: { active: true } } } },
      } } } } },
    })
    if (!visit) throw new AcceptanceProtocolError('CONFLICT', 'Wizyta została odwołana lub zlecenie zarchiwizowane. Odśwież kartę.')
    const currentScopes = visit.scopes.map(({ scope }) => scope).filter((scope) => acceptanceGroupKey(scope) === row.groupKey)
    const currentIds = currentScopes.map((scope) => scope.id).sort()
    if (currentIds.length !== requiredIds.length || currentIds.some((id, index) => id !== requiredIds[index]) || responsibleInstallerIds(currentScopes).join() !== installerId) {
      throw new AcceptanceProtocolError('CONFLICT', 'Zakres lub odpowiedzialny wykonawca uległ zmianie. Poproś opiekuna o weryfikację.')
    }
    const photos = await tx.installationFile.findMany({
      where: { acceptanceProtocolId: protocolId, purpose: 'INTERNAL_PROJECT', softDeletedAt: null },
      select: { id: true, status: true, sha256: true }, orderBy: { id: 'asc' },
    })
    if (photos.some((photo) => photo.status !== 'READY' || !photo.sha256)) throw new AcceptanceProtocolError('CONFLICT', 'Poczekaj na zakończenie przesyłania zdjęć.')
    const contentHash = createHash('sha256').update(JSON.stringify({ snapshot, results, photos: photos.map(({ id, sha256 }) => ({ id, sha256 })), installerSignatureSha256: createHash('sha256').update(bytes).digest('hex') })).digest('hex')
    const updated = await tx.installationAcceptanceProtocol.updateMany({
      where: { id: protocolId, installerId, status: 'DRAFT' },
      data: { status: 'INSTALLER_SIGNED', resultsJson: JSON.stringify(results), contentHash, installerSignature: bytes, installerSignedAt: new Date() },
    })
    if (updated.count !== 1) throw new AcceptanceProtocolError('CONFLICT', 'Ten protokół został już podpisany.')
  })
  return getAcceptanceProtocol(db, protocolId, installerId)
}
