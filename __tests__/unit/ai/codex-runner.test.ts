// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, chmod, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiJobResultJsonSchema } from '@/lib/ai/contracts'
import { CODEX_VERSION } from '@/lib/ai/codex-policy'
import { runCodexJob } from '@/lib/ai/codex-runner'

let directory: string
let workRoot: string
let oauthHome: string
const catalogPath = path.join(process.cwd(), 'worker/ai/catalog.json')
const success = [
  { type: 'thread.started', thread_id: 'fixture' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: '{"answer":"Poprawny wynik"}' } },
  { type: 'turn.completed' },
].map((event) => JSON.stringify(event)).join('\n')

async function fakeBinary(options: { version?: string; stdout?: string; stderr?: string; hang?: boolean; overflow?: boolean } = {}) {
  const binary = path.join(directory, 'fixture-codex')
  const auditPath = path.join(directory, 'audit.json')
  const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const options = ${JSON.stringify(options)};
if (process.argv.includes('--version')) {
  process.stdout.write('codex-cli ' + (options.version || ${JSON.stringify(CODEX_VERSION)}) + '\\n');
  process.exit(0);
}
const args = process.argv.slice(2);
const schemaPath = args[args.indexOf('--output-schema') + 1];
const images = args.flatMap((v, i) => v === '--image' ? [args[i + 1]] : []);
const audit = { pid: process.pid, args, env: process.env, cwd: process.cwd(), workspaceFiles: fs.readdirSync(process.cwd()), schema: JSON.parse(fs.readFileSync(schemaPath, 'utf8')), images };
try { const lock = fs.fstatSync(3); audit.lockInode = String(lock.ino); } catch {}
let prompt = '';
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  audit.prompt = prompt;
  if (options.hang) {
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
    audit.childPid = child.pid;
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  }
  fs.writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify(audit));
  if (options.overflow) { process.stdout.write('x'.repeat(2 * 1024 * 1024)); return; }
  if (!options.hang) {
    process.stdout.write(options.stdout === undefined ? ${JSON.stringify(success)} : options.stdout);
    process.stderr.write(options.stderr || '');
  }
});
`
  await writeFile(binary, script, { mode: 0o700 })
  await chmod(binary, 0o700)
  return { binary, auditPath }
}

function input() {
  return { kind: 'FINANCE_CHAT' as const, prompt: 'Tylko dane: SECRET_TEST_PROMPT', schema: aiJobResultJsonSchema('FINANCE_CHAT') }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'walldecor-codex-runner-test-'))
  workRoot = path.join(directory, 'work')
  oauthHome = path.join(directory, 'oauth')
  await mkdir(workRoot)
  await mkdir(oauthHome, { mode: 0o700 })
  // An unrelated sentinel, never an auth file. Production runner must preserve it.
  await writeFile(path.join(oauthHome, 'test-sentinel'), 'PRESERVE')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('isolated Codex process runner', () => {
  it('uses only clean environment, stdin prompt, pinned flags and a fresh empty workspace; cleans only its own generated directory', async () => {
    const { binary, auditPath } = await fakeBinary()
    vi.stubEnv('DATABASE_URL', 'DO_NOT_INHERIT')
    vi.stubEnv('AI_WORKER_SECRET', 'DO_NOT_INHERIT')
    vi.stubEnv('OPENAI_API_KEY', 'DO_NOT_INHERIT')
    await writeFile(path.join(workRoot, 'unrelated'), 'PRESERVE')
    expect(await runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).toEqual({ answer: 'Poprawny wynik' })
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    expect(audit.prompt).toBe(input().prompt)
    expect(audit.args).not.toContain(input().prompt)
    expect(audit.args).toContain('gpt-5.6-luna')
    expect(audit.args).toContain('model_reasoning_effort="low"')
    expect(audit.args.join(' ')).not.toContain('model_provider')
    expect(audit.args.slice(-2)).toEqual(['--', '-'])
    expect(audit.schema).toEqual(input().schema)
    expect(audit.workspaceFiles).toEqual([])
    expect(audit.env.CODEX_HOME).toBe(await realpath(oauthHome))
    expect(audit.env.HOME).toBe(audit.env.CODEX_SQLITE_HOME)
    expect(audit.env.DATABASE_URL).toBeUndefined()
    expect(audit.env.AI_WORKER_SECRET).toBeUndefined()
    expect(audit.env.OPENAI_API_KEY).toBeUndefined()
    expect(await readdir(workRoot)).toEqual(['unrelated'])
    expect(await readdir(oauthHome)).toEqual(['test-sentinel'])
  })

  it('rejects a different binary version or a modified model catalog without a fallback', async () => {
    const { binary, auditPath } = await fakeBinary({ version: '0.153.5' })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'RUNNER_ERROR', message: 'RUNNER_ERROR' })
    await expect(readFile(auditPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await fakeBinary()
    const tampered = path.join(directory, 'tampered.json')
    await writeFile(tampered, (await readFile(catalogPath, 'utf8')).replace('"tool_mode": "native"', '"tool_mode": "code_mode_only"'))
    await expect(runCodexJob(input(), { binary, catalogPath: tampered, oauthHome, workRoot })).rejects.toMatchObject({ code: 'RUNNER_ERROR' })
    await expect(readFile(auditPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('retains the operator session-lock descriptor in the CLI for supervisor-crash safety', async () => {
    const { binary, auditPath } = await fakeBinary()
    const lock = await open(path.join(directory, 'session.lock'), 'wx', 0o600)
    try {
      const lockInode = String((await lock.stat()).ino)
      await runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot, sessionLockFd: lock.fd })
      expect(JSON.parse(await readFile(auditPath, 'utf8')).lockInode).toBe(lockInode)
    } finally { await lock.close() }
  })

  it('fully decodes and privately normalizes every image before giving its path to the CLI', async () => {
    const { binary, auditPath } = await fakeBinary()
    const imagePath = path.join(directory, 'fixture.png')
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toFile(imagePath)
    expect(await runCodexJob({ ...input(), imagePaths: [imagePath] }, { binary, catalogPath, oauthHome, workRoot })).toEqual({ answer: 'Poprawny wynik' })
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    expect(audit.images).toHaveLength(1)
    expect(audit.images[0]).not.toBe(imagePath)
    expect(audit.images[0]).toContain(path.join(workRoot, 'ai-job-'))
    expect(await readFile(imagePath)).not.toHaveLength(0)
    const bad = path.join(directory, 'corrupt.png')
    await writeFile(bad, Buffer.from('89504e470d0a1a0a', 'hex'))
    await expect(runCodexJob({ ...input(), imagePaths: [bad] }, { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('does not permit an alternate output schema, provider or caller-defined launch flags', async () => {
    const { binary, auditPath } = await fakeBinary()
    await expect(runCodexJob({ ...input(), schema: { type: 'object' } }, { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    await expect(readFile(auditPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses invoice extraction without a decoded page image', async () => {
    const { binary, auditPath } = await fakeBinary()
    await expect(runCodexJob({ kind: 'INVOICE_EXTRACT', prompt: 'Invoice', schema: aiJobResultJsonSchema('INVOICE_EXTRACT') }, { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    await expect(readFile(auditPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects tool denials and unknown stderr even with exit zero, without exposing raw output', async () => {
    const { binary } = await fakeBinary({ stderr: 'unsupported custom tool call: apply_patch SECRET_RAW_ERROR' })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'RUNNER_ERROR', message: 'RUNNER_ERROR' })
    await fakeBinary({ stderr: 'surprising diagnostic SECRET_RAW_ERROR' })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'RUNNER_ERROR', message: 'RUNNER_ERROR' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('validates the final result independently and rejects oversized output', async () => {
    const { binary } = await fakeBinary({ stdout: success.replace('Poprawny wynik', '').replace('{\\"answer\\":\\"\\"}', '{\\"answer\\":\\"\\",\\"command\\":\\"unsafe\\"}') })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    await fakeBinary({ overflow: true })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot })).rejects.toMatchObject({ code: 'RUNNER_ERROR' })
    expect(await readdir(workRoot)).toEqual([])
  })

  it('kills the process group and waits for pipe closure before timeout cleanup', async () => {
    const { binary, auditPath } = await fakeBinary({ hang: true })
    await expect(runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot, timeoutMs: 1_500 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    expect(() => process.kill(audit.pid, 0)).toThrow()
    expect(await readdir(workRoot)).toEqual([])
  })

  it('aborts a running process group without inheriting an AbortSignal secret as its error', async () => {
    const { binary, auditPath } = await fakeBinary({ hang: true })
    const controller = new AbortController()
    const running = runCodexJob(input(), { binary, catalogPath, oauthHome, workRoot, signal: controller.signal })
    const failure = running.then(() => null, (error: unknown) => error)
    await vi.waitFor(async () => expect(JSON.parse(await readFile(auditPath, 'utf8')).pid).toBeGreaterThan(0))
    controller.abort(new Error('SECRET_HEARTBEAT_ERROR'))
    expect(await failure).toMatchObject({ code: 'RUNNER_ERROR', message: 'RUNNER_ERROR' })
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    expect(() => process.kill(audit.pid, 0)).toThrow()
    expect(await readdir(workRoot)).toEqual([])
  })

  it('packages a nonroot, no-port runtime with exact dependencies and a whitelist-only build context', async () => {
    const dockerfile = await readFile(path.join(process.cwd(), 'worker/ai/Dockerfile'), 'utf8').catch(() => '')
    expect(dockerfile).toContain('FROM node:22-bookworm-slim')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).not.toMatch(/EXPOSE|COPY\s+\.\s|prisma|\.env/)
    expect(dockerfile).toContain('scripts/validate-ai-codex.ts')
    const ignore = await readFile(path.join(process.cwd(), 'worker/ai/Dockerfile.dockerignore'), 'utf8')
    expect(ignore.startsWith('**\n')).toBe(true)
    expect(ignore).toContain('!src/lib/ai/codex-runner.ts')
    expect(ignore).not.toContain('!src/lib/ai/queue.ts')
    const runtimePackage = JSON.parse(await readFile(path.join(process.cwd(), 'worker/ai/package.json'), 'utf8'))
    expect(runtimePackage.dependencies).toEqual({ '@openai/codex': '0.153.4', sharp: '0.34.5', tsx: '4.21.0', zod: '4.3.6' })
  })
})
