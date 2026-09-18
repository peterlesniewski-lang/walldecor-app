import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { installationPublicUrl } from '@/lib/installations/public-url'
import { ClientLinkDecryptionError, ClientLinkEncryptionConfigurationError } from '@/lib/installations/client-link-crypto'
import {
  createClientLink,
  extendClientLink,
  InstallationClientLinkNotFoundError,
  InstallationClientLinkPrerequisiteError,
  InstallationClientLinkValidationError,
  markClientLinkSent,
  revokeClientLink,
  retrieveCurrentClientLink,
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

function encryptionFailure(error: unknown) {
  if (error instanceof ClientLinkEncryptionConfigurationError) return NextResponse.json({ error: error.message, code: 'CLIENT_LINK_ENCRYPTION_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (error instanceof ClientLinkDecryptionError) return NextResponse.json({ error: error.message, code: 'CLIENT_LINK_DECRYPTION_FAILED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return null
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if ('response' in access) {
    access.response.headers.set('Cache-Control', 'no-store')
    return access.response
  }
  try {
    const current = await retrieveCurrentClientLink(prisma, id)
    return NextResponse.json({
      link: current.link ? safeLink(current.link) : null,
      url: current.token ? installationPublicUrl(`/m/${current.token}`, req.nextUrl.origin) : null,
      reason: current.reason,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const failure = encryptionFailure(error)
    if (failure) return failure
    return NextResponse.json({ error: 'Nie udało się odczytać linku klienta.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if ('response' in access) return access.response
  try {
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Podaj poprawną datę wygaśnięcia.' }, { status: 400 })
    const created = await createClientLink(prisma, { orderId: id, createdById: access.session.user.id, expiresAt: parsed.data.expiresAt })
    // Plaintext URLs are returned only through this editor-authorized endpoint.
    return NextResponse.json({
      link: safeLink(created.link),
      url: installationPublicUrl(`/m/${created.token}`, req.nextUrl.origin),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const failure = encryptionFailure(error)
    if (failure) return failure
    if (error instanceof InstallationClientLinkPrerequisiteError) return NextResponse.json({ error: 'Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.' }, { status: 409 })
    if (error instanceof InstallationClientLinkValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Podaj poprawną datę wygaśnięcia.' }, { status: 400 })
    return NextResponse.json({ error: 'Nie udało się utworzyć linku klienta.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
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
      url: installationPublicUrl(`/m/${created.token}`, req.nextUrl.origin),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const failure = encryptionFailure(error)
    if (failure) return failure
    if (error instanceof InstallationClientLinkPrerequisiteError) return NextResponse.json({ error: 'Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.' }, { status: 409 })
    if (error instanceof InstallationClientLinkNotFoundError) return NextResponse.json({ error: 'Nie znaleziono linku.' }, { status: 404 })
    if (error instanceof InstallationClientLinkValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Działanie dla linku jest niepoprawne.' }, { status: 400 })
    return NextResponse.json({ error: 'Nie udało się zaktualizować linku klienta.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
