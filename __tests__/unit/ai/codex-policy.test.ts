// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildCodexArguments, buildCodexEnvironment, parseCodexResponse, hardenModelCatalog } from '@/lib/ai/codex-policy'

const success = [
  { type: 'thread.started', thread_id: 'test' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: '{"answer":"OK"}' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
].map((line) => JSON.stringify(line)).join('\n')

describe('Codex no-tool execution policy', () => {
  it('pins the requested model and low reasoning without an API provider override', () => {
    const args = buildCodexArguments({ workspace: '/job/work', catalogPath: '/policy/catalog.json', schemaPath: '/job/schema.json', images: ['/job/work/page-1.png'] })
    expect(args).toContain('gpt-5.6-luna')
    expect(args).toContain('model_reasoning_effort="low"')
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('--ignore-rules')
    expect(args).toContain('features.shell_tool=false')
    expect(args).toContain('features.unified_exec=false')
    expect(args).toContain('web_search="disabled"')
    expect(args.join(' ')).not.toMatch(/model_provider|api_key|dangerously|full-auto/)
  })

  it('terminates greedy image options before the stdin prompt positional', () => {
    const base = { workspace: '/job/work', catalogPath: '/policy/catalog.json', schemaPath: '/job/schema.json' }
    expect(buildCodexArguments(base).slice(-2)).toEqual(['--', '-'])
    expect(buildCodexArguments({ ...base, images: ['/job/work/one.png'] }).slice(-4)).toEqual([
      '--image', '/job/work/one.png', '--', '-',
    ])
    expect(buildCodexArguments({ ...base, images: ['/job/work/one.png', '/job/work/two.png'] }).slice(-6)).toEqual([
      '--image', '/job/work/one.png', '--image', '/job/work/two.png', '--', '-',
    ])
  })

  it('uses an explicit environment allowlist with ephemeral per-job runtime state', () => {
    const env = buildCodexEnvironment('/private/oauth', '/job/state')
    expect(env).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/job/state', CODEX_HOME: '/private/oauth',
      CODEX_SQLITE_HOME: '/job/state', TMPDIR: '/job/state', LANG: 'C.UTF-8', NO_COLOR: '1', NODE_ENV: 'production',
    })
    expect(Object.keys(env)).not.toContain('OPENAI_API_KEY')
    expect(Object.keys(env)).not.toContain('AI_WORKER_SECRET')
  })

  it('removes tool metadata without silently changing the requested model or mutating its source', () => {
    const source = { models: [{ slug: 'gpt-5.6-luna', tool_mode: 'code_mode_only', apply_patch_tool_type: 'freeform', experimental_supported_tools: ['read_file'] }, { slug: 'other' }] }
    const hardened = hardenModelCatalog(source)
    expect(hardened.models).toHaveLength(1)
    expect(hardened.models[0]).toMatchObject({ slug: 'gpt-5.6-luna', tool_mode: 'native', apply_patch_tool_type: null, node_repl_disabled: true, experimental_supported_tools: [] })
    expect(source.models[0].apply_patch_tool_type).toBe('freeform')
    expect(() => hardenModelCatalog({ models: [{ slug: 'other' }] })).toThrow()
  })

  it('accepts only a completed run with exactly one valid JSON final answer', () => {
    expect(parseCodexResponse(success, '', 0)).toEqual({ answer: 'OK' })
    expect(() => parseCodexResponse(success.replace('turn.completed', 'turn.failed'), '', 0)).toThrow()
    expect(() => parseCodexResponse(success, '', 1)).toThrow()
    expect(() => parseCodexResponse(success.replace('{\\"answer\\":\\"OK\\"}', 'not JSON'), '', 0)).toThrow()
  })

  it('rejects the implicit stdin notice instead of allowing nonempty stderr', () => {
    expect(() => parseCodexResponse(success, 'Reading prompt from stdin...\n', 0)).toThrowError('RUNNER_ERROR')
  })

  it('rejects attempted tools even when Codex exits zero and emits a final answer afterwards', () => {
    for (const stderr of ['unsupported call: exec_command', 'unsupported custom tool call: apply_patch', 'unsupported custom tool call: exec']) {
      expect(() => parseCodexResponse(success, stderr, 0)).toThrow()
    }
    const tool = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'touch marker' } })
    expect(() => parseCodexResponse(`${tool}\n${success}`, '', 0)).toThrow()
    const unknown = JSON.stringify({ type: 'future.event' })
    expect(() => parseCodexResponse(`${unknown}\n${success}`, '', 0)).toThrowError('RUNNER_ERROR')
  })

  it('maps authentication and quota failures to controlled error codes, never raw messages', () => {
    for (const [message, code] of [['Please login to ChatGPT token-secret', 'AUTH'], ['usage limit reached token-secret', 'QUOTA'], ['model gpt-5.6-luna is not supported token-secret', 'MODEL_UNAVAILABLE']]) {
      expect(() => parseCodexResponse('', message, 1)).toThrow()
      try { parseCodexResponse('', message, 1) } catch (error) {
        expect(error).toMatchObject({ code })
        expect((error as Error).message).not.toContain('token-secret')
      }
    }
  })

  it.each([
    ['exceeded retry limit, last status: 429 Too Many Requests', 'QUOTA'],
    ['Authentication token expired: 401 Unauthorized', 'AUTH'],
    ['model gpt-5.6-luna is not supported', 'MODEL_UNAVAILABLE'],
  ])('classifies a nonzero CLI exit with JSONL error and empty stderr: %s', (message, code) => {
    const output = [
      { type: 'error', message: `${message} private-request-data` },
      { type: 'turn.failed', error: { message } },
    ].map((event) => JSON.stringify(event)).join('\n')
    try {
      parseCodexResponse(output, '', 1)
      expect.fail('Nonzero exit must never succeed')
    } catch (error) {
      expect(error).toMatchObject({ code, message: code })
    }
  })

  it('gives a tool policy violation precedence over an earlier quota event', () => {
    const error = JSON.stringify({ type: 'error', message: '429 Too Many Requests' })
    const tool = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'touch marker' } })
    expect(() => parseCodexResponse(`${error}\n${tool}`, '', 1)).toThrowError('RUNNER_ERROR')
  })

  it('does not classify normal assistant content as a provider failure', () => {
    const output = success.replace('OK', '401 Unauthorized; 429 quota')
    expect(() => parseCodexResponse(output, '', 1)).toThrowError('RUNNER_ERROR')
  })
})
