// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { inspectCodexRequestBodies } from '../../../scripts/validate-ai-codex'

const command = { type: 'function', name: 'exec_command', parameters: { type: 'object' } }

describe('Codex boundary request inspection fails closed', () => {
  it('injects synthetic provider overrides immediately after exec without changing the production argv tail', async () => {
    const source = await readFile(new URL('../../../scripts/validate-ai-codex.ts', import.meta.url), 'utf8')
    expect(source).toContain("if (args[0] !== 'exec') throw new Error('SYNTHETIC_EXEC_REQUIRED');")
    expect(source).toContain('args.splice(1, 0, ...')
    expect(source).not.toContain('args.splice(args.length - 1')
  })

  it('detects additional_tools on a tool_search_output even when top-level tools is empty', () => {
    const proof = inspectCodexRequestBodies([{ tools: [], input: [{ type: 'tool_search_output', additional_tools: [command] }] }])
    expect(proof.tools).toContainEqual(command)
    expect(proof.zeroTools).toBe(false)
  })

  it('detects tools introduced only in a later outgoing request', () => {
    const proof = inspectCodexRequestBodies([
      { tools: [], input: [{ type: 'message', content: [] }] },
      { tools: [], input: [{ type: 'tool_search_output', additional_tools: [command] }] },
    ])
    expect(proof.zeroTools).toBe(false)
    expect(proof.tools).toContainEqual(command)
  })

  it.each(['tools', 'additional_tools'])('rejects every nonarray %s declaration, including malformed empty values', (key) => {
    for (const value of [null, {}, '', 'exec_command', false, 0, command]) {
      const proof = inspectCodexRequestBodies([{ input: [{ [key]: value }] }])
      expect(proof.validToolDeclarations, `${key}=${JSON.stringify(value)}`).toBe(false)
      expect(proof.zeroTools).toBe(false)
    }
  })

  it('rejects nonempty malformed arrays rather than treating unknown entries as no tools', () => {
    for (const tools of [[null], [{}], ['exec_command'], [false]]) {
      expect(inspectCodexRequestBodies([{ input: [{ additional_tools: tools }] }]).zeroTools).toBe(false)
    }
  })

  it('accepts only absent or genuinely empty tool lists throughout every request', () => {
    expect(inspectCodexRequestBodies([
      { input: [{ type: 'message', content: [] }] },
      { tools: [], input: [{ type: 'tool_search_output', additional_tools: [] }] },
    ])).toEqual({ tools: [], validToolDeclarations: true, zeroTools: true })
  })
})
