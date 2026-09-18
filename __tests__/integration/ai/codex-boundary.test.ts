// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateCodexBoundary } from '../../../scripts/validate-ai-codex'

const binary = process.env.CODEX_VALIDATION_BINARY

describe.skipIf(!binary)('real pinned Codex CLI against loopback-only fake provider (no OAuth)', () => {
  it('sends zero tools plus image/schema and rejects forced tools despite CLI exit zero', async () => {
    const proof = await validateCodexBoundary({ binary: binary!, catalogPath: path.join(process.cwd(), 'worker/ai/catalog.json') })
    expect(proof.passed).toBe(true)
    expect(proof.cases).toHaveLength(4)
    for (const result of proof.cases) {
      expect(result).toMatchObject({ passed: true, authorizationPresent: false, markerExists: false, cliExitCode: 0, model: 'gpt-5.6-luna', effort: 'low', tools: [] })
      expect(result.imageCount).toBeGreaterThan(0)
      expect(result.strictSchema).toBe(true)
      expect(result.wrapperOutcome).toBe(result.mode === 'inspect' ? 'SUCCEEDED' : 'RUNNER_ERROR')
    }
  }, 60_000)
})
