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
  id: string; orderId: string; visitId: string; groupKey: string; revision: number; previousId: string | null; resolvesProtocolId: string | null; installerId: string; status: string;
  snapshotJson: string; resultsJson: string | null; contentHash: string | null; installerSignedAt: Date | null;
}) {
  return {
    id: row.id, orderId: row.orderId, visitId: row.visitId, groupKey: row.groupKey,
    revision: row.revision, previousId: row.previousId, resolvesProtocolId: row.resolvesProtocolId, installerId: row.installerId, status: row.status,
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

export function acceptanceNeedsRemediation(protocol: { status: string; resultsJson: string | null }) {
  if (['ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL'].includes(protocol.status)) return true
  if (protocol.status !== 'ACCEPTED') return false
  const results = JSON.parse(protocol.resultsJson ?? '[]') as AcceptanceResult[]
  return !results.length || results.some((result) => result.result !== 'DONE')
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
      acceptanceProtocols: { select: { id: true, groupKey: true, status: true, installerId: true, revision: true } },
    },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
  })
  const candidates = visits.flatMap((visit) => {
    const grouped = new Map<string, { id: string; visitId: string; startsAt: Date | null; groupKey: string; workType: string; scopeCount: number; status: string | null; blockedReason: string | null }>()
    const allScopes = visit.scopes.map(({ scope }) => scope)
    for (const scope of allScopes) {
      if (!scope.assignments.some((assignment) => assignment.employeeId === installerId && assignment.employee.active)) continue
      const groupKey = acceptanceGroupKey(scope)
      if (grouped.has(groupKey)) continue
      const groupScopes = allScopes.filter((candidate) => acceptanceGroupKey(candidate) === groupKey)
      const responsible = responsibleInstallerIds(groupScopes)
      if (responsible.length === 1 && responsible[0] !== installerId) continue
      const protocol = visit.acceptanceProtocols.filter((item) => item.groupKey === groupKey).sort((a, b) => b.revision - a.revision)[0]
      if (protocol && protocol.installerId !== installerId) continue
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
  const ownProtocols = await db.installationAcceptanceProtocol.findMany({
    where: { orderId, installerId },
    select: { id: true, visitId: true, groupKey: true, revision: true, status: true, snapshotJson: true },
  })
  const latestOwn = new Map<string, typeof ownProtocols[number]>()
  for (const protocol of ownProtocols) {
    const key = `${protocol.visitId}:${protocol.groupKey}`
    const current = latestOwn.get(key)
    if (!current || protocol.revision > current.revision) latestOwn.set(key, protocol)
  }
  for (const protocol of latestOwn.values()) {
    if (candidates.some((candidate) => candidate.visitId === protocol.visitId && candidate.groupKey === protocol.groupKey)) continue
    const snapshot = JSON.parse(protocol.snapshotJson) as AcceptanceSnapshot
    candidates.push({
      id: protocol.id, visitId: protocol.visitId, startsAt: snapshot.visitStartsAt ? new Date(snapshot.visitStartsAt) : null,
      groupKey: protocol.groupKey, workType: snapshot.workType, scopeCount: snapshot.items.length,
      status: protocol.status, blockedReason: null,
    })
  }
  return candidates.sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0))
}

async function buildAcceptanceSnapshot(tx: Prisma.TransactionClient, input: { orderId: string; visitId: string; groupKey: string; installerId?: string }) {
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
  const groupedScopes = visit.scopes.map(({ scope }) => scope).filter((scope) => acceptanceGroupKey(scope) === input.groupKey)
  if (!groupedScopes.length) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono prac tego rodzaju podczas wizyty.')
  const responsible = responsibleInstallerIds(groupedScopes)
  if (responsible.length !== 1) throw new AcceptanceProtocolError('CONFLICT', 'Opiekun musi wskazać jednego odpowiedzialnego wykonawcę dla tego rodzaju prac.')
  const installerId = responsible[0]
  if (input.installerId && installerId !== input.installerId) throw new AcceptanceProtocolError('FORBIDDEN', 'Wykonawca nie odpowiada za wszystkie prace tego rodzaju.')
  const installer = await tx.employee.findFirst({ where: { id: installerId, active: true }, select: { firstName: true, lastName: true } })
  if (!installer) throw new AcceptanceProtocolError('FORBIDDEN', 'Wykonawca jest nieaktywny.')
  groupedScopes.sort((a, b) => a.room.sortOrder - b.room.sortOrder || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const firstScope = groupedScopes[0]
  const address = [visit.order.addressStreet, visit.order.addressBuildingNumber, visit.order.addressApartmentNumber ? `/${visit.order.addressApartmentNumber}` : null, visit.order.addressPostalCode, visit.order.addressCity].filter(Boolean).join(' ')
  const snapshot: AcceptanceSnapshot = {
    orderNumber: visit.order.number, clientName: visit.order.client.name, address,
    visitId: visit.id, visitStartsAt: visit.startsAt?.toISOString() ?? null,
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
  return { snapshot, installerId }
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
    const { snapshot } = await buildAcceptanceSnapshot(tx, input)
    const currentVisit = await tx.installationVisit.findUniqueOrThrow({ where: { id: input.visitId }, select: { startsAt: true } })
    const earlier = await tx.installationAcceptanceProtocol.findMany({
      where: { orderId: input.orderId, groupKey: input.groupKey, visitId: { not: input.visitId }, visit: { startsAt: { lt: currentVisit.startsAt! } } },
      select: { id: true, visitId: true, revision: true, status: true, resultsJson: true, resolutionAsPrior: { select: { id: true } }, visit: { select: { startsAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { revision: 'desc' }],
    })
    const latestByVisit = new Map<string, typeof earlier[number]>()
    for (const item of earlier) {
      const current = latestByVisit.get(item.visitId)
      if (!current || item.revision > current.revision) latestByVisit.set(item.visitId, item)
    }
    const predecessor = [...latestByVisit.values()]
      .filter((item) => !item.resolutionAsPrior && acceptanceNeedsRemediation(item))
      .sort((a, b) => (b.visit.startsAt?.getTime() ?? 0) - (a.visit.startsAt?.getTime() ?? 0))[0]
    try {
      const created = await tx.installationAcceptanceProtocol.create({ data: {
        orderId: input.orderId, visitId: input.visitId, groupKey: input.groupKey,
        installerId: input.installerId, snapshotJson: JSON.stringify(snapshot), resolvesProtocolId: predecessor?.id ?? null,
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

export async function createAcceptanceRevision(db: PrismaClient, protocolId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const previous = await tx.installationAcceptanceProtocol.findUnique({ where: { id: protocolId }, include: {
      resolutionAsPrior: { select: { id: true } }, remediatedBy: { select: { id: true }, take: 1 },
    } })
    if (!previous) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono protokołu.')
    if (previous.resolutionAsPrior) throw new AcceptanceProtocolError('CONFLICT', 'Ten etap został zamknięty protokołem z kolejnej wizyty.')
    if (previous.remediatedBy.length) throw new AcceptanceProtocolError('CONFLICT', 'Poprawki są już dokumentowane podczas kolejnej wizyty.')
    const latest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: previous.visitId, groupKey: previous.groupKey }, orderBy: { revision: 'desc' } })
    if (!latest || latest.id !== previous.id) throw new AcceptanceProtocolError('CONFLICT', 'Wybierz najnowszą wersję protokołu.')
    if (latest.status === 'DRAFT') return present(latest)
    const { snapshot, installerId } = await buildAcceptanceSnapshot(tx, { orderId: previous.orderId, visitId: previous.visitId, groupKey: previous.groupKey })
    try {
      const created = await tx.installationAcceptanceProtocol.create({ data: {
        orderId: previous.orderId, visitId: previous.visitId, groupKey: previous.groupKey,
        revision: previous.revision + 1, previousId: previous.id, resolvesProtocolId: previous.resolvesProtocolId,
        installerId, snapshotJson: JSON.stringify(snapshot),
      } })
      await tx.installationAuditEvent.create({ data: {
        orderId: previous.orderId, actorId, action: 'INSTALLATION_ACCEPTANCE_REVISION_CREATED',
        metadataJson: JSON.stringify({ previousId: previous.id, protocolId: created.id, revision: created.revision }),
      } })
      await tx.installationAcceptanceInvoiceTask.updateMany({ where: { visitId: previous.visitId, groupKey: previous.groupKey, status: 'PENDING' }, data: { status: 'ON_HOLD' } })
      return present(created)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AcceptanceProtocolError('CONFLICT', 'Nowa wersja została równocześnie utworzona. Odśwież kartę.')
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
    const latest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: row.visitId, groupKey: row.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (latest?.id !== protocolId) throw new AcceptanceProtocolError('CONFLICT', 'Dostępna jest nowsza wersja protokołu.')
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
