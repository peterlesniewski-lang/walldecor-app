import { createHash, randomBytes } from 'node:crypto'
import { Prisma, type PrismaClient } from '@/generated/prisma'
import { AcceptanceProtocolError, signatureBytes, type AcceptanceResult, type AcceptanceSnapshot } from './acceptance-protocol'
import { sendEmail, type OutboundEmail } from '@/lib/email/outbound-email'
import { installationPublicUrl } from './public-url'

type InstallationDb = PrismaClient | Prisma.TransactionClient
type Channel = 'ONSITE' | 'EMAIL'
export type ClientDecision = 'ACCEPTED' | 'ACCEPTED_WITH_REMARKS' | 'REFUSED'
export type ClientResponseInput = {
  decision: ClientDecision
  firstName: string
  lastName: string
  relationship: string
  note: string
  signature: string | null
}

export class AcceptanceLinkNotFoundError extends Error {
  constructor() { super('Nie znaleziono protokołu.'); this.name = 'AcceptanceLinkNotFoundError' }
}

const secretPattern = /^[A-Za-z0-9_-]{43}$/
function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }

export async function issueAcceptanceLink(db: PrismaClient, protocolId: string, installerId: string, channel: Channel) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (channel === 'ONSITE' ? 30 * 60_000 : 90 * 24 * 60 * 60_000))
  const link = await db.$transaction(async (tx) => {
    const protocol = await tx.installationAcceptanceProtocol.findFirst({
      where: { id: protocolId, installerId, status: { not: 'DRAFT' } },
      select: { id: true, visitId: true, groupKey: true, order: { select: { client: { select: { email: true } } } } },
    })
    if (!protocol) throw new AcceptanceProtocolError('CONFLICT', 'Protokół nie został jeszcze podpisany przez wykonawcę.')
    const newest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: protocol.visitId, groupKey: protocol.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (newest?.id !== protocol.id) throw new AcceptanceProtocolError('CONFLICT', 'Dostępna jest nowsza wersja protokołu.')
    if (channel === 'ONSITE') {
      const current = await tx.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, status: 'INSTALLER_SIGNED', order: { archivedAt: null } }, select: { id: true } })
      if (!current) throw new AcceptanceProtocolError('CONFLICT', 'Protokół nie oczekuje już na odpowiedź klienta.')
    }
    const email = protocol.order.client.email?.trim() ?? ''
    if (channel === 'EMAIL' && !email) throw new AcceptanceProtocolError('VALIDATION', 'W karcie montażu brakuje adresu e-mail klienta.')
    if (channel === 'ONSITE') {
      await tx.installationAcceptanceLink.updateMany({ where: { protocolId, channel, revokedAt: null }, data: { revokedAt: now } })
    }
    return tx.installationAcceptanceLink.create({ data: {
      protocolId, tokenHash: tokenHash(token), channel, expiresAt,
      recipientEmail: channel === 'EMAIL' ? email : null,
    } })
  })
  return { token, link }
}

export async function dispatchAcceptanceEmailLink(
  db: PrismaClient, protocolId: string, installerId: string, origin: string,
  emailSender: (email: OutboundEmail) => Promise<void> = sendEmail,
) {
  const { token, link } = await issueAcceptanceLink(db, protocolId, installerId, 'EMAIL')
  const url = installationPublicUrl(`/p/${token}`, origin)
  try {
    await emailSender({
      to: link.recipientEmail!,
      subject: 'Protokół odbioru prac WallDecor',
      text: `Dzień dobry,\n\nProsimy o zapoznanie się z protokołem odbioru prac i potwierdzenie decyzji:\n${url}\n\nLink jest ważny przez 90 dni od wysłania.\n\nWallDecor`,
    })
    await markAcceptanceEmailSent(db, link.id)
  } catch {
    await revokeAcceptanceLink(db, link.id)
    throw new AcceptanceProtocolError('CONFLICT', 'Nie udało się wysłać wiadomości. Link nie został oznaczony jako dostarczony.')
  }
  return { linkId: link.id, recipientEmail: link.recipientEmail, expiresAt: link.expiresAt, sentAt: new Date() }
}

export async function markAcceptanceEmailSent(db: PrismaClient, linkId: string) {
  await db.$transaction(async (tx) => {
    const link = await tx.installationAcceptanceLink.findUnique({ where: { id: linkId } })
    if (!link || link.channel !== 'EMAIL' || link.revokedAt) throw new AcceptanceLinkNotFoundError()
    const now = new Date()
    await tx.installationAcceptanceLink.update({ where: { id: linkId }, data: { sentAt: now } })
    await tx.installationAcceptanceLink.updateMany({ where: { protocolId: link.protocolId, channel: 'EMAIL', id: { not: linkId }, revokedAt: null }, data: { revokedAt: now } })
  })
}

export async function revokeAcceptanceLink(db: PrismaClient, linkId: string) {
  await db.installationAcceptanceLink.updateMany({ where: { id: linkId, revokedAt: null }, data: { revokedAt: new Date() } })
}

async function resolveLink(db: InstallationDb, token: string) {
  if (!secretPattern.test(token)) throw new AcceptanceLinkNotFoundError()
  const link = await db.installationAcceptanceLink.findUnique({
    where: { tokenHash: tokenHash(token) }, include: { protocol: true },
  })
  if (!link || link.revokedAt || link.expiresAt <= new Date()) throw new AcceptanceLinkNotFoundError()
  return link
}

export async function publicAcceptanceProjection(db: PrismaClient, token: string) {
  const link = await resolveLink(db, token)
  await db.installationAcceptanceLink.updateMany({ where: { id: link.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { lastOpenedAt: new Date() } })
  const protocol = link.protocol
  return {
    protocolId: protocol.id,
    revision: protocol.revision,
    status: protocol.status,
    snapshot: JSON.parse(protocol.snapshotJson) as AcceptanceSnapshot,
    results: JSON.parse(protocol.resultsJson ?? '[]') as AcceptanceResult[],
    contentHash: protocol.contentHash,
    clientDecision: protocol.clientDecision as ClientDecision | null,
    clientFirstName: protocol.clientFirstName,
    clientLastName: protocol.clientLastName,
    clientRelationship: protocol.clientRelationship,
    clientNote: protocol.clientNote,
    clientRespondedAt: protocol.clientRespondedAt?.toISOString() ?? null,
  }
}

export async function submitClientAcceptance(db: PrismaClient, token: string, input: ClientResponseInput, userAgent?: string) {
  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const relationship = input.relationship.trim()
  const note = input.note.trim()
  if (!firstName || !lastName || !relationship || firstName.length > 100 || lastName.length > 100 || relationship.length > 120 || note.length > 3000) {
    throw new AcceptanceProtocolError('VALIDATION', 'Podaj dane osoby odbierającej i poprawną treść uwag.')
  }
  if (!['ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REFUSED'].includes(input.decision)) throw new AcceptanceProtocolError('VALIDATION', 'Wybierz decyzję odbioru.')
  if (input.decision !== 'ACCEPTED' && !note) throw new AcceptanceProtocolError('VALIDATION', 'Uwagi lub powód odmowy są wymagane.')
  const signature = input.signature ? await signatureBytes(input.signature) : null
  if (input.decision !== 'REFUSED' && !signature) throw new AcceptanceProtocolError('VALIDATION', 'Odbiór wymaga podpisu klienta.')
  return db.$transaction(async (tx) => {
    const link = await resolveLink(tx, token)
    const protocol = link.protocol
    if (protocol.status !== 'INSTALLER_SIGNED' || !protocol.contentHash || !protocol.installerSignature) {
      throw new AcceptanceProtocolError('CONFLICT', 'Ta wersja protokołu nie oczekuje na odpowiedź.')
    }
    const newest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: protocol.visitId, groupKey: protocol.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (newest?.id !== protocol.id) throw new AcceptanceProtocolError('CONFLICT', 'Dostępna jest nowsza wersja protokołu.')
    const responseHash = createHash('sha256').update(JSON.stringify({
      contentHash: protocol.contentHash, decision: input.decision, firstName, lastName, relationship, note,
      signatureSha256: signature ? createHash('sha256').update(signature).digest('hex') : null,
    })).digest('hex')
    const respondedAt = new Date()
    const updated = await tx.installationAcceptanceProtocol.updateMany({
      where: { id: protocol.id, status: 'INSTALLER_SIGNED', clientDecision: null, contentHash: protocol.contentHash },
      data: {
        status: input.decision, clientDecision: input.decision, clientFirstName: firstName,
        clientLastName: lastName, clientRelationship: relationship, clientNote: note,
        clientSignature: signature, clientRespondedAt: respondedAt, clientResponseHash: responseHash,
        clientResponseMetaJson: JSON.stringify({ channel: link.channel, linkId: link.id, userAgent: userAgent?.slice(0, 300) ?? null }),
      },
    })
    if (updated.count !== 1) throw new AcceptanceProtocolError('CONFLICT', 'Odpowiedź została już zapisana.')
    return { decision: input.decision, respondedAt: respondedAt.toISOString(), responseHash }
  })
}
