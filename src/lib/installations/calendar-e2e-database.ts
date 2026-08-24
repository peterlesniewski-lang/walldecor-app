import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import type { CalendarEnvironment } from './calendar-config'

const E2E_PARENT_ROOT = '/tmp'
const E2E_PARENT_PREFIX = 'walldecor-installations-e2e-'
const SQLITE_FILE_NAME = 'calendar.db'

export type ValidatedInstallationCalendarE2eDatabase = {
  databasePath: string
  directoryPath: string
  databaseUrl: string
}

/**
 * Resolve the intentionally narrow SQLite boundary used by direct-import E2E
 * tests. The private parent prevents another local user from swapping the DB
 * after validation; the URL grammar excludes SQLite URI parameters.
 */
export function validateInstallationCalendarE2eDatabase(
  env: CalendarEnvironment,
): ValidatedInstallationCalendarE2eDatabase | null {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl || databaseUrl !== env.E2E_DATABASE_URL) return null
  if (!databaseUrl.startsWith('file:') || databaseUrl.includes('?') || databaseUrl.includes('#')) return null

  const databasePath = databaseUrl.slice('file:'.length)
  if (databasePath !== path.resolve(databasePath) || path.basename(databasePath) !== SQLITE_FILE_NAME) return null

  const directoryPath = path.dirname(databasePath)
  if (path.dirname(directoryPath) !== E2E_PARENT_ROOT) return null
  const directoryName = path.basename(directoryPath)
  if (!directoryName.startsWith(E2E_PARENT_PREFIX) || directoryName.length === E2E_PARENT_PREFIX.length) return null

  try {
    const directory = lstatSync(directoryPath)
    if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o077) !== 0) return null
    if (typeof process.getuid === 'function' && directory.uid !== process.getuid()) return null

    if (existsSync(databasePath)) {
      const database = lstatSync(databasePath)
      if (database.isSymbolicLink() || !database.isFile()) return null
    }
  } catch {
    return null
  }

  return { databasePath, directoryPath, databaseUrl }
}
