/** Pin and re-prove this policy on every CLI upgrade, including the actual Linux build. */
export const CODEX_VERSION = '0.153.4'
export const CODEX_MODEL = 'gpt-5.6-luna'

const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'shell_snapshot', 'hooks', 'apps', 'plugins', 'remote_plugin', 'recommended_plugins',
  'multi_agent', 'multi_agent_v2', 'memories', 'goals', 'code_mode', 'code_mode_only', 'code_mode_host',
  'view_image', 'image_generation', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use',
  'workspace_dependencies', 'skill_mcp_dependency_install', 'skill_search', 'tool_suggest', 'request_permissions_tool',
  'context_management', 'deferred_executor', 'standalone_web_search', 'token_budget', 'sleep_tool',
  'auth_elicitation', 'secret_auth_storage', 'unbounded_connection_retries',
] as const

export function buildCodexArguments(input: { workspace: string; catalogPath: string; schemaPath: string; statePath?: string; instructionsPath?: string; images?: string[] }) {
  const overrides = [
    'approval_policy="never"', 'model_reasoning_effort="low"', 'web_search="disabled"',
    'forced_login_method="chatgpt"', 'cli_auth_credentials_store="file"',
    'history.persistence="none"', 'memories.generate_memories=false', 'memories.use_memories=false',
    'agents.enabled=false', 'orchestrator.mcp.enabled=false', 'orchestrator.skills.enabled=false',
    'skills.include_instructions=false', 'skills.bundled.enabled=false', 'project_doc_max_bytes=0',
    'tools.update_plan.enabled=false', 'tools.experimental_request_user_input.enabled=false',
    'shell_environment_policy.inherit="none"', 'allow_login_shell=false',
    'analytics.enabled=false', 'feedback.enabled=false', 'check_for_update_on_startup=false',
    'include_environment_context=false', 'include_permissions_instructions=false',
    'suppress_unstable_features_warning=true', 'features.skip_host_skill_discovery=true',
    ...DISABLED_FEATURES.map((feature) => `features.${feature}=false`),
    `model_catalog_json=${JSON.stringify(input.catalogPath)}`,
    `log_dir=${JSON.stringify(input.statePath ?? input.workspace)}`,
    ...(input.instructionsPath ? [`model_instructions_file=${JSON.stringify(input.instructionsPath)}`] : []),
  ]
  return [
    'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--strict-config', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--model', CODEX_MODEL, '--cd', input.workspace, '--json', '--color', 'never',
    '--output-schema', input.schemaPath,
    ...overrides.flatMap((value) => ['-c', value]),
    ...(input.images ?? []).flatMap((image) => ['--image', image]),
    '--', '-',
  ]
}

/** Do not spread process.env: it contains the queue credential and, in the app, database secrets. */
export function buildCodexEnvironment(oauthHome: string, jobState: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: jobState, CODEX_HOME: oauthHome,
    CODEX_SQLITE_HOME: jobState, TMPDIR: jobState, LANG: 'C.UTF-8', NO_COLOR: '1', NODE_ENV: 'production',
  }
}

type ModelCatalog = { models: Array<Record<string, unknown>> }

/** CLI 0.153.4's bundled Luna catalog otherwise enables apply_patch despite disabled shell flags. */
export function hardenModelCatalog(source: unknown): ModelCatalog {
  if (!source || typeof source !== 'object' || !('models' in source) || !Array.isArray(source.models)) throw new Error('INVALID_MODEL_CATALOG')
  const model: unknown = source.models.find((entry: unknown) => !!entry && typeof entry === 'object' && 'slug' in entry && entry.slug === CODEX_MODEL)
  if (!model || typeof model !== 'object') throw new Error('MODEL_UNAVAILABLE')
  return { models: [{
    ...model,
    slug: CODEX_MODEL,
    tool_mode: 'native', apply_patch_tool_type: null, node_repl_disabled: true,
    experimental_supported_tools: [],
    include_skills_usage_instructions: false, include_apps_usage_instructions: false, include_plugin_usage_instructions: false,
  }] }
}

export type CodexFailureCode = 'AUTH' | 'QUOTA' | 'MODEL_UNAVAILABLE' | 'RUNNER_ERROR' | 'INVALID_RESULT' | 'TIMEOUT'
export class CodexRunError extends Error {
  constructor(readonly code: CodexFailureCode) { super(code); this.name = 'CodexRunError' }
}

/** Raw CLI messages may contain request data. Only the controlled code escapes the runner. */
function failureCode(message: string): CodexFailureCode {
  if (/unsupported.*(?:tool|call)|tool.*(?:invocation|execution)/i.test(message)) return 'RUNNER_ERROR'
  if (/usage.limit|quota|rate.limit|too many requests|\b429\b/i.test(message)) return 'QUOTA'
  if (/log.?in|authentication|unauthori[sz]ed|invalid.*token|expired.*token|\b401\b/i.test(message)) return 'AUTH'
  if (/model.*(?:not supported|not found|unavailable|does not exist|no access)/i.test(message)) return 'MODEL_UNAVAILABLE'
  return 'RUNNER_ERROR'
}

export function parseCodexResponse(stdout: string, stderr: string, exitCode: number | null): unknown {
  let completed = false
  const messages: string[] = []
  const failures: string[] = []
  for (const line of stdout.split('\n').filter((entry) => entry.trim())) {
    let event: unknown
    try { event = JSON.parse(line) } catch { throw new CodexRunError('INVALID_RESULT') }
    if (!event || typeof event !== 'object' || !('type' in event)) throw new CodexRunError('INVALID_RESULT')
    if (event.type === 'turn.completed') { completed = true; continue }
    if (event.type === 'thread.started' || event.type === 'turn.started') continue
    if (event.type === 'error' || event.type === 'turn.failed') { failures.push(JSON.stringify(event)); continue }
    if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
      const item = 'item' in event ? event.item : null
      if (!item || typeof item !== 'object' || !('type' in item)) throw new CodexRunError('INVALID_RESULT')
      if (item.type === 'error') { failures.push(JSON.stringify(item)); continue }
      if (item.type === 'reasoning') continue
      // A tool event is a policy violation, never just an ignorable diagnostic.
      if (item.type !== 'agent_message') throw new CodexRunError('RUNNER_ERROR')
      if (event.type === 'item.completed' && 'text' in item && typeof item.text === 'string') messages.push(item.text)
      continue
    }
    throw new CodexRunError('RUNNER_ERROR')
  }
  // CLI 0.153.4 reports HTTP/auth errors in JSONL with exit 1 and no stderr.
  // Inspect every event first so an attempted tool still takes precedence.
  // Never classify normal model answer text or accept a nonzero process exit.
  if (exitCode !== 0 || stderr.trim() || failures.length) throw new CodexRunError(failureCode([stderr, ...failures].join('\n')))
  if (!completed || messages.length !== 1) throw new CodexRunError('INVALID_RESULT')
  try { return JSON.parse(messages[0]) } catch { throw new CodexRunError('INVALID_RESULT') }
}
