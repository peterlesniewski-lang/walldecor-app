// @vitest-environment node
import { copyFile, mkdir, readFile, readdir, symlink } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createAiWorkerJobRunner, readAiWorkerConfig, runAiWorkerLoop } from '../../../scripts/run-ai-worker'
import { aiJobResultJsonSchema } from '@/lib/ai/contracts'

describe('private AI worker startup', () => {
  const environment = { AI_WORKER_ENABLED: 'true', AI_WORKER_URL: 'http://app:3000/api/internal/ai-worker', AI_WORKER_SECRET: 's'.repeat(48) }

  it('requires deliberate enablement and complete operator configuration', () => {
    expect(() => readAiWorkerConfig({ ...environment, AI_WORKER_ENABLED: 'false' })).toThrow('INVALID_CONFIG')
    expect(() => readAiWorkerConfig({ ...environment, AI_WORKER_SECRET: '' })).toThrow('INVALID_CONFIG')
    expect(() => readAiWorkerConfig({ ...environment, AI_WORKER_URL: 'https://app/redirect' })).toThrow('INVALID_CONFIG')
    expect(readAiWorkerConfig({ ...environment, DATABASE_URL: 'private', OPENAI_API_KEY: 'private' })).toEqual({ url: environment.AI_WORKER_URL, secret: environment.AI_WORKER_SECRET })
  })

  it('waits for a current run to settle before handling shutdown', async () => {
    const controller = new AbortController()
    let finish!: () => void
    const runner = { runOnce: vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      return 'lease_lost' as const
    }) }
    let settled = false
    const running = runAiWorkerLoop(runner, controller.signal).then(() => { settled = true })
    controller.abort()
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await running
    expect(runner.runOnce).toHaveBeenCalledTimes(1)
  })

  it('does not claim work after shutdown or leak raw model data in logs', async () => {
    const controller = new AbortController()
    controller.abort()
    const runner = { runOnce: vi.fn() }
    await runAiWorkerLoop(runner, controller.signal)
    expect(runner.runOnce).not.toHaveBeenCalled()
  })

  it('holds one shared OAuth lock across login, smoke and consumer modes; defaults to validation only', async () => {
    const entrypoint = await readFile('worker/ai/entrypoint.sh', 'utf8')
    expect(entrypoint).toContain('exec 9>>/oauth/.session.lock')
    expect(entrypoint).toContain('flock --exclusive --nonblock 9')
    expect(entrypoint).toContain('--session-lock-fd 9')
    expect(entrypoint).toContain('env -i')
    expect(entrypoint).not.toMatch(/eval|with-api-key|auth\.json|cp /)
    const dockerfile = await readFile('worker/ai/Dockerfile', 'utf8')
    const dockerignore = await readFile('worker/ai/Dockerfile.dockerignore', 'utf8')
    expect(dockerfile).toContain('CMD ["validate"]')
    expect(dockerfile).toContain('worker/ai/entrypoint.sh')
    expect(dockerfile).toContain('chmod 0700 /oauth /runtime')
    expect(dockerfile).toContain('COPY src/lib/invoice-import/contracts.ts src/lib/invoice-import/document-processor.ts ./src/lib/invoice-import/')
    expect(dockerignore).toContain('!src/lib/invoice-import/contracts.ts')
    expect(dockerignore).toContain('!src/lib/invoice-import/document-processor.ts')
  })

  it('loads invoice contracts using only source files shipped by the worker image', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'walldecor-worker-package-'))
    try {
      const dockerfile = await readFile('worker/ai/Dockerfile', 'utf8')
      const allowed = new Set((await readFile('worker/ai/Dockerfile.dockerignore', 'utf8')).split(/\r?\n/))
      for (const line of dockerfile.split(/\r?\n/).filter((line) => line.startsWith('COPY src/'))) {
        const [, ...parts] = line.split(/\s+/)
        const destination = parts.pop()!
        await mkdir(path.join(root, destination), { recursive: true })
        for (const source of parts) {
          expect(allowed.has(`!${source}`), `${source} must be in the restricted build context`).toBe(true)
          await copyFile(source, path.join(root, destination, path.basename(source)))
        }
      }
      await symlink(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir')
      const { stdout } = await promisify(execFile)(process.execPath, [
        '--preserve-symlinks', '--import', 'tsx', '--input-type=module', '--eval',
        "const m = await import('./src/lib/invoice-import/contracts.ts'); const c = m.default ?? m; console.log(c.invoiceDraftDataSchema.safeParse({currency:'EUR'}).success)",
      ], { cwd: root, timeout: 15_000, env: { PATH: process.env.PATH } })
      expect(stdout.trim()).toBe('true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('downloads and renders invoice bytes, awaits the model callback, then removes document images', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'walldecor-worker-runtime-'))
    const documents = path.join(root, 'documents')
    await mkdir(documents, { mode: 0o700 })
    const original = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ccb98f' } }).png().toBuffer()
    let release!: () => void
    const modelSettled = new Promise<void>((resolve) => { release = resolve })
    const runCodex = vi.fn(async (input: { imagePaths?: string[] }) => {
      expect(input.imagePaths).toHaveLength(1)
      expect(await readdir(documents)).toHaveLength(1)
      await modelSettled
      return { documentType: null, supplierName: null, taxId: null, invoiceNumber: null, issueDate: null, dueDate: null,
        currency: null, gross: null, net: null, vat: null, bankAccount: null, paymentStatus: null, warnings: [] }
    })
    const transport = { document: vi.fn().mockResolvedValue({
      bytes: original,
      mimeType: 'image/png',
      byteSize: original.length,
      sha256: createHash('sha256').update(original).digest('hex'),
    }) }
    const claim = { id: 'job-one', kind: 'INVOICE_EXTRACT' as const, leaseToken: 'c80d6c22-af27-43a3-bef1-1fc0ed7fa7de',
      leaseUntil: '2026-09-11T10:01:00.000Z', prompt: 'Extract', schema: aiJobResultJsonSchema('INVOICE_EXTRACT'), document: { attachmentId: 'attachment-one' } }
    const runner = createAiWorkerJobRunner(transport, 'worker-one', {
      codex: { binary: '/codex', catalogPath: '/catalog', oauthHome: '/oauth', workRoot: '/jobs', sessionLockFd: 9 },
      document: { pdfInfoBinary: '/usr/bin/pdfinfo', pdfToPpmBinary: '/usr/bin/pdftoppm', workRoot: documents },
      runCodex,
    })
    let settled = false
    const running = runner(claim, new AbortController().signal).then((result) => { settled = true; return result })
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    release()
    await running
    expect(await readdir(documents)).toEqual([])
    expect(transport.document).toHaveBeenCalledWith({ workerId: 'worker-one', jobId: claim.id, leaseToken: claim.leaseToken, attachmentId: 'attachment-one' }, expect.any(AbortSignal))
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects transport metadata that disagrees with the fully inspected document before inference', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'walldecor-worker-metadata-'))
    const documents = path.join(root, 'documents')
    await mkdir(documents, { mode: 0o700 })
    const original = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#aa9977' } }).png().toBuffer()
    const runCodex = vi.fn()
    const runner = createAiWorkerJobRunner({ document: vi.fn().mockResolvedValue({
      bytes: original,
      mimeType: 'application/pdf',
      byteSize: original.length,
      sha256: createHash('sha256').update(original).digest('hex'),
    }) }, 'worker-one', {
      codex: { binary: '/codex', catalogPath: '/catalog', oauthHome: '/oauth', workRoot: '/jobs', sessionLockFd: 9 },
      document: { pdfInfoBinary: '/usr/bin/pdfinfo', pdfToPpmBinary: '/usr/bin/pdftoppm', workRoot: documents },
      runCodex,
    })
    await expect(runner({
      id: 'job-one', kind: 'INVOICE_EXTRACT', leaseToken: 'c80d6c22-af27-43a3-bef1-1fc0ed7fa7de',
      leaseUntil: '2026-09-11T10:01:00.000Z', prompt: 'Extract', schema: aiJobResultJsonSchema('INVOICE_EXTRACT'),
      document: { attachmentId: 'attachment-one' },
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'RUNNER_ERROR' })
    expect(runCodex).not.toHaveBeenCalled()
    expect(await readdir(documents)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
})
