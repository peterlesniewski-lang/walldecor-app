import type { Prisma, PrismaClient } from '@/generated/prisma'
import { AcceptanceProtocolError, acceptanceNeedsRemediation, type AcceptanceResult } from './acceptance-protocol'

export async function ensureAcceptanceInvoiceTask(tx: Prisma.TransactionClient, protocolId: string) {
  const protocol = await tx.installationAcceptanceProtocol.findUniqueOrThrow({ where: { id: protocolId }, select: {
    id: true, orderId: true, visitId: true, groupKey: true, status: true, resultsJson: true, resolvesProtocolId: true,
    visit: { select: { startsAt: true } },
    order: { select: { primaryEmployeeId: true } },
  } })
  if (protocol.status !== 'ACCEPTED') return null
  const results = JSON.parse(protocol.resultsJson ?? '[]') as AcceptanceResult[]
  if (!results.length || results.some((result) => result.result !== 'DONE')) return null
  const latestCurrent = await tx.installationAcceptanceProtocol.findFirst({
    where: { visitId: protocol.visitId, groupKey: protocol.groupKey }, orderBy: { revision: 'desc' }, select: { id: true },
  })
  if (latestCurrent?.id !== protocolId) return null

  // A signed acceptance on a correction visit closes the linked, immutable history.
  // Every earlier visit keeps its own protocol and PDF; this table records the closure.
  const visited = new Set<string>()
  let predecessorId = protocol.resolvesProtocolId
  while (predecessorId) {
    if (visited.has(predecessorId)) throw new AcceptanceProtocolError('CONFLICT', 'Wykryto cykl w historii protokołów.')
    visited.add(predecessorId)
    const predecessor = await tx.installationAcceptanceProtocol.findUniqueOrThrow({
      where: { id: predecessorId }, select: { id: true, orderId: true, visitId: true, groupKey: true, revision: true, status: true, resultsJson: true, resolvesProtocolId: true, resolutionAsPrior: { select: { id: true } } },
    })
    if (predecessor.orderId !== protocol.orderId || predecessor.groupKey !== protocol.groupKey) throw new AcceptanceProtocolError('CONFLICT', 'Powiązanie z poprawkami jest nieprawidłowe.')
    const latestPrior = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: predecessor.visitId, groupKey: predecessor.groupKey }, orderBy: { revision: 'desc' }, select: { id: true } })
    if (latestPrior?.id !== predecessor.id) throw new AcceptanceProtocolError('CONFLICT', 'Wcześniejszy protokół ma nowszą wersję. Poproś opiekuna o weryfikację.')
    if (acceptanceNeedsRemediation(predecessor) && !predecessor.resolutionAsPrior) {
      await tx.installationAcceptanceResolution.create({ data: { priorProtocolId: predecessor.id, resolvingProtocolId: protocol.id } })
    }
    predecessorId = predecessor.resolvesProtocolId
  }

  // A separate open visit of the same work type must not silently be bypassed.
  const earlier = await tx.installationAcceptanceProtocol.findMany({
    where: { orderId: protocol.orderId, groupKey: protocol.groupKey, visitId: { not: protocol.visitId }, visit: { startsAt: { lt: protocol.visit.startsAt! } } },
    select: { id: true, visitId: true, revision: true, status: true, resultsJson: true, resolutionAsPrior: { select: { id: true } } },
  })
  const latestByVisit = new Map<string, typeof earlier[number]>()
  for (const item of earlier) {
    const current = latestByVisit.get(item.visitId)
    if (!current || item.revision > current.revision) latestByVisit.set(item.visitId, item)
  }
  const stillOpen = [...latestByVisit.values()].some((item) => !item.resolutionAsPrior && (acceptanceNeedsRemediation(item) || ['DRAFT', 'INSTALLER_SIGNED'].includes(item.status)))
  if (stillOpen) return null

  const existing = await tx.installationAcceptanceInvoiceTask.findUnique({ where: { visitId_groupKey: { visitId: protocol.visitId, groupKey: protocol.groupKey } } })
  if (existing) return tx.installationAcceptanceInvoiceTask.update({ where: { id: existing.id }, data: {
    acceptedProtocolId: protocolId, assignedEmployeeId: protocol.order.primaryEmployeeId,
    status: existing.status === 'DONE' ? 'DONE' : 'PENDING',
  } })
  const created = await tx.installationAcceptanceInvoiceTask.create({ data: {
    orderId: protocol.orderId, visitId: protocol.visitId, groupKey: protocol.groupKey,
    acceptedProtocolId: protocolId, assignedEmployeeId: protocol.order.primaryEmployeeId,
    title: 'Wystawić fakturę', status: 'PENDING',
  } })
  const caretaker = await tx.user.findFirst({ where: { employeeId: protocol.order.primaryEmployeeId, isActive: true }, select: { id: true } })
  if (caretaker) await tx.notification.create({ data: {
    userId: caretaker.id, type: 'installation_invoice_task', title: 'Wystawić fakturę',
    message: 'Prace zostały odebrane bez uwag. Przygotuj fakturę dla odebranego etapu.',
    link: `/installations/${protocol.orderId}#acceptance`,
  } })
  await tx.installationAuditEvent.create({ data: {
    orderId: protocol.orderId, actorId: 'PUBLIC_CLIENT', action: 'INSTALLATION_ACCEPTANCE_INVOICE_TASK_CREATED',
    metadataJson: JSON.stringify({ protocolId, taskId: created.id }),
  } })
  return created
}

export async function markAcceptanceInvoiceTask(db: PrismaClient, taskId: string, orderId: string, actorId: string, status: 'PENDING' | 'DONE') {
  return db.$transaction(async (tx) => {
    const task = await tx.installationAcceptanceInvoiceTask.findFirst({ where: { id: taskId, orderId } })
    if (!task) throw new AcceptanceProtocolError('NOT_FOUND', 'Nie znaleziono zadania.')
    const latest = await tx.installationAcceptanceProtocol.findFirst({ where: { visitId: task.visitId, groupKey: task.groupKey }, orderBy: { revision: 'desc' }, select: { id: true, status: true } })
    if (!latest || latest.id !== task.acceptedProtocolId || latest.status !== 'ACCEPTED' || task.status === 'ON_HOLD') {
      throw new AcceptanceProtocolError('CONFLICT', 'Zadanie czeka na prawidłowy ponowny odbiór.')
    }
    if (task.status === status) return task
    return tx.installationAcceptanceInvoiceTask.update({ where: { id: taskId }, data: {
      status, completedAt: status === 'DONE' ? new Date() : null,
      completedById: status === 'DONE' ? actorId : null,
    } })
  })
}
