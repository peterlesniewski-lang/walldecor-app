export const activeInstallerEmployeeInvariantMessage = 'active installer user requires active employee'

export const installerEmployeeInvariantConflictMessage =
  'Stan powiązanego pracownika zmienił się podczas zapisu. Odśwież dane i spróbuj ponownie.'

export function isActiveInstallerEmployeeInvariantError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as {
    code?: unknown
    message?: unknown
    meta?: { modelName?: unknown; field_name?: unknown } | unknown
  }
  const details = [value.message, value.meta]
    .map((part) => {
      if (typeof part === 'string') return part
      try {
        return JSON.stringify(part)
      } catch {
        return ''
      }
    })
    .join(' ')
    .toLowerCase()
  if (details.includes(activeInstallerEmployeeInvariantMessage)) return true

  // Prisma maps SQLite RAISE(ABORT, ...) to the generic P2003/User foreign-key
  // shape, so preserve the trigger's conflict semantics at the HTTP boundary.
  const meta = value.meta as { modelName?: unknown; field_name?: unknown } | undefined
  return value.code === 'P2003' && meta?.modelName === 'User' && meta.field_name === 'foreign key'
}
