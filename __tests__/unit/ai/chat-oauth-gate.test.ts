// @vitest-environment node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { normalizeUsername } from '@/lib/accounts/policy'
import { LoginSchema } from '@/lib/validations/auth'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'

// RED must fail assertions for a missing implementation, not module resolution.
const gate = await import('../../../scripts/validate-ai-chat-oauth.mjs').catch(() => ({}))
const parse = (args: string[]) => 'parseChatOAuthArgs' in gate ? gate.parseChatOAuthArgs(args) : undefined
const assess = (kind: string, result: unknown) => 'assessChatEvidence' in gate ? gate.assessChatEvidence(kind, result) : { passed: false, code: 'GATE_MISSING' }
const fixtureUsernames = (runId: string) => 'chatOAuthFixtureUsernames' in gate ? gate.chatOAuthFixtureUsernames(runId) : undefined
const image = `sha256:${'a'.repeat(64)}`
const validArgs = ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', 'dedicated-ai-owner']
const finance = { year: 2026, month: 8, currency: 'PLN', revenue: 12345, costs: 0, costsConfirmed: false, result: 12345, complete: false, missingChannel: null, yoyAvailable: false }
const wiki = { procedureCode: 'TEST-ALFA', waitingMinutes: 7, packageColour: null }

function wikiArticleFixtureFromGateSource() {
  const source = readFileSync(new URL('../../../scripts/validate-ai-chat-oauth.mjs', import.meta.url), 'utf8')
  const match = source.match(/await db\.article\.create\(\{ data: \{[\s\S]*?title: '([^']+)'[\s\S]*?content: '([^']+)' \} \}\)/)
  if (!match) throw new Error('WIKI_FIXTURE_NOT_FOUND')
  return { title: match[1], content: JSON.parse(`"${match[2].replaceAll('"', '\\"')}"`) as string }
}

describe('explicit real OAuth chat acceptance configuration', () => {
  it('replaces the old hyphenated fixture names with deterministic names unchanged by the real login policy', () => {
    const runId = '1780000000000-a1b2c3d4'
    const oldManager = `gate-manager-${runId}`
    expect(normalizeUsername(oldManager)).not.toBe(oldManager)

    const users = fixtureUsernames(runId)
    expect(users).toEqual({
      admin: 'gateadmin1780000000000a1b2c3d4',
      otheradmin: 'gateotheradmin1780000000000a1b2c3d4',
      manager: 'gatemanager1780000000000a1b2c3d4',
      employee: 'gateemployee1780000000000a1b2c3d4',
    })
    expect(fixtureUsernames(runId)).toEqual(users)
    expect(new Set(Object.values(users ?? {}))).toHaveLength(4)
    for (const username of Object.values(users ?? {})) {
      expect(username).toMatch(/^[a-z0-9]+$/)
      expect(normalizeUsername(username)).toBe(username)
      expect(LoginSchema.parse({ username, password: 'fixture-only' }).username).toBe(username)
    }
  })

  it('keeps fixture usernames disjoint between valid run identifiers', () => {
    const first = Object.values(fixtureUsernames('1780000000000-a1b2c3d4') ?? {})
    const second = Object.values(fixtureUsernames('1780000000001-a1b2c3d4') ?? {})
    expect(new Set([...first, ...second])).toHaveLength(8)
  })

  it.each([
    '', '1780000000000', '1780000000000-A1B2C3D4', '178000000000-a1b2c3d4',
    '1780000000000-a1b2c3d', '1780000000000-a1b2c3d4/escape', null, undefined,
  ])('rejects malformed fixture run identifiers %#', (runId) => {
    expect(() => gate.chatOAuthFixtureUsernames(runId)).toThrowError('INVALID_FIXTURE_RUN_ID')
  })

  it('gives Chromium only fixed process settings and its disposable HOME/TMPDIR, never host secrets', () => {
    vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC-SENTINEL-NOT-A-KEY')
    vi.stubEnv('AI_WORKER_SECRET', 'SYNTHETIC-SENTINEL-NOT-A-SECRET')
    vi.stubEnv('ARBITRARY_HOST_CREDENTIAL', 'SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL')
    try {
      const directory = '/private/tmp/wd-ai-oauth-chat-unit-only'
      const options = 'chatOAuthBrowserLaunchOptions' in gate ? gate.chatOAuthBrowserLaunchOptions(directory) : {}
      expect(options).toEqual({ headless: true, env: {
        PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: directory, TMPDIR: directory,
      } })
    } finally { vi.unstubAllEnvs() }
  })

  it('wires the explicit browser environment into the real chromium launch site', () => {
    const source = readFileSync(new URL('../../../scripts/validate-ai-chat-oauth.mjs', import.meta.url), 'utf8')
    expect(/chromium\.launch\(chatOAuthBrowserLaunchOptions\(directory\)\)/.test(source)).toBe(true)
  })

  it('requires deliberate opt-in, immutable local image and explicit named OAuth volume', () => {
    expect(parse(validArgs)).toEqual({ image, oauthVolume: 'dedicated-ai-owner' })
  })

  it.each([
    validArgs.slice(1), [], ['--confirm-synthetic-oauth'],
    [...validArgs, '--model', 'something'], [...validArgs, '--provider', 'fixture'],
    [...validArgs, '--bind', '0.0.0.0'], [...validArgs, '--confirm-synthetic-oauth'],
    [...validArgs, '--image', image],
    ['--confirm-synthetic-oauth', '--image', 'latest', '--oauth-volume', 'dedicated-ai-owner'],
    ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', '/Users/piotr/.codex'],
    ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', 'volume,dst=/elsewhere'],
    ['--confirm-synthetic-oauth', '--image', image, '--oauth-volume', ''],
  ])('rejects missing, ambiguous, expanded or unsafe configuration %#', (...args) => {
    expect(() => parse(args)).toThrow()
  })

  it('does not allow inherited process environment to supply implicit options', () => {
    expect(() => parse(['--confirm-synthetic-oauth', '--image', image])).toThrow()
  })

  it('constructs a pinned worker with only a named OAuth volume, private noexec tmpfs and fixed hardening', () => {
    const args = 'chatOAuthWorkerArgs' in gate ? gate.chatOAuthWorkerArgs({ image, oauthVolume: 'dedicated-ai-owner' }, 'wd-ai-oauth-chat-test') : []
    expect(args).toContain('--read-only')
    expect(args).toContain('1000:1000')
    expect(args).toContain('no-new-privileges')
    expect(args).toContain('/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728')
    expect(args).toContain('type=volume,src=dedicated-ai-owner,dst=/oauth')
    expect(args.filter((arg: string) => arg === '--mount')).toHaveLength(1)
    expect(args.at(-2)).toBe(image)
    expect(args.at(-1)).toBe('worker')
    expect(args.join(' ')).not.toMatch(/type=bind|--privileged|--publish|--entrypoint|--network host|--restart/)
    expect(args).toContain('AI_WORKER_SECRET')
    expect(args.some((arg: string) => arg.startsWith('AI_WORKER_SECRET='))).toBe(false)
  })
})

describe('substantive synthetic answers, not merely successful status', () => {
  it('renders the exact synthetic wiki title as one page heading', () => {
    const fixture = wikiArticleFixtureFromGateSource()
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement('h1', null, fixture.title),
      createElement(ArticleViewer, { content: fixture.content }),
    ))
    const exactHeadings = html.match(/<h1>Fikcyjna procedura TEST-ALFA<\/h1>/g) ?? []

    expect(fixture.content).toContain('TEST-ALFA')
    expect(fixture.content).toContain('7 minut')
    expect(fixture.content).toContain('Nie podano koloru opakowania')
    expect(exactHeadings).toHaveLength(1)
  })

  it('loads the real production chat-result schema through native Node module interop', () => {
    const gateUrl = new URL('../../../scripts/validate-ai-chat-oauth.mjs', import.meta.url).href
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
      const { loadChatResultSchema } = await import(${JSON.stringify(gateUrl)})
      const schema = await loadChatResultSchema()
      process.stdout.write(JSON.stringify({
        acceptsValid: schema.safeParse({ answer: 'fixture answer' }).success,
        rejectsMalformed: !schema.safeParse({ answer: 42 }).success,
      }))
    `], { encoding: 'utf8' })

    expect(child.status).toBe(0)
    expect(child.stderr).toBe('')
    expect(JSON.parse(child.stdout)).toEqual({ acceptsValid: true, rejectsMalformed: true })
  })

  it('matches multiline finance JSON as span text without BR-added whitespace', () => {
    const multiline = JSON.stringify(finance, null, 2)
    const visible = 'visibleChatAnswer' in gate ? gate.visibleChatAnswer('FINANCE_CHAT', multiline) : multiline
    expect(visible).toBe(multiline.split('\n').join(''))
  })

  it('matches rendered wiki JSON when Markdown removes a code fence', () => {
    const answer = `\`\`\`json\n${JSON.stringify(wiki)}\n\`\`\``
    const visible = 'visibleChatAnswer' in gate ? gate.visibleChatAnswer('WIKI_CHAT', answer) : answer
    expect(visible).toBe(JSON.stringify(wiki))
  })

  it('counts earlier wiki answers using the same normalized whitespace as the text locator', () => {
    const multiline = JSON.stringify(wiki, null, 2)
    const oneLine = multiline.replace(/\n/g, ' ')
    const matchKey = (answer: string) => 'chatAnswerMatchKey' in gate ? gate.chatAnswerMatchKey('WIKI_CHAT', answer) : answer
    expect(matchKey(`\`\`\`json\n${multiline}\n\`\`\``)).toBe(matchKey(oneLine))
  })

  it('accepts exact financial values with explicit incompleteness, unknown channel and unavailable comparison', () => {
    expect(assess('FINANCE_CHAT', { answer: JSON.stringify(finance) })).toEqual({ passed: true, checked: finance })
  })

  it('accepts wiki facts and explicit unknown without insisting on exact prose', () => {
    expect(assess('WIKI_CHAT', { answer: `\n\`\`\`json\n${JSON.stringify(wiki, null, 2)}\n\`\`\`\n` })).toEqual({ passed: true, checked: wiki })
  })

  it.each([
    { answer: 'I answered the question successfully.' },
    { answer: JSON.stringify({ ...finance, revenue: 999 }) },
    { answer: JSON.stringify({ ...finance, complete: true }) },
    { answer: JSON.stringify({ ...finance, missingChannel: 0 }) },
    { answer: JSON.stringify({ ...finance, yoyAvailable: true }) },
    { answer: JSON.stringify({ ...finance, costsConfirmed: true }) },
    { answer: JSON.stringify({ ...finance, revenue: '12345' }) },
    { answer: JSON.stringify({ ...finance, hiddenExtra: true }) },
    { answer: JSON.stringify(finance), extra: 'unvalidated provider text' },
    { answer: '' }, null,
  ])('rejects malformed, fabricated, incomplete or overconfident finance evidence %#', (result) => {
    expect(assess('FINANCE_CHAT', result).passed).toBe(false)
  })

  it.each([
    { ...wiki, waitingMinutes: 8 }, { ...wiki, procedureCode: 'ALFA' }, { ...wiki, packageColour: 'blue' },
  ])('rejects wiki substitutions or unsupported facts %#', (result) => {
    expect(assess('WIKI_CHAT', { answer: JSON.stringify(result) }).passed).toBe(false)
  })

  it('rejects kinds outside this chat-only gate', () => {
    expect(assess('INVOICE_EXTRACT', { answer: JSON.stringify(wiki) }).passed).toBe(false)
  })
})
