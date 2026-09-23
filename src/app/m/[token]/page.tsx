import { clientDisplay as display, clientSans as sans } from '@/app/fonts'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, loadPublicInstallationProjection } from '@/lib/installations/client-link'
import { ClientInstallationForm, type ClientFormProjection } from '@/components/installations/client-form/client-installation-form'

type Params = { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic'

export default async function ClientInstallationPage({ params }: Params) {
  const { token } = await params
  let projection: Awaited<ReturnType<typeof loadPublicInstallationProjection>>
  try {
    projection = await loadPublicInstallationProjection(prisma, token)
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) notFound()
    throw error
  }
  return <div className={`${display.variable} ${sans.variable}`}>
    <ClientInstallationForm token={token} initialProjection={projection as ClientFormProjection} />
  </div>
}
