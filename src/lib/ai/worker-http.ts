import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma'
import { claimAiJob, heartbeatAiJob, finishAiJob } from './queue'
import { aiFailureCodeSchema } from './queue-errors'
import { aiJobResultJsonSchema } from './contracts'
import { buildAiPrompt } from './prompts'
import { AI_HTTP_HEADERS, AiHttpError, aiHttpErrorResponse, readAiJson } from './http-common'
import { getInvoiceWorkerDocument, invoiceWorkerDocumentRequestSchema } from './worker-document'
import type { InvoiceFileEnvironment } from '@/lib/invoice-import/file-service'

const workerId = z.string().trim().min(1).max(191)
const lease = { workerId, jobId: z.string().min(1).max(191), leaseToken: z.uuid() }
const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('claim'), workerId }),
  z.strictObject({ action: z.literal('heartbeat'), ...lease }),
  z.strictObject({ action: z.literal('document'), ...invoiceWorkerDocumentRequestSchema.shape }),
  z.strictObject({ action: z.literal('finish'), ...lease, outcome: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('SUCCEEDED'), result: z.unknown() }),
    z.strictObject({ status: z.enum(['FAILED', 'BLOCKED']), errorCode: aiFailureCodeSchema }),
  ]) }),
])

export function authorizeAiWorker(req: NextRequest, secret: string | undefined) {
  if (!secret || secret.length < 32) throw new AiHttpError('WORKER_NOT_CONFIGURED', 503)
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ') || header.length > 1024) throw new AiHttpError('UNAUTHENTICATED', 401)
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(header.slice(7)), digest(secret))) throw new AiHttpError('UNAUTHENTICATED', 401)
}

/** This key grants only queue execution. It never authorizes a general database or file query. */
export function createAiWorkerHandler({ db, secret, files }: {
  db: PrismaClient
  secret: () => string | undefined
  files?: () => Promise<InvoiceFileEnvironment>
}) {
  return async function POST(req: NextRequest) {
    try {
      authorizeAiWorker(req, secret())
      const parsed = commandSchema.safeParse(await readAiJson(req))
      if (!parsed.success) throw new AiHttpError('INVALID_INPUT', 400)
      const command = parsed.data
      if (command.action === 'claim') {
        const claimed = await claimAiJob(db, command.workerId)
        if (!claimed) return NextResponse.json({ job: null }, { headers: AI_HTTP_HEADERS })
        return NextResponse.json({ job: {
          id: claimed.id, kind: claimed.kind, leaseToken: claimed.leaseToken, leaseUntil: claimed.leaseUntil,
          prompt: claimed.kind === 'INVOICE_EXTRACT' ? buildAiPrompt('INVOICE_EXTRACT') : buildAiPrompt(claimed.kind, claimed.payload),
          schema: aiJobResultJsonSchema(claimed.kind),
          ...(claimed.kind === 'INVOICE_EXTRACT' ? { document: { attachmentId: claimed.payload.attachmentId } } : {}),
        } }, { headers: AI_HTTP_HEADERS })
      }
      if (command.action === 'heartbeat') {
        const leaseUntil = await heartbeatAiJob(db, command.workerId, command.jobId, command.leaseToken)
        return NextResponse.json({ leaseUntil }, { headers: AI_HTTP_HEADERS })
      }
      if (command.action === 'document') {
        if (!files) throw new AiHttpError('WORKER_NOT_CONFIGURED', 503)
        const document = await getInvoiceWorkerDocument(db, {
          workerId: command.workerId,
          jobId: command.jobId,
          leaseToken: command.leaseToken,
          attachmentId: command.attachmentId,
        }, await files())
        return new NextResponse(new Uint8Array(document.bytes), { headers: {
          ...AI_HTTP_HEADERS,
          'Content-Type': document.mimeType,
          'Content-Length': String(document.byteSize),
          'Content-Encoding': 'identity',
          'X-Content-Sha256': document.sha256,
          'X-Content-Type-Options': 'nosniff',
        } })
      }
      await finishAiJob(db, command.workerId, command.jobId, command.leaseToken, command.outcome)
      return NextResponse.json({ ok: true }, { headers: AI_HTTP_HEADERS })
    } catch (error) { return aiHttpErrorResponse(error) }
  }
}
