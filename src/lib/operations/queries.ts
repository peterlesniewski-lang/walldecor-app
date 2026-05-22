import { prisma } from '@/lib/prisma'
import { calculateRunProgress } from '@/lib/operations/run-factory'

export async function getOperationModules() {
  return prisma.operationArea.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      modules: {
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: {
          templates: {
            where: { active: true },
            orderBy: { name: 'asc' },
            include: { _count: { select: { items: true, runs: true } } },
          },
        },
      },
    },
  })
}

export async function getTemplates() {
  return prisma.checklistTemplate.findMany({
    orderBy: [{ module: { area: { order: 'asc' } } }, { module: { order: 'asc' } }, { name: 'asc' }],
    include: {
      module: { include: { area: true } },
      _count: { select: { items: true, runs: true } },
    },
  })
}

export async function getTemplate(id: string) {
  return prisma.checklistTemplate.findUnique({
    where: { id },
    include: {
      module: { include: { area: true } },
      items: { orderBy: { order: 'asc' } },
    },
  })
}

export async function getRuns() {
  const runs = await prisma.checklistRun.findMany({
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { select: { status: true } },
    },
  })

  return runs.map((run) => ({
    ...run,
    progress: calculateRunProgress(run.items),
  }))
}

export async function getRun(id: string) {
  const run = await prisma.checklistRun.findUnique({
    where: { id },
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { orderBy: { order: 'asc' } },
    },
  })

  if (!run) return null

  const procedureIds = run.items
    .map((item) => item.procedureId)
    .filter((id): id is string => Boolean(id))

  const procedures = procedureIds.length
    ? await prisma.article.findMany({
        where: { id: { in: procedureIds }, type: 'procedure' },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          category: true,
          visibility: true,
          type: true,
          tags: true,
          updatedAt: true,
        },
      })
    : []

  return {
    ...run,
    progress: calculateRunProgress(run.items),
    procedures,
  }
}
