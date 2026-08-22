import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  InstallationClientLinkNotFoundError,
  loadPublicInstallationProjection,
  publicClientLinkNotFound,
} from '@/lib/installations/client-link'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  try {
    const projection = await loadPublicInstallationProjection(prisma, token)
    return NextResponse.json(projection, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkNotFoundError) return publicClientLinkNotFound()
    throw error
  }
}
