import { prisma } from '@/lib/prisma'
import { normalizeTemplateItems } from '@/lib/operations/template-items'
import type {
  CreateChecklistTemplateInput,
  UpdateChecklistTemplateInput,
} from '@/lib/validations/operations'

async function assertProcedureIdsAreValid(procedureIds: string[]) {
  if (procedureIds.length === 0) return

  const procedures = await prisma.article.findMany({
    where: { id: { in: procedureIds }, type: 'procedure' },
    select: { id: true },
  })

  if (procedures.length !== new Set(procedureIds).size) {
    throw new Error('INVALID_PROCEDURE')
  }
}

export async function createChecklistTemplate(data: CreateChecklistTemplateInput) {
  const items = normalizeTemplateItems(data.items ?? [])
  await assertProcedureIdsAreValid(items.map((item) => item.procedureId).filter((id): id is string => Boolean(id)))

  return prisma.checklistTemplate.create({
    data: {
      moduleId: data.moduleId,
      name: data.name,
      description: data.description?.trim() || null,
      active: data.active ?? true,
      items: {
        create: items,
      },
    },
    include: {
      module: { include: { area: true } },
      items: { orderBy: { order: 'asc' } },
    },
  })
}

export async function updateChecklistTemplate(id: string, data: UpdateChecklistTemplateInput) {
  const items = data.items ? normalizeTemplateItems(data.items) : undefined
  if (items) {
    await assertProcedureIdsAreValid(items.map((item) => item.procedureId).filter((procedureId): procedureId is string => Boolean(procedureId)))
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.checklistTemplate.update({
      where: { id },
      data: {
        moduleId: data.moduleId,
        name: data.name,
        description: data.description === undefined ? undefined : data.description?.trim() || null,
        active: data.active,
      },
    })

    if (items) {
      await tx.checklistTemplateItem.deleteMany({ where: { templateId: id } })
      if (items.length > 0) {
        await tx.checklistTemplateItem.createMany({
          data: items.map((item) => ({ ...item, templateId: id })),
        })
      }
    }

    return tx.checklistTemplate.findUniqueOrThrow({
      where: { id: template.id },
      include: {
        module: { include: { area: true } },
        items: { orderBy: { order: 'asc' } },
      },
    })
  })
}
