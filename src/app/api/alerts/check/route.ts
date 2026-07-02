import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  const todayStr = today.toISOString().slice(0, 10) // "YYYY-MM-DD"

  // Find all ADMIN users once — notifications go to them
  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  })

  let budgetCreated = 0
  let paymentCreated = 0

  // ─── 1. BUDGET ALERTS ──────────────────────────────────────────────────────

  const thresholds = await prisma.budgetThreshold.findMany({
    where: { active: true },
  })

  for (const threshold of thresholds) {
    // Determine which (costCenterId, subCategoryId) pairs to check
    type Pair = { costCenterId: string; subCategoryId: string }
    let pairs: Pair[] = []

    if (threshold.costCenterId && threshold.subCategoryId) {
      pairs = [
        {
          costCenterId: threshold.costCenterId,
          subCategoryId: threshold.subCategoryId,
        },
      ]
    } else if (threshold.costCenterId) {
      // All subcategories for that cost center
      const budgetRows = await prisma.budgetEntry.findMany({
        where: {
          costCenterId: threshold.costCenterId,
          year: currentYear,
          month: { lte: currentMonth },
        },
        select: { subCategoryId: true },
        distinct: ['subCategoryId'],
      })
      pairs = budgetRows.map((r) => ({
        costCenterId: threshold.costCenterId!,
        subCategoryId: r.subCategoryId,
      }))
    } else if (threshold.subCategoryId) {
      // All cost centers for that subcategory
      const budgetRows = await prisma.budgetEntry.findMany({
        where: {
          subCategoryId: threshold.subCategoryId,
          year: currentYear,
          month: { lte: currentMonth },
        },
        select: { costCenterId: true },
        distinct: ['costCenterId'],
      })
      pairs = budgetRows.map((r) => ({
        costCenterId: r.costCenterId,
        subCategoryId: threshold.subCategoryId!,
      }))
    } else {
      // All combinations that have budget entries this year
      const budgetRows = await prisma.budgetEntry.findMany({
        where: {
          year: currentYear,
          month: { lte: currentMonth },
        },
        select: { costCenterId: true, subCategoryId: true },
        distinct: ['costCenterId', 'subCategoryId'],
      })
      pairs = budgetRows.map((r) => ({
        costCenterId: r.costCenterId,
        subCategoryId: r.subCategoryId,
      }))
    }

    for (const pair of pairs) {
      // Sum budget for current year so far
      const budgetAgg = await prisma.budgetEntry.aggregate({
        _sum: { amount: true },
        where: {
          costCenterId: pair.costCenterId,
          subCategoryId: pair.subCategoryId,
          year: currentYear,
          month: { lte: currentMonth },
        },
      })
      const totalBudget = budgetAgg._sum.amount ?? 0
      if (totalBudget <= 0) continue

      // Sum actuals for same period
      const actualsAgg = await prisma.actualEntry.aggregate({
        _sum: { amount: true },
        where: {
          costCenterId: pair.costCenterId,
          subCategoryId: pair.subCategoryId,
          year: currentYear,
          month: { lte: currentMonth },
        },
      })
      const totalActuals = actualsAgg._sum.amount ?? 0

      const ratio = (totalActuals / totalBudget) * 100

      let notifType: string | null = null
      if (ratio >= threshold.criticalPercent) {
        notifType = 'budget_critical'
      } else if (ratio >= threshold.warningPercent) {
        notifType = 'budget_warning'
      }

      if (!notifType) continue

      // Dedup: check if notification already created today for same key
      const startOfToday = new Date(todayStr + 'T00:00:00.000Z')
      const endOfToday = new Date(todayStr + 'T23:59:59.999Z')

      const dedupCount = await prisma.notification.count({
        where: {
          type: notifType,
          link: '/finance/actuals',
          createdAt: { gte: startOfToday, lte: endOfToday },
          // Encode pair info in the message for dedup (checked via message contains)
          message: {
            contains: `[${pair.subCategoryId}/${pair.costCenterId}]`,
          },
        },
      })
      if (dedupCount > 0) continue

      // Fetch display names
      const costCenter = await prisma.costCenter.findUnique({
        where: { id: pair.costCenterId },
        select: { name: true },
      })
      const subCategory = await prisma.subCategory.findUnique({
        where: { id: pair.subCategoryId },
        select: { name: true },
      })

      const ratioStr = Math.round(ratio).toString()
      const costCenterName = costCenter?.name ?? pair.costCenterId
      const subCategoryName = subCategory?.name ?? pair.subCategoryId

      const title =
        notifType === 'budget_critical'
          ? 'Przekroczenie budżetu'
          : 'Ostrzeżenie budżetowe'
      // Embed pair ID for dedup on subsequent runs
      const message = `Kategoria ${subCategoryName} w ${costCenterName}: ${ratioStr}% budżetu wykorzystane [${pair.subCategoryId}/${pair.costCenterId}]`

      // Create notification for each ADMIN user
      for (const admin of adminUsers) {
        await prisma.notification.create({
          data: {
            userId: admin.id,
            type: notifType,
            title,
            message,
            link: '/finance/actuals',
            isRead: false,
          },
        })
        budgetCreated++
      }
    }
  }

  // ─── 2. PAYMENT DUE ALERTS ─────────────────────────────────────────────────

  const reminders = await prisma.paymentReminder.findMany({
    where: { active: true },
    include: { costCenter: true },
  })

  for (const reminder of reminders) {
    // Calculate next due date
    const day = reminder.dayOfMonth
    let nextDueDate = new Date(currentYear, currentMonth - 1, day)

    // If the day has already passed this month, move to next month
    if (nextDueDate < today) {
      nextDueDate = new Date(currentYear, currentMonth, day)
    }

    const daysUntil = Math.ceil(
      (nextDueDate.getTime() - today.getTime()) / 86400000
    )

    if (daysUntil > reminder.alertDaysInAdvance) continue

    // Dedup via lastAlertedDate
    if (reminder.lastAlertedDate === todayStr) continue

    const title = 'Zbliżający się termin płatności'
    const message = `${reminder.name} — ${reminder.amount} PLN, termin za ${daysUntil} dni (${reminder.dayOfMonth} dnia miesiąca)`

    for (const admin of adminUsers) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'payment_due',
          title,
          message,
          link: '/finance/alerts',
          isRead: false,
        },
      })
      paymentCreated++
    }

    // Update lastAlertedDate to today to prevent duplicate alerts
    await prisma.paymentReminder.update({
      where: { id: reminder.id },
      data: { lastAlertedDate: todayStr },
    })
  }

  const created = budgetCreated + paymentCreated

  return NextResponse.json({ created, budget: budgetCreated, payment: paymentCreated })
}
