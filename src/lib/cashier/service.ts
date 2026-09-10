import type { PrismaClient } from '@/generated/prisma'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { requireCashierAdmin, requireCashierCenter, resolveCashierActor } from './access'
import { CashierCommandSchema, CashierQuerySchema, type CashierCommandResult } from './contracts'
import { CashierError } from './errors'
import { cashierTransaction } from './ledger'
import { setupCashier, changeCashierTarget } from './settings'
import { closeCashierReport, correctCashierReport, createCashierReport, saveCashierOperation, saveCashierReport } from './reports'
import { processCashierDeposit } from './deposits'
import { loadCashierBootstrap } from './read'

const ADMIN_ACTIONS = new Set(['setup', 'setTarget', 'correctReport', 'receiveDeposit', 'verifyDeposit'])

export async function executeCashierCommand(db: PrismaClient, userId: string | null | undefined, input: unknown, now = new Date()): Promise<CashierCommandResult> {
  return cashierTransaction(db, async (tx) => {
    const actor = await resolveCashierActor(tx, userId)
    const parsed = CashierCommandSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new CashierError(400, 'INVALID_INPUT', issue?.code === 'custom' ? issue.message : 'Nieprawidłowe dane. Sprawdź kwoty, daty, numery dokumentów i wymagane potwierdzenia formularza.')
    }
    const command = parsed.data
    requireCashierCenter(actor, command.costCenterId)
    if (ADMIN_ACTIONS.has(command.action)) requireCashierAdmin(actor)
    const today = getWarsawBusinessDate(now).isoDate
    switch (command.action) {
      case 'setup': return setupCashier(tx, actor, command, today)
      case 'setTarget': return changeCashierTarget(tx, actor, command)
      case 'createReport': return createCashierReport(tx, actor, command, today)
      case 'updateReport': return saveCashierReport(tx, actor, command)
      case 'addOperation':
      case 'updateOperation':
      case 'cancelOperation': return saveCashierOperation(tx, actor, command, now)
      case 'closeReport': return closeCashierReport(tx, actor, command, now)
      case 'correctReport': return correctCashierReport(tx, actor, command)
      case 'receiveDeposit':
      case 'verifyDeposit': return processCashierDeposit(tx, actor, command, now)
    }
  })
}

export async function readCashierBootstrap(db: PrismaClient, userId: string | null | undefined, input: unknown = {}, now = new Date()) {
  return cashierTransaction(db, async (tx) => {
    const actor = await resolveCashierActor(tx, userId)
    const parsed = CashierQuerySchema.safeParse(input)
    if (!parsed.success) throw new CashierError(400, 'INVALID_QUERY', 'Sprawdź salon, daty, numer strony historii i identyfikator raportu.')
    const center = parsed.data.costCenterId ?? actor.costCenterId ?? 'PUL'
    requireCashierCenter(actor, center)
    return loadCashierBootstrap(tx, actor, center, parsed.data, getWarsawBusinessDate(now).isoDate)
  })
}
