import type { Prisma } from '@/generated/prisma'
import { CASHIER_CENTERS, type CashierActor, type CashierCenterId } from './contracts'
import { CashierError } from './errors'

export async function resolveCashierActor(db: Pick<Prisma.TransactionClient, 'user'>, userId: string | null | undefined): Promise<CashierActor> {
  if (!userId) throw new CashierError(401, 'UNAUTHENTICATED', 'Zaloguj się, aby otworzyć kasę salonu.')
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, isActive: true, mustChangePassword: true, employeeId: true, employee: { select: { active: true, costCenterId: true } } },
  })
  if (!user?.isActive || user.mustChangePassword) {
    throw new CashierError(403, 'ACCOUNT_NOT_ALLOWED', 'Konto nie ma dostępu do kasy. Sprawdź aktywność konta i wymaganą zmianę hasła.')
  }
  if (user.role === 'ADMIN') return { id: user.id, name: user.name, role: 'ADMIN', costCenterId: null }
  if (user.role !== 'EMPLOYEE' || !user.employeeId || !user.employee?.active || !CASHIER_CENTERS.includes(user.employee.costCenterId as CashierCenterId)) {
    throw new CashierError(403, 'SALON_NOT_ASSIGNED', 'Dostęp wymaga aktywnego konta pracownika przypisanego do salonu Puławska lub Jagiellońska.')
  }
  return { id: user.id, name: user.name, role: 'EMPLOYEE', costCenterId: user.employee.costCenterId as CashierCenterId }
}

export function requireCashierCenter(actor: CashierActor, center: CashierCenterId) {
  if (actor.role !== 'ADMIN' && actor.costCenterId !== center) {
    throw new CashierError(403, 'OTHER_SALON', 'Masz dostęp wyłącznie do kasy swojego salonu.')
  }
}

export function requireCashierAdmin(actor: CashierActor) {
  if (actor.role !== 'ADMIN') throw new CashierError(403, 'ADMIN_REQUIRED', 'Ta operacja wymaga administratora.')
}
