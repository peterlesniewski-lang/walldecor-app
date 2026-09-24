import type { Prisma, PrismaClient } from '@/generated/prisma'
import { sendEmail, type OutboundEmail } from '@/lib/email/outbound-email'
import type { AcceptanceSnapshot } from './acceptance-protocol'

const titles: Record<string, string> = {
  ACCEPTED_WITH_REMARKS: 'Odbiór prac z uwagami', REFUSED: 'Odmowa odbioru prac', UNILATERAL: 'Protokół jednostronny',
}

export async function queueAcceptanceAlerts(tx: Prisma.TransactionClient, protocolId: string, kind: 'ACCEPTED_WITH_REMARKS' | 'REFUSED' | 'UNILATERAL') {
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
      await emailSender({ to: alert.recipientEmail, subject: `WallDecor: ${alert.title}`, text: `${alert.message}\n\nOtwórz kartę zlecenia w aplikacji WallDecor.` })
      await db.installationAcceptanceAlert.update({ where: { id: alert.id }, data: { emailStatus: 'SENT', emailSentAt: new Date(), emailLeaseUntil: null } })
      sent += 1
    } catch (error) {
      await db.installationAcceptanceAlert.update({ where: { id: alert.id }, data: { emailStatus: 'FAILED', emailLeaseUntil: null, lastEmailError: error instanceof Error ? error.message.slice(0, 500) : 'Nieznany błąd wysyłki' } })
      failed += 1
    }
  }
  return { sent, failed }
}
