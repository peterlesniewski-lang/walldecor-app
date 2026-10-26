import type { Prisma, PrismaClient } from '@/generated/prisma'
import { sendEmail, type OutboundEmail } from '@/lib/email/outbound-email'
import type { AcceptanceResult, AcceptanceSnapshot } from './acceptance-protocol'
import { acceptanceAlertEmailContent, acceptanceAlertTitles, type AcceptanceAlertKind } from './acceptance-alert-email'
import { installationPublicUrl } from './public-url'

export { acceptanceAlertEmailContent } from './acceptance-alert-email'
const titles = acceptanceAlertTitles

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

const alertKinds: AcceptanceAlertKind[] = ['ACCEPTED_WITH_REMARKS', 'REFUSED', 'UNILATERAL']

async function composeAlertEmail(db: PrismaClient, alert: { protocolId: string; kind: string; title: string; message: string }): Promise<Pick<OutboundEmail, 'subject' | 'text' | 'html'>> {
  const protocol = await db.installationAcceptanceProtocol.findUnique({ where: { id: alert.protocolId }, select: {
    orderId: true, snapshotJson: true, resultsJson: true, installerSignedAt: true, clientDecision: true, clientFirstName: true,
    clientLastName: true, clientRelationship: true, clientNote: true, clientRespondedAt: true,
    unilateral: { select: { reason: true, circumstances: true, signedAt: true } },
  } })
  const kind = alertKinds.find((value) => value === alert.kind)
  if (!protocol || !kind) {
    const url = installationPublicUrl(protocol ? `/installations/${protocol.orderId}#acceptance` : '/installations')
    return { subject: `WallDecor: ${alert.title}`, text: `${alert.message}\n\nOtwórz kartę zlecenia: ${url}` }
  }
  const snapshot = parseJson<AcceptanceSnapshot | null>(protocol.snapshotJson, null)
  const url = installationPublicUrl(`/installations/${protocol.orderId}#acceptance`)
  if (!snapshot) return { subject: `WallDecor: ${alert.title}`, text: `${alert.message}\n\nOtwórz kartę zlecenia: ${url}` }
  return acceptanceAlertEmailContent({
    kind, url, snapshot, results: parseJson<AcceptanceResult[]>(protocol.resultsJson, []),
    installerSignedAt: protocol.installerSignedAt, clientDecision: protocol.clientDecision,
    clientFirstName: protocol.clientFirstName, clientLastName: protocol.clientLastName, clientRelationship: protocol.clientRelationship,
    clientNote: protocol.clientNote, clientRespondedAt: protocol.clientRespondedAt, unilateral: protocol.unilateral,
  })
}

export async function queueAcceptanceAlerts(tx: Prisma.TransactionClient, protocolId: string, kind: AcceptanceAlertKind) {
  const protocol = await tx.installationAcceptanceProtocol.findUniqueOrThrow({ where: { id: protocolId }, select: {
    orderId: true, snapshotJson: true, order: { select: { primaryEmployeeId: true, primaryEmployee: { select: { email: true, active: true } } } },
  } })
  const snapshot = JSON.parse(protocol.snapshotJson) as AcceptanceSnapshot
  const title = titles[kind]
  const message = `${snapshot.orderNumber} · ${snapshot.workType}: ${title.toLowerCase()}. Sprawdź protokół i zaplanuj dalsze działania.`
  const users = await tx.user.findMany({ where: { isActive: true, OR: [{ role: 'ADMIN' }, { employeeId: protocol.order.primaryEmployeeId }] }, select: { id: true, email: true, employeeId: true } })
  const recipients: Array<{ key: string; userId: string | null; email: string }> = users.map((user) => ({ key: `user:${user.id}`, userId: user.id, email: user.email }))
  if (protocol.order.primaryEmployee.active && !users.some((user) => user.employeeId === protocol.order.primaryEmployeeId) && protocol.order.primaryEmployee.email) {
    recipients.push({ key: `employee:${protocol.order.primaryEmployeeId}`, userId: null, email: protocol.order.primaryEmployee.email })
  }
  for (const recipient of recipients) {
    const eventKey = `${protocolId}:${kind}:${recipient.key}`
    if (await tx.installationAcceptanceAlert.findUnique({ where: { eventKey }, select: { id: true } })) continue
    const notification = recipient.userId ? await tx.notification.create({ data: {
      userId: recipient.userId, type: 'installation_acceptance_exception', title, message, link: `/installations/${protocol.orderId}#acceptance`,
    } }) : null
    await tx.installationAcceptanceAlert.create({ data: {
      protocolId, eventKey, kind, recipientUserId: recipient.userId, recipientEmail: recipient.email,
      notificationId: notification?.id ?? null, title, message,
    } })
  }
}

export async function dispatchPendingAcceptanceAlerts(
  db: PrismaClient, protocolId?: string, emailSender: (email: OutboundEmail) => Promise<void> = sendEmail,
) {
  const now = new Date()
  const pending = await db.installationAcceptanceAlert.findMany({ where: {
    ...(protocolId ? { protocolId } : {}),
    OR: [{ emailStatus: { in: ['PENDING', 'FAILED'] } }, { emailStatus: 'SENDING', emailLeaseUntil: { lt: now } }],
  }, orderBy: { createdAt: 'asc' }, take: 50 })
  let sent = 0
  let failed = 0
  for (const alert of pending) {
    const claimed = await db.installationAcceptanceAlert.updateMany({ where: {
      id: alert.id, OR: [{ emailStatus: { in: ['PENDING', 'FAILED'] } }, { emailStatus: 'SENDING', emailLeaseUntil: { lt: now } }],
    }, data: { emailStatus: 'SENDING', emailAttempts: { increment: 1 }, emailLeaseUntil: new Date(Date.now() + 5 * 60_000), lastEmailError: null } })
    if (!claimed.count) continue
    try {
      await emailSender({ to: alert.recipientEmail, ...(await composeAlertEmail(db, alert)) })
      await db.installationAcceptanceAlert.update({ where: { id: alert.id }, data: { emailStatus: 'SENT', emailSentAt: new Date(), emailLeaseUntil: null } })
      sent += 1
    } catch (error) {
      await db.installationAcceptanceAlert.update({ where: { id: alert.id }, data: { emailStatus: 'FAILED', emailLeaseUntil: null, lastEmailError: error instanceof Error ? error.message.slice(0, 500) : 'Nieznany błąd wysyłki' } })
      failed += 1
    }
  }
  return { sent, failed }
}
