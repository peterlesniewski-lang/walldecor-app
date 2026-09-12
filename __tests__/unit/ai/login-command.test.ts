// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(!process.env.CODEX_VALIDATION_BINARY)('the actual pinned CLI accepts every login argument without starting authentication', async () => {
  const binary = process.env.CODEX_VALIDATION_BINARY!
  const entrypoint = await readFile('worker/ai/entrypoint.sh', 'utf8')
  const command = entrypoint.match(/\/usr\/local\/bin\/codex\s+([\s\S]*?)\n\s*;;/)?.[1]
  expect(command).toBeDefined()
  // This literal command is deliberately limited to bare and single-quoted
  // tokens. Never evaluate shell text or expand a user's environment/config.
  const args = [...command!.replace(/\\\n/g, ' ').matchAll(/'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2])
  expect(args).toContain('login')
  expect(args).toContain('--device-auth')
  expect(args).toContain('forced_login_method="chatgpt"')
  expect(args).toContain('cli_auth_credentials_store="file"')
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-login-help-'))
  try {
    const env = { PATH: process.env.PATH, HOME: directory, CODEX_HOME: directory }
    const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8', timeout: 10_000 })
    expect(version.stdout.trim()).toBe('codex-cli 0.153.4')
    const help = spawnSync(binary, [...args, '--help'], { env, encoding: 'utf8', timeout: 10_000 })
    expect(help.status, help.stderr).toBe(0)
    expect(help.stdout).toContain('Manage login')
    expect(help.stdout).toContain('--device-auth')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
