import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  canArchiveInstallationOrder,
  canEditInstallationOrder,
  canViewInstallationOrder,
} from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import { getInstallationOrder } from '@/lib/installations/order-service'
import { getInstallationOrderFormSnapshot, getInstallationOrderRooms, listInstallationCatalog, listInstallationFormTemplates } from '@/lib/installations/catalog-service'
import { listClientLinkStatuses } from '@/lib/installations/client-link'
import { listInstallationClarifications, listInstallationFormRevisions } from '@/lib/installations/form-service'
import { getInstallationReadiness } from '@/lib/installations/readiness'
import { InstallationOrderDetail } from '@/components/installations/order-detail'

type Params = { params: Promise<{ id: string }> }

export default async function InstallationOrderPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const order = await getInstallationOrder(prisma, id)
  if (!order) notFound()

  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  const viewerEmployee = role === 'EMPLOYEE' && session.user.employeeId
    ? await prisma.employee.findUnique({ where: { id: session.user.employeeId }, select: { active: true } })
    : null
  const viewer = {
    role,
    employeeId: session.user.employeeId,
    employeeActive: viewerEmployee?.active === true,
  }
  if (!canViewInstallationOrder(viewer, order)) notFound()

  const canCoordinateClientForm = canEditInstallationOrder(viewer, order)
  const rooms = await getInstallationOrderRooms(prisma, id)
  // An installer gets the limited work-order view. Client answers, their
  // clarification/evidence trail and client-link management are coordinator-only.
  const coordinatorData = canCoordinateClientForm ? await (async () => {
    const [employees, catalog, templates, formSnapshot, clientLinks, clarifications, readiness, formRevisions] = await Promise.all([
      prisma.employee.findMany({
        where: { active: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      listInstallationCatalog(prisma),
      listInstallationFormTemplates(prisma),
      getInstallationOrderFormSnapshot(prisma, id),
      listClientLinkStatuses(prisma, id),
      listInstallationClarifications(prisma, id),
      getInstallationReadiness(prisma, id),
      listInstallationFormRevisions(prisma, id),
    ])
    return { employees, catalog, templates, formSnapshot, clientLinks, clarifications, readiness, formRevisions }
  })() : null

  return <InstallationOrderDetail
    order={order}
    employees={coordinatorData?.employees ?? []}
    canEdit={canCoordinateClientForm}
    canArchive={canArchiveInstallationOrder(viewer, order)}
    rooms={rooms}
    catalog={coordinatorData?.catalog ?? []}
    publishedTemplates={coordinatorData?.templates.filter((template) => template.status === 'PUBLISHED').map(({ id: templateId, name, version }) => ({ id: templateId, name, version })) ?? []}
    formSnapshot={coordinatorData?.formSnapshot ?? null}
    clientLinks={coordinatorData?.clientLinks ?? []}
    clarifications={coordinatorData?.clarifications ?? []}
    readiness={coordinatorData?.readiness ?? { isReady: false, openBlockingCount: 0, submittedCount: 0 }}
    formRevisions={coordinatorData?.formRevisions ?? []}
  />
}
