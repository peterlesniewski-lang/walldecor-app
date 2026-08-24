import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import {
  createClientLink,
  extendClientLink,
  InstallationClientLinkNotFoundError,
  InstallationClientLinkPrerequisiteError,
  InstallationClientLinkValidationError,
  markClientLinkSent,
  revokeClientLink,
} from '@/lib/installations/client-link'

type Params = { params: Promise<{ id: string }> }

const expiry = z.string().datetime({ offset: true }).transform((value) => new Date(value))
const createSchema = z.object({ expiresAt: expiry }).strict()
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('REVOKE'), linkId: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('EXTEND'), linkId: z.string().trim().min(1), expiresAt: expiry }).strict(),
  z.object({ action: z.literal('MARK_SENT'), linkId: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('REGENERATE'), expiresAt: expiry }).strict(),
])

function safeLink(link: { id: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date; lastOpenedAt: Date | null; sentAt: Date | null; sentById: string | null }) {
  return {
    id: link.id,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt,
    lastOpenedAt: link.lastOpenedAt,
    sentAt: link.sentAt,
    sentById: link.sentById,
  }
}

async function editableSession(orderId: string): Promise<
  { response: NextResponse } | { session: { user: { id: string } } }
> {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await editableInstallationOrder(session, orderId)
  if ('response' in access && access.response) return { response: access.response }
  return { session: session as { user: { id: string } } }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if ('response' in access) return access.response
  try {
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Podaj poprawną datę wygaśnięcia.' }, { status: 400 })
    const created = await createClientLink(prisma, { orderId: id, createdById: access.session.user.id, expiresAt: parsed.data.expiresAt })
    // This is intentionally the only route response containing the plaintext URL.
    return NextResponse.json({
      link: safeLink(created.link),
      url: new URL(`/m/${created.token}`, req.nextUrl.origin).toString(),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkPrerequisiteError) return NextResponse.json({ error: 'Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.' }, { status: 409 })
    if (error instanceof InstallationClientLinkValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Podaj poprawną datę wygaśnięcia.' }, { status: 400 })
    throw error
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if ('response' in access) return access.response
  try {
    const parsed = actionSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Działanie dla linku jest niepoprawne.' }, { status: 400 })
    if (parsed.data.action === 'REVOKE') {
      return NextResponse.json({ link: safeLink(await revokeClientLink(prisma, parsed.data.linkId, access.session.user.id, id)) })
    }
    if (parsed.data.action === 'EXTEND') {
      return NextResponse.json({ link: safeLink(await extendClientLink(prisma, parsed.data.linkId, parsed.data.expiresAt, access.session.user.id, id)) })
    }
    if (parsed.data.action === 'MARK_SENT') {
      return NextResponse.json({ link: safeLink(await markClientLinkSent(prisma, parsed.data.linkId, access.session.user.id, id)) })
    }
    const created = await createClientLink(prisma, { orderId: id, createdById: access.session.user.id, expiresAt: parsed.data.expiresAt })
    return NextResponse.json({
      link: safeLink(created.link),
      url: new URL(`/m/${created.token}`, req.nextUrl.origin).toString(),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof InstallationClientLinkPrerequisiteError) return NextResponse.json({ error: 'Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.' }, { status: 409 })
    if (error instanceof InstallationClientLinkNotFoundError) return NextResponse.json({ error: 'Nie znaleziono linku.' }, { status: 404 })
    if (error instanceof InstallationClientLinkValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Działanie dla linku jest niepoprawne.' }, { status: 400 })
    throw error
  }
}
