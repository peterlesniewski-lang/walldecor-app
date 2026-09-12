import { randomUUID } from 'node:crypto'
import { fstatSync, statSync } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createAiWorkerConsumer, type AiWorkerRunStatus } from '../src/lib/ai/worker-consumer'
import {
  createAiWorkerTransport,
  AiWorkerTransportError,
  type AiWorkerTransport,
  type ParsedAiWorkerClaim,
} from '../src/lib/ai/worker-client'
import { runCodexJob, type CodexRunnerConfig } from '../src/lib/ai/codex-runner'
import { CodexRunError } from '../src/lib/ai/codex-policy'
import {
  withInvoiceDocumentImages,
  type InvoiceDocumentProcessorConfig,
} from '../src/lib/invoice-import/document-processor'
import type { AiJobResult } from '../src/lib/ai/contracts'

export function readAiWorkerConfig(environment: NodeJS.ProcessEnv) {
  if (environment.AI_WORKER_ENABLED !== 'true') throw new AiWorkerTransportError('INVALID_CONFIG')
  const config = { url: environment.AI_WORKER_URL ?? '', secret: environment.AI_WORKER_SECRET ?? '' }
  createAiWorkerTransport(config) // Validate before opening a session or claiming work.
  return config
}

export async function runAiWorkerLoop(
  consumer: { runOnce: (signal: AbortSignal) => Promise<AiWorkerRunStatus> },
  signal: AbortSignal,
  onStatus: (status: AiWorkerRunStatus) => void = () => {},
) {
  while (!signal.aborted) {
    const status = await consumer.runOnce(signal)
    if (signal.aborted) break
    if (status !== 'idle') onStatus(status)
    if (status !== 'succeeded') {
      try { await delay(status === 'idle' ? 5_000 : 10_000, undefined, { signal }) }
      catch { if (!signal.aborted) throw new Error('WORKER_WAIT_FAILED') }
    }
  }
}

type WorkerJobRunnerDependencies = {
  codex: Omit<CodexRunnerConfig, 'signal'>
  document: Omit<InvoiceDocumentProcessorConfig, 'signal'>
  runCodex?: typeof runCodexJob
}

/** The claim supplies only a server-issued attachment handle. All executable
 * paths remain fixed operator configuration in the isolated worker. */
export function createAiWorkerJobRunner(
  transport: Pick<AiWorkerTransport, 'document'>,
  workerId: string,
  dependencies: WorkerJobRunnerDependencies,
) {
  const executeCodex = dependencies.runCodex ?? runCodexJob
  return async (claim: ParsedAiWorkerClaim, signal: AbortSignal): Promise<AiJobResult> => {
    try {
      if (claim.kind !== 'INVOICE_EXTRACT') {
        return await executeCodex({ kind: claim.kind, prompt: claim.prompt, schema: claim.schema }, {
          ...dependencies.codex, signal,
        })
      }
      if (!claim.document) throw new CodexRunError('INVALID_RESULT')
      const document = await transport.document({
        workerId,
        jobId: claim.id,
        leaseToken: claim.leaseToken,
        attachmentId: claim.document.attachmentId,
      }, signal)
      return await withInvoiceDocumentImages(document.bytes, {
        ...dependencies.document,
        signal,
      }, async (imagePaths, metadata) => {
        if (metadata.mimeType !== document.mimeType || metadata.byteSize !== document.byteSize ||
          metadata.sha256 !== document.sha256 || metadata.byteSize !== document.bytes.byteLength) {
          throw new CodexRunError('RUNNER_ERROR')
        }
        return executeCodex({
          kind: claim.kind,
          prompt: claim.prompt,
          schema: claim.schema,
          imagePaths: [...imagePaths],
        }, { ...dependencies.codex, signal })
      })
    } catch (error) {
      if (error instanceof CodexRunError) throw error
      if (error instanceof AiWorkerTransportError) {
        if (error.code === 'AUTH') throw new CodexRunError('AUTH')
        if (error.code === 'TIMEOUT') throw new CodexRunError('TIMEOUT')
      }
      throw new CodexRunError('RUNNER_ERROR')
    }
  }
}

async function ensurePrivateRuntimeRoot(target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 })
  const info = await lstat(target)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && info.uid !== process.getuid())) {
    throw new Error('PRIVATE_RUNTIME_ROOT_REQUIRED')
  }
}

async function main() {
  const config = readAiWorkerConfig(process.env)
  // The Linux entrypoint locks FD 9 before starting this process. It is retained
  // by the CLI as FD 3, so killing only this supervisor cannot release the lock.
  const lock = fstatSync(9)
  const expected = statSync('/oauth/.session.lock')
  if (process.platform !== 'linux' || !lock.isFile() || lock.ino !== expected.ino || lock.dev !== expected.dev) throw new Error('SESSION_LOCK_REQUIRED')
  await Promise.all([
    ensurePrivateRuntimeRoot('/runtime/jobs'),
    ensurePrivateRuntimeRoot('/runtime/documents'),
  ])
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  try {
    const transport = createAiWorkerTransport(config)
    const workerId = `private-ai-${randomUUID()}`
    const runJob = createAiWorkerJobRunner(transport, workerId, {
      codex: {
        binary: '/usr/local/bin/codex', catalogPath: '/opt/ai/worker/ai/catalog.json',
        oauthHome: '/oauth', workRoot: '/runtime/jobs', sessionLockFd: 9,
      },
      document: {
        pdfInfoBinary: '/usr/bin/pdfinfo', pdfToPpmBinary: '/usr/bin/pdftoppm', workRoot: '/runtime/documents',
      },
    })
    const consumer = createAiWorkerConsumer({
      transport, workerId, runJob,
    })
    process.stdout.write('{"event":"AI_WORKER_STARTED"}\n')
    await runAiWorkerLoop(consumer, controller.signal, (status) => {
      process.stdout.write(`${JSON.stringify({ event: 'AI_JOB_FINISHED', status })}\n`)
    })
  } finally {
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

if (process.argv[1]?.endsWith('/run-ai-worker.ts')) {
  main().catch(() => {
    process.stderr.write('AI_WORKER_START_FAILED\n')
    process.exitCode = 1
  })
}
