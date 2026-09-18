// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../../scripts/validate-ai-linux-lock.mjs', import.meta.url))
const macHost = 'unix:///Users/piotr/.docker/run/docker.sock'
const linuxHost = 'unix:///var/run/docker.sock'
const image = 'walldecor-ai:test'
type DockerCall = { args: string[]; host?: string; context?: string; tls?: string; tlsVerify?: string; certPath?: string }

/** Exercise the actual CLI; only the external Docker boundary is substituted.
 * It fails at the first container start, exercising the real cleanup path too. */
async function runGate(args: string[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-lock-cli-test-'))
  const callsFile = path.join(directory, 'docker-calls.jsonl')
  try {
    await writeFile(path.join(directory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GATE_TEST_CALLS, JSON.stringify({ args, host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT, tls: process.env.DOCKER_TLS, tlsVerify: process.env.DOCKER_TLS_VERIFY, certPath: process.env.DOCKER_CERT_PATH }) + '\\n');
const command = args.slice(2);
if (command[0] === 'image') process.stdout.write(JSON.stringify([{ Id: 'sha256:synthetic', Os: 'linux', Config: { User: 'node' } }]));
if (command[0] === 'run') { process.stderr.write('SYNTHETIC_CONTAINER_START_FAILURE'); process.exitCode = 42; }
`, { mode: 0o700 })
    const execution = spawnSync(process.execPath, [script, ...args], {
      cwd: directory, encoding: 'utf8', timeout: 8_000,
      env: {
        PATH: directory, TMPDIR: directory, GATE_TEST_CALLS: callsFile,
        DOCKER_HOST: 'tcp://unintended.invalid:2375', DOCKER_CONTEXT: 'unintended-context',
        DOCKER_TLS: '1', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/unintended-certs',
      },
    })
    let calls: DockerCall[] = []
    try { calls = (await readFile(callsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const summary = execution.stdout.includes('artifactDirectory')
      ? JSON.parse(await readFile(path.join(JSON.parse(execution.stdout).artifactDirectory, 'summary.json'), 'utf8'))
      : undefined
    return { ...execution, calls, summary }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Linux lock gate CLI endpoint selection', () => {
  it.each([
    ['legacy Mac invocation', ['--image', image], macHost],
    ['explicit native Linux endpoint', ['--image', image, '--docker-host', linuxHost], linuxHost],
    ['explicit Mac endpoint', ['--docker-host', macHost, '--image', image], macHost],
  ])('uses one local endpoint for execution and cleanup: %s', async (_label, args, host) => {
    const result = await runGate(args as string[])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.calls.map((call) => call.args[2])).toEqual(['image', 'volume', 'run', 'rm', 'volume'])
    for (const call of result.calls) {
      expect(call).toMatchObject({ args: ['--host', host, ...call.args.slice(2)], host })
      expect(call.context).toBeUndefined()
      expect(call.tls).toBeUndefined()
      expect(call.tlsVerify).toBeUndefined()
      expect(call.certPath).toBeUndefined()
    }
    expect(result.summary).toMatchObject({ passed: false, dockerHost: host, cleanupPassed: true })
  })

  it.each([
    ['no arguments', []],
    ['missing image value', ['--image']],
    ['missing image option', ['--docker-host', linuxHost]],
    ['empty image', ['--image', '']],
    ['invalid image', ['--image', 'image;echo unsafe']],
    ['duplicate image', ['--image', image, '--image', image]],
    ['missing host value', ['--image', image, '--docker-host']],
    ['empty host', ['--image', image, '--docker-host', '']],
    ['TCP host', ['--image', image, '--docker-host', 'tcp://127.0.0.1:2375']],
    ['SSH host', ['--image', image, '--docker-host', 'ssh://example.invalid']],
    ['relative Unix socket', ['--image', image, '--docker-host', 'unix://docker.sock']],
    ['unexpected Unix socket', ['--image', image, '--docker-host', 'unix:///tmp/unapproved.sock']],
    ['host with suffix', ['--image', image, '--docker-host', `${linuxHost}?context=remote`]],
    ['duplicate host', ['--image', image, '--docker-host', linuxHost, '--docker-host', macHost]],
    ['option in place of host', ['--docker-host', '--image', image]],
    ['unknown option', ['--image', image, '--context', 'remote']],
    ['unexpected positional argument', ['--image', image, 'remote']],
  ])('rejects %s before invoking Docker', async (_label, args) => {
    const result = await runGate(args)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('USAGE:')
    expect(result.calls).toEqual([])
    expect(result.summary).toBeUndefined()
  })
})
