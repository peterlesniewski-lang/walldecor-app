import { Bricolage_Grotesque, Spline_Sans } from 'next/font/google'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AcceptanceLinkNotFoundError, publicAcceptanceProjection } from '@/lib/installations/acceptance-client'
import { ClientAcceptancePage } from '@/components/installations/client-acceptance-page'

const display = Bricolage_Grotesque({ variable: '--font-acceptance-display', subsets: ['latin', 'latin-ext'], weight: ['700', '800'] })
const sans = Spline_Sans({ variable: '--font-acceptance-sans', subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'] })
type Params = { params: Promise<{ token: string }> }
export const dynamic = 'force-dynamic'

export default async function PublicAcceptancePage({ params }: Params) {
  const { token } = await params
  let projection: Awaited<ReturnType<typeof publicAcceptanceProjection>>
  try { projection = await publicAcceptanceProjection(prisma, token) }
  catch (error) { if (error instanceof AcceptanceLinkNotFoundError) notFound(); throw error }
  return <div className={`${display.variable} ${sans.variable}`}><ClientAcceptancePage token={token} protocol={projection} /></div>
}
