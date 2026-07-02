import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  isOperationResourceType,
  type OperationResourceType,
} from '@/lib/operations/visibility'

const PatchSchema = z.object({
  resourceType: z.enum(['procedure', 'template', 'run']),
  resourceId: z.string().min(1),
  userId: z.string().min(1),
  visible: z.boolean(),
})

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

async function getResources(resourceType: OperationResourceType) {
  if (resourceType === 'procedure') {
    const procedures = await prisma.article.findMany({
      where: { type: 'procedure' },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, category: true, visibility: true },
    })

    return procedures.map((procedure) => ({
      id: procedure.id,
      label: procedure.title,
      detail: procedure.category,
      visibility: procedure.visibility,
    }))
  }

  if (resourceType === 'template') {
    const templates = await prisma.checklistTemplate.findMany({
      orderBy: [{ module: { area: { order: 'asc' } } }, { module: { order: 'asc' } }, { name: 'asc' }],
      include: { module: { include: { area: true } } },
    })

    return templates.map((template) => ({
      id: template.id,
      label: template.name,
      detail: `${template.module.area.name} / ${template.module.name}`,
      visibility: template.active ? 'active' : 'inactive',
    }))
  }

  const runs = await prisma.checklistRun.findMany({
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
    include: { template: { include: { module: { include: { area: true } } } } },
  })

  return runs.map((run) => ({
    id: run.id,
    label: run.name,
    detail: `${run.template.module.area.name} / ${run.template.module.name}`,
    visibility: run.status,
  }))
}

async function resourceExists(resourceType: OperationResourceType, resourceId: string) {
  if (resourceType === 'procedure') {
    return Boolean(await prisma.article.findFirst({
      where: { id: resourceId, type: 'procedure' },
      select: { id: true },
    }))
  }
  if (resourceType === 'template') {
    return Boolean(await prisma.checklistTemplate.findUnique({
      where: { id: resourceId },
      select: { id: true },
    }))
  }
  return Boolean(await prisma.checklistRun.findUnique({
    where: { id: resourceId },
    select: { id: true },
  }))
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const resourceTypeParam = req.nextUrl.searchParams.get('resourceType') ?? 'procedure'
  if (!isOperationResourceType(resourceTypeParam)) {
    return NextResponse.json({ error: 'Invalid resourceType' }, { status: 400 })
  }

  const [users, resources] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: 'EMPLOYEE' },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true },
    }),
    getResources(resourceTypeParam),
  ])

  const grants = resources.length
    ? await prisma.contentVisibilityGrant.findMany({
        where: {
          resourceType: resourceTypeParam,
          resourceId: { in: resources.map((resource) => resource.id) },
        },
        select: { resourceId: true, userId: true },
      })
    : []

  return NextResponse.json({
    resourceType: resourceTypeParam,
    users,
    resources,
    grants,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { resourceType, resourceId, userId, visible } = parsed.data
  const [user, exists] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, role: true } }),
    resourceExists(resourceType, resourceId),
  ])

  if (!user?.isActive) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.role !== 'EMPLOYEE') {
    return NextResponse.json({ error: 'Only employee visibility can be customized' }, { status: 400 })
  }
  if (!exists) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })

  if (visible) {
    const grant = await prisma.contentVisibilityGrant.upsert({
      where: {
        resourceType_resourceId_userId: { resourceType, resourceId, userId },
      },
      update: { grantedById: auth.session.user.id },
      create: {
        resourceType,
        resourceId,
        userId,
        grantedById: auth.session.user.id,
      },
    })
    return NextResponse.json({ visible: true, grant })
  }

  await prisma.contentVisibilityGrant.deleteMany({
    where: { resourceType, resourceId, userId },
  })

  return NextResponse.json({ visible: false })
}
