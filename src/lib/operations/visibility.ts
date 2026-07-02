import { prisma } from '@/lib/prisma'

export const OPERATION_RESOURCE_TYPES = ['procedure', 'template', 'run'] as const
export type OperationResourceType = (typeof OPERATION_RESOURCE_TYPES)[number]

export type OperationViewer = {
  id: string
  role?: string | null
}

export function isOperationResourceType(value: string): value is OperationResourceType {
  return OPERATION_RESOURCE_TYPES.includes(value as OperationResourceType)
}

export function canManageOperationVisibility(viewer: OperationViewer) {
  return viewer.role === 'ADMIN'
}

export function canBypassOperationVisibility(viewer: OperationViewer) {
  return viewer.role === 'ADMIN' || viewer.role === 'MANAGER'
}

export async function getGrantedResourceIds(
  viewer: OperationViewer,
  resourceType: OperationResourceType
) {
  if (canBypassOperationVisibility(viewer)) return null

  const grants = await prisma.contentVisibilityGrant.findMany({
    where: { userId: viewer.id, resourceType },
    select: { resourceId: true },
  })

  return grants.map((grant) => grant.resourceId)
}

export async function hasOperationGrant(
  viewer: OperationViewer,
  resourceType: OperationResourceType,
  resourceId: string
) {
  if (canBypassOperationVisibility(viewer)) return true

  const grant = await prisma.contentVisibilityGrant.findUnique({
    where: {
      resourceType_resourceId_userId: {
        resourceType,
        resourceId,
        userId: viewer.id,
      },
    },
    select: { id: true },
  })

  return Boolean(grant)
}
