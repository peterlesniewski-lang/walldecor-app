import { NextRequest, NextResponse } from 'next/server'
import { AiQueueError } from './queue-errors'

export const AI_HTTP_HEADERS = { 'Cache-Control': 'private, no-store' }
export class AiHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'AiHttpError' }
}

export function aiHttpErrorResponse(error: unknown) {
  if (error instanceof AiHttpError || error instanceof AiQueueError) {
    return NextResponse.json({ error: 'Nie udało się obsłużyć zadania AI.', code: error.code }, { status: error.status, headers: AI_HTTP_HEADERS })
  }
  return NextResponse.json({ error: 'Nie udało się obsłużyć zadania AI.', code: 'RUNNER_ERROR' }, { status: 500, headers: AI_HTTP_HEADERS })
}

/** Stream limit also covers requests without Content-Length. No unbounded req.json(). */
export async function readAiJson(req: NextRequest, maxBytes = 128_000): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AiHttpError('INVALID_CONTENT_TYPE', 415)
  const statedLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(statedLength) && statedLength > maxBytes) throw new AiHttpError('REQUEST_TOO_LARGE', 413)
  const reader = req.body?.getReader()
  if (!reader) throw new AiHttpError('INVALID_JSON', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new AiHttpError('REQUEST_TOO_LARGE', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AiHttpError('INVALID_JSON', 400) }
}
