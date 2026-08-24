import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const path = (...segments: string[]) => join(root, ...segments)

function source(relativePath: string): string {
  return readFileSync(path(relativePath), 'utf8')
}

describe('installation calendar worker deployment contract', () => {
  it('packages a bounded worker command and its runtime files without changing the web entrypoint', () => {
    const workerPath = path('scripts', 'run-installation-calendar-worker.ts')
    const runbookPath = path('docs', 'runbooks', 'installation-google-calendar.md')

    expect(existsSync(workerPath)).toBe(true)
    expect(existsSync(runbookPath)).toBe(true)

    const packageJson = JSON.parse(source('package.json')) as { scripts: Record<string, string> }
    const dockerfile = source('Dockerfile')
    const worker = source('scripts/run-installation-calendar-worker.ts')
    const runbook = source('docs/runbooks/installation-google-calendar.md')

    expect(packageJson.scripts['worker:installation-calendar']).toContain('run-installation-calendar-worker.ts')
    expect(packageJson.scripts['worker:installation-calendar']).toContain('--import tsx')

    expect(dockerfile).toContain('scripts/run-installation-calendar-worker.ts')
    expect(dockerfile).toContain('src/lib/installations')
    expect(dockerfile).toContain('src/lib/prisma.ts')
    expect(dockerfile).toContain('ENTRYPOINT ["./docker-entrypoint.sh"]')
    expect(dockerfile).not.toContain('worker:installation-calendar &')

    expect(worker).toContain('createInstallationCalendarAdapter')
    expect(worker).toContain('processInstallationCalendarBatch')
    expect(worker).toContain('config.batchSize')
    expect(worker).toContain('finally')
    expect(worker).toContain('prisma.$disconnect()')
    expect(worker).toContain('result.attention > 0 ? 2 : 0')
    expect(worker).toContain("JSON.stringify({ claimed: result.claimed, completed: result.completed, retried: result.retried, attention: result.attention })")
    expect(worker).not.toContain('event.description')
    expect(worker).not.toContain('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64')

    expect(runbook).toContain('INSTALLATION_CALENDAR_ENABLED=true')
    expect(runbook).toContain('adapter fake jest zabroniony w produkcji')
    expect(runbook).toContain('npm run worker:installation-calendar')
    expect(runbook).toContain('co minutę')
    expect(runbook).toContain('WallDecor-App')
    expect(runbook).toContain('* * * * *')
    expect(runbook).toContain('Timeout: 2400 s')
    expect(runbook).toContain('działającym kontenerze aplikacji')
    expect(runbook).toContain('Nie dodawaj drugiego wolumenu ani osobnych zmiennych')
    expect(runbook).toContain('batchSize × 2 × 45 s + margines')
  })
})
