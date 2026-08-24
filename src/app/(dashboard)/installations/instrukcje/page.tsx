import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { listInstallationGuidesForViewer } from '@/lib/installations/guide-service'
import { InstallationGuideList } from '@/components/installations/installation-guide-list'

export default async function InstallationGuidesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const viewer = await installationViewerFromSession(session)
  const guides = listInstallationGuidesForViewer(viewer)

  return <InstallationGuideList guides={guides} />
}
