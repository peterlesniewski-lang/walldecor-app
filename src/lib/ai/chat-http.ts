import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma'
import { resolveDashboardPeriod, type DashboardPeriod } from '@/lib/finance/actual-dashboard'
import { loadActualDashboardModel } from '@/lib/finance/actual-dashboard-model-data'
import { buildFinanceAiContext } from './finance-context'
import { buildWikiContext } from './prompts'
import { aiChatPayloadSchema, type AiJobKind } from './contracts'
import { authorizeAiOwner, enqueueAiJob, readAiJob, retryAiJob } from './queue'
import { AiQueueError } from './queue-errors'
import { AI_HTTP_HEADERS, AiHttpError, aiHttpErrorResponse, readAiJson } from './http-common'

const sharedInput = { question: z.string().trim().min(1).max(500), requestId: z.uuid().optional() }
const financeSchema = z.strictObject({ ...sharedInput, year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) })
const wikiSchema = z.strictObject({ ...sharedInput, articleTitle: z.string().max(500).optional(), articleCategory: z.string().max(500).optional(), articleContent: z.string().max(100_000).optional() })
type Dependencies = { db: PrismaClient; getSession: () => Promise<{ user: { id?: string } } | null>; now?: () => Date }

export function createAiChatHandlers({ db, getSession, now = () => new Date() }: Dependencies) {
  async function ownerId() {
    const id = (await getSession())?.user.id
    if (!id) throw new AiHttpError('UNAUTHENTICATED', 401)
    return id
  }

  // Resolve a lost response before rebuilding a financial snapshot that may have changed.
  async function recoverRequest(owner: string, key: string | undefined, kind: AiJobKind, question: string, expected: DashboardPeriod | string) {
    if (!key) return null
    const existing = await db.aiJob.findUnique({ where: { ownerUserId_idempotencyKey: { ownerUserId: owner, idempotencyKey: key } }, select: { id: true, kind: true, payloadJson: true } })
    if (!existing) return null
    let matches = false
    try {
      const payload = aiChatPayloadSchema.parse(JSON.parse(existing.payloadJson))
      if (existing.kind === kind && payload.question === question) {
        if (typeof expected === 'string') matches = payload.context === expected
        else {
          const context = JSON.parse(payload.context) as { period?: DashboardPeriod }
          matches = context.period?.year === expected.year && context.period?.month === expected.month
        }
      }
    } catch { /* Invalid stored data is not silently replaced by a new request. */ }
    if (!matches) throw new AiHttpError('IDEMPOTENCY_CONFLICT', 409)
    return readAiJob(db, owner, existing.id)
  }

  return {
    async financePOST(req: NextRequest) {
      try {
        const owner = await ownerId()
        await authorizeAiOwner(db, owner, 'FINANCE_CHAT')
        const parsed = financeSchema.safeParse(await readAiJson(req))
        if (!parsed.success) throw new AiHttpError('INVALID_INPUT', 400)
        const { question, year, month, requestId } = parsed.data
        const readAt = now()
        const resolved = resolveDashboardPeriod({ year: String(year), month: String(month) }, readAt)
        if (!resolved.ok) throw new AiHttpError('INVALID_INPUT', 400)
        const existing = await recoverRequest(owner, requestId, 'FINANCE_CHAT', question, resolved.period)
        if (existing) return NextResponse.json({ job: existing }, { status: 202, headers: AI_HTTP_HEADERS })
        const context = JSON.stringify(buildFinanceAiContext(await loadActualDashboardModel(resolved.period, readAt)))
        try {
          const job = await enqueueAiJob(db, owner, { kind: 'FINANCE_CHAT', payload: { question, context } }, requestId)
          return NextResponse.json({ job }, { status: 202, headers: AI_HTTP_HEADERS })
        } catch (error) {
          if (!(error instanceof AiQueueError) || error.code !== 'IDEMPOTENCY_CONFLICT') throw error
          const recovered = await recoverRequest(owner, requestId, 'FINANCE_CHAT', question, resolved.period)
          if (!recovered) throw error
          return NextResponse.json({ job: recovered }, { status: 202, headers: AI_HTTP_HEADERS })
        }
      } catch (error) { return aiHttpErrorResponse(error) }
    },

    async wikiPOST(req: NextRequest) {
      try {
        const owner = await ownerId()
        await authorizeAiOwner(db, owner, 'WIKI_CHAT')
        const parsed = wikiSchema.safeParse(await readAiJson(req))
        if (!parsed.success) throw new AiHttpError('INVALID_INPUT', 400)
        const { question, requestId, articleTitle, articleCategory, articleContent } = parsed.data
        const context = buildWikiContext(articleTitle, articleCategory, articleContent)
        const existing = await recoverRequest(owner, requestId, 'WIKI_CHAT', question, context)
        const job = existing ?? await enqueueAiJob(db, owner, { kind: 'WIKI_CHAT', payload: { question, context } }, requestId)
        return NextResponse.json({ job }, { status: 202, headers: AI_HTTP_HEADERS })
      } catch (error) { return aiHttpErrorResponse(error) }
    },

    async jobGET(id: string) {
      try { return NextResponse.json({ job: await readAiJob(db, await ownerId(), id) }, { headers: AI_HTTP_HEADERS }) }
      catch (error) { return aiHttpErrorResponse(error) }
    },

    async retryPOST(id: string) {
      try { return NextResponse.json({ job: await retryAiJob(db, await ownerId(), id) }, { status: 202, headers: AI_HTTP_HEADERS }) }
      catch (error) { return aiHttpErrorResponse(error) }
    },
  }
}
