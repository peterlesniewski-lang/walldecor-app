import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallationGuideForViewer } from '@/lib/installations/guide-service'
import { InstallationGuideArticle } from '@/components/installations/installation-guide-article'

export default async function InstallationGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { slug } = await params
  const viewer = await installationViewerFromSession(session)
  const guide = getInstallationGuideForViewer(slug, viewer)
  if (!guide) notFound()

  return <InstallationGuideArticle guide={guide} />
}
