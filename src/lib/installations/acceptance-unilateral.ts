import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@/generated/prisma'
import { AcceptanceProtocolError, signatureBytes, type AcceptanceSnapshot } from './acceptance-protocol'
import { queueAcceptanceAlerts } from './acceptance-alerts'

type InstallationDb = PrismaClient | Prisma.TransactionClient
export type UnilateralReason = 'REFUSAL' | 'ABSENT' | 'NO_RESPONSE'

function present(row: {
  id: string; status: string; reason: string | null; circumstances: string | null; signedAt: Date | null;
  contentHash: string | null; protocol: { id: string; orderId: string; status: string; snapshotJson: string; clientDecision: string | null };
}) {
  return {
    id: row.id, protocolId: row.protocol.id, orderId: row.protocol.orderId, status: row.status,
    reason: row.reason as UnilateralReason | null, circumstances: row.circumstances, signedAt: row.signedAt,
    contentHash: row.contentHash, clientDecision: row.protocol.clientDecision,
    protocolStatus: row.protocol.status, snapshot: JSON.parse(row.protocol.snapshotJson) as AcceptanceSnapshot,
  }
}

export async function createUnilateralDraft(db: PrismaClient, protocolId: string, installerId: string) {
  return db.$transaction(async (tx) => {
    const protocol = await tx.installationAcceptanceProtocol.findFirst({ where: {
      id: protocolId, installerId, status: { in: ['INSTALLER_SIGNED', 'REFUSED'] }, order: { archivedAt: null },
    }, select: { id: true, visitId: true, groupKey: true } })
    if (!protocol) throw new AcceptanceProtocolError('CONFLICT', 'Nie można przygotować protokołu jednostronnego dla tego stanu odbioru.')
    const newest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: protocol.visitId, groupKey: protocol.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (newest?.id !== protocolId) throw new AcceptanceProtocolError('CONFLICT', 'Dostępna jest nowsza wersja protokołu.')
    const existing = await tx.installationAcceptanceUnilateral.findUnique({ where: { protocolId }, include: { protocol: true } })
    if (existing) return present(existing)
    try {
      return present(await tx.installationAcceptanceUnilateral.create({ data: { protocolId }, include: { protocol: true } }))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AcceptanceProtocolError('CONFLICT', 'Protokół jednostronny został równocześnie utworzony. Odśwież kartę.')
      throw error
    }
  })
}

export async function getUnilateralProtocol(db: InstallationDb, id: string, installerId: string) {
  const row = await db.installationAcceptanceUnilateral.findFirst({ where: { id, protocol: { installerId } }, include: { protocol: true } })
  if (!row) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono protokołu jednostronnego.')
  return present(row)
}

export async function signUnilateralProtocol(db: PrismaClient, id: string, installerId: string, input: { reason: UnilateralReason; circumstances: string; signature: string }) {
  const circumstances = input.circumstances.trim()
  if (!['REFUSAL', 'ABSENT', 'NO_RESPONSE'].includes(input.reason) || circumstances.length < 10 || circumstances.length > 3000) {
    throw new AcceptanceProtocolError('VALIDATION', 'Wybierz przyczynę i opisz okoliczności (co najmniej 10 znaków).')
  }
  const signature = await signatureBytes(input.signature)
  return db.$transaction(async (tx) => {
    const row = await tx.installationAcceptanceUnilateral.findFirst({ where: { id, protocol: { installerId } }, include: { protocol: true } })
    if (!row) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono protokołu jednostronnego.')
    if (row.status !== 'DRAFT') throw new AcceptanceProtocolError('CONFLICT', 'Protokół jednostronny został już podpisany.')
    const allowedStatus = input.reason === 'REFUSAL' ? 'REFUSED' : 'INSTALLER_SIGNED'
    if (row.protocol.status !== allowedStatus) throw new AcceptanceProtocolError('CONFLICT', 'Stan odbioru zmienił się. Odśwież protokół.')
    const newest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: row.protocol.visitId, groupKey: row.protocol.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (newest?.id !== row.protocolId) throw new AcceptanceProtocolError('CONFLICT', 'Dostępna jest nowsza wersja protokołu.')
    const photos = await tx.installationFile.findMany({ where: { unilateralProtocolId: id, softDeletedAt: null }, select: { id: true, status: true, sha256: true }, orderBy: { id: 'asc' } })
    if (photos.some((photo) => photo.status !== 'READY' || !photo.sha256)) throw new AcceptanceProtocolError('CONFLICT', 'Poczekaj na zakończenie przesyłania zdjęć.')
    const contentHash = createHash('sha256').update(JSON.stringify({
      parentHash: row.protocol.contentHash, reason: input.reason, circumstances,
      signatureSha256: createHash('sha256').update(signature).digest('hex'),
      photos: photos.map(({ id: photoId, sha256 }) => ({ id: photoId, sha256 })),
    })).digest('hex')
    const signedAt = new Date()
    const signed = await tx.installationAcceptanceUnilateral.updateMany({ where: { id, status: 'DRAFT' }, data: {
      status: 'SIGNED', reason: input.reason, circumstances, signature, signedAt, contentHash,
    } })
    if (!signed.count) throw new AcceptanceProtocolError('CONFLICT', 'Protokół jednostronny został już podpisany.')
    if (row.protocol.status === 'INSTALLER_SIGNED') {
      await tx.installationAcceptanceProtocol.updateMany({ where: { id: row.protocolId, status: 'INSTALLER_SIGNED' }, data: { status: 'UNILATERAL' } })
    }
    await queueAcceptanceAlerts(tx, row.protocolId, 'UNILATERAL')
    return { id, protocolId: row.protocolId, signedAt: signedAt.toISOString(), contentHash }
  })
}
