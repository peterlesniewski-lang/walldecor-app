import { prisma } from '@/lib/prisma'
import { calculateRunProgress } from '@/lib/operations/run-factory'
import {
  canBypassOperationVisibility,
  getGrantedResourceIds,
  hasOperationGrant,
  type OperationViewer,
} from '@/lib/operations/visibility'

export async function getOperationModules(viewer: OperationViewer) {
  const grantedTemplateIds = await getGrantedResourceIds(viewer, 'template')
  const canBypass = canBypassOperationVisibility(viewer)

  const areas = await prisma.operationArea.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      modules: {
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: {
          templates: {
            where: {
              active: true,
              ...(grantedTemplateIds === null ? {} : { id: { in: grantedTemplateIds } }),
            },
            orderBy: { name: 'asc' },
            include: { _count: { select: { items: true, runs: true } } },
          },
        },
      },
    },
  })

  if (canBypass) return areas

  return areas
    .map((area) => ({
      ...area,
      modules: area.modules.filter((module) => module.templates.length > 0),
    }))
    .filter((area) => area.modules.length > 0)
}

export async function getTemplates(viewer: OperationViewer) {
  const grantedTemplateIds = await getGrantedResourceIds(viewer, 'template')

  return prisma.checklistTemplate.findMany({
    where: grantedTemplateIds === null ? {} : { id: { in: grantedTemplateIds } },
    orderBy: [{ module: { area: { order: 'asc' } } }, { module: { order: 'asc' } }, { name: 'asc' }],
    include: {
      module: { include: { area: true } },
      _count: { select: { items: true, runs: true } },
    },
  })
}

export async function getTemplate(id: string, viewer: OperationViewer) {
  if (!canBypassOperationVisibility(viewer)) {
    const allowed = await hasOperationGrant(viewer, 'template', id)
    if (!allowed) return null
  }

  return prisma.checklistTemplate.findUnique({
    where: { id },
    include: {
      module: { include: { area: true } },
      items: { orderBy: { order: 'asc' } },
    },
  })
}

export async function getTemplateEditorOptions() {
  const [areas, procedures, users] = await Promise.all([
    prisma.operationArea.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: {
        modules: {
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, slug: true },
        },
      },
    }),
    prisma.article.findMany({
      where: { type: 'procedure' },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, category: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    }),
  ])

  return { areas, procedures, users }
}

export async function getRuns(viewer: OperationViewer) {
  const grantedRunIds = await getGrantedResourceIds(viewer, 'run')
  const canBypass = canBypassOperationVisibility(viewer)

  const runs = await prisma.checklistRun.findMany({
    where: grantedRunIds === null
      ? {}
      : {
          OR: [
            { id: { in: grantedRunIds } },
            { items: { some: { ownerId: viewer.id } } },
          ],
        },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { select: { status: true, ownerId: true } },
    },
  })

  const grantedSet = new Set(grantedRunIds ?? [])

  return runs.map((run) => ({
    ...run,
    progress: calculateRunProgress(
      canBypass || grantedSet.has(run.id)
        ? run.items
        : run.items.filter((item) => item.ownerId === viewer.id)
    ),
  }))
}

export async function getRun(id: string, viewer: OperationViewer) {
  const run = await prisma.checklistRun.findUnique({
    where: { id },
    include: {
      template: { include: { module: { include: { area: true } } } },
      items: { orderBy: { order: 'asc' } },
    },
  })

  if (!run) return null

  if (!canBypassOperationVisibility(viewer)) {
    const hasGrant = await hasOperationGrant(viewer, 'run', id)
    const ownsItem = run.items.some((item) => item.ownerId === viewer.id)
    if (!hasGrant && !ownsItem) return null
  }

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
