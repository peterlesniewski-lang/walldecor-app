export function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]/g, '')
}

export function normalizeEmailLocalPart(email: string) {
  return normalizeUsername(email.split('@')[0] ?? '')
}

export function isStrongPassword(value: string) {
  return (
    value.length >= 10 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  )
}
