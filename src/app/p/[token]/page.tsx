import { clientDisplay, clientSans } from '@/app/fonts'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AcceptanceLinkNotFoundError, publicAcceptanceProjection } from '@/lib/installations/acceptance-client'
import { ClientAcceptancePage } from '@/components/installations/client-acceptance-page'

type Params = { params: Promise<{ token: string }> }
export const dynamic = 'force-dynamic'

export default async function PublicAcceptancePage({ params }: Params) {
  const { token } = await params
  let projection: Awaited<ReturnType<typeof publicAcceptanceProjection>>
  try { projection = await publicAcceptanceProjection(prisma, token) }
  catch (error) { if (error instanceof AcceptanceLinkNotFoundError) notFound(); throw error }
  return <div className={`${clientDisplay.variable} ${clientSans.variable}`}><ClientAcceptancePage token={token} protocol={projection} /></div>
}
