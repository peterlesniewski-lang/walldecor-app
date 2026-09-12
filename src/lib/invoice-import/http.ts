import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma'
import { readAiJson } from '@/lib/ai/http-common'
import { parseInstallationMultipart } from '@/lib/installation-media/multipart'
import { approveInvoiceDraft, revokeInvoiceDraft } from './approval-service'
import { invoiceDraftDataSchema } from './contracts'
import { archiveDraft, createBatch, editDraft, getDraft, listDrafts, requestExtraction, restoreDraft, skipDraft } from './draft-service'
import { getInvoiceOriginal, uploadInvoiceDocument, type InvoiceFileEnvironment } from './file-service'
import { INVOICE_HTTP_HEADERS, InvoiceImportHttpError, invoiceHttpErrorResponse } from './http-errors'
import { getDraftKsefReconciliations, resolveDraftKsefReconciliation } from './ksef-reconciliation-service'

interface Dependencies {
  db: PrismaClient
  getSession: () => Promise<{ user: { id?: string } } | null>
  files: () => Promise<InvoiceFileEnvironment>
}

const id = z.string().trim().min(1).max(191)
const version = z.number().int().positive()
const querySchema = z.strictObject({
  batchId: id.optional(), state: z.enum(['OPEN', 'APPROVED', 'ARCHIVED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
const editSchema = z.strictObject({ expectedVersion: version, data: invoiceDraftDataSchema })
const actionSchema = z.strictObject({
  expectedVersion: version, action: z.enum(['EXTRACT', 'SKIP', 'ARCHIVE', 'RESTORE']),
})
const historyQuerySchema = z.strictObject({ cursor: id.optional() })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new InvoiceImportHttpError('INVALID_INPUT', 422)
  return parsed.data
}

function query<T>(schema: z.ZodType<T>, request: NextRequest): T {
  const fields: Record<string, string> = Object.create(null)
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(fields, key)) throw new InvoiceImportHttpError('INVALID_INPUT', 422)
    fields[key] = value
  }
  return parse(schema, fields)
}

function contentDisposition(filename: string, download: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const utf8 = encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

/** Thin authenticated HTTP adapter. Domain services repeat authorization inside
 * their transactions; this first check also prevents unauthorised body work. */
export function createInvoiceImportHandlers({ db, getSession, files }: Dependencies) {
  async function actor() {
    const actorId = (await getSession())?.user.id
    if (!actorId) throw new InvoiceImportHttpError('UNAUTHENTICATED', 401)
    const user = await db.user.findUnique({
      where: { id: actorId }, select: { role: true, isActive: true, mustChangePassword: true },
    })
    if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) {
      throw new InvoiceImportHttpError('FORBIDDEN', 403)
    }
    return actorId
  }

  async function respond(operation: (actorId: string) => Promise<NextResponse>) {
    try { return await operation(await actor()) }
    catch (error) { return invoiceHttpErrorResponse(error) }
  }
  const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: INVOICE_HTTP_HEADERS })

  return {
    batchesPOST: () => respond(async (actorId) => json({ batch: await createBatch(db, actorId) }, 201)),
    draftsGET: (req: NextRequest) => respond(async (actorId) =>
      json({ drafts: await listDrafts(db, actorId, query(querySchema, req)) }),
    ),
    draftsPOST: (req: NextRequest) => respond(async (actorId) => {
      const upload = await parseInstallationMultipart(req, { allowedFields: ['batchId'] })
      const result = await uploadInvoiceDocument(db, actorId, {
        batchId: upload.fields.batchId, originalName: upload.file.filename, bytes: upload.file.bytes,
      }, await files())
      return json(result, result.deduplicated ? 200 : 201)
    }),
    draftGET: (draftId: string) => respond(async (actorId) => json({ draft: await getDraft(db, actorId, draftId) })),
    ksefGET: (draftId: string) => respond(async (actorId) =>
      json({ reconciliation: await getDraftKsefReconciliations(db, actorId, draftId) }),
    ),
    ksefPOST: (req: NextRequest, draftId: string) => respond(async (actorId) =>
      json({ result: await resolveDraftKsefReconciliation(db, actorId, draftId, await readAiJson(req, 8_000)) }),
    ),
    draftPATCH: (req: NextRequest, draftId: string) => respond(async (actorId) => {
      const input = parse(editSchema, await readAiJson(req, 64_000))
      return json({ draft: await editDraft(db, actorId, draftId, input.expectedVersion, input.data) })
    }),
    actionsPOST: (req: NextRequest, draftId: string) => respond(async (actorId) => {
      const input = parse(actionSchema, await readAiJson(req, 8_000))
      const action = { EXTRACT: requestExtraction, SKIP: skipDraft, ARCHIVE: archiveDraft, RESTORE: restoreDraft }[input.action]
      return json({ draft: await action(db, actorId, draftId, input.expectedVersion) })
    }),
    fileGET: (req: NextRequest, draftId: string) => respond(async (actorId) => {
      const { download } = query(z.strictObject({ download: z.literal('1').optional() }), req)
      const original = await getInvoiceOriginal(db, actorId, draftId, await files())
      return new NextResponse(Uint8Array.from(original.bytes), { headers: {
        ...INVOICE_HTTP_HEADERS,
        'Content-Type': original.mimeType,
        'Content-Length': String(original.byteSize),
        'Content-Disposition': contentDisposition(original.originalName, download === '1'),
        'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      } })
    }),
    approvePOST: (req: NextRequest, draftId: string) => respond(async (actorId) =>
      json({ result: await approveInvoiceDraft(db, actorId, draftId, await readAiJson(req, 8_000)) }),
    ),
    approveDELETE: (req: NextRequest, draftId: string) => respond(async (actorId) =>
      json({ result: await revokeInvoiceDraft(db, actorId, draftId, await readAiJson(req, 8_000)) }),
    ),
    historyGET: (req: NextRequest, draftId: string) => respond(async (actorId) => {
      const { cursor } = query(historyQuerySchema, req)
      await getDraft(db, actorId, draftId)
      if (cursor && !await db.invoiceDraftAudit.findFirst({ where: { id: cursor, draftId }, select: { id: true } })) {
        throw new InvoiceImportHttpError('INVALID_INPUT', 422)
      }
      const rows = await db.invoiceDraftAudit.findMany({
        where: { draftId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
      })
      const entries = rows.slice(0, 50).map(({ actor: author, ...entry }) => ({ ...entry, actorName: author?.name ?? null }))
      return json({ entries, nextCursor: rows.length > 50 ? entries.at(-1)!.id : null })
    }),
  }
}
