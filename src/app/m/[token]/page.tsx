import { Bricolage_Grotesque, Spline_Sans } from 'next/font/google'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { InstallationClientLinkNotFoundError, loadPublicInstallationProjection } from '@/lib/installations/client-link'
import { ClientInstallationForm, type ClientFormProjection } from '@/components/installations/client-form/client-installation-form'

const display = Bricolage_Grotesque({ variable: '--font-client-display', subsets: ['latin', 'latin-ext'], weight: ['700', '800'] })
const sans = Spline_Sans({ variable: '--font-client-sans', subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'] })

type Params = { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic'

export default async function ClientInstallationPage({ params }: Params) {
  const { token } = await params
  try {
    const projection = await loadPublicInstallationProjection(prisma, token)
    return <div className={`${display.variable} ${sans.variable}`}>
      <ClientInstallationForm token={token} initialProjection={projection as ClientFormProjection} />
    </div>
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) notFound()
    throw error
  }
}
