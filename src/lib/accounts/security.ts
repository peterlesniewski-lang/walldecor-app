import { randomInt } from 'crypto'

export { isStrongPassword, normalizeEmailLocalPart, normalizeUsername } from './policy'

const TEMP_PASSWORD_LENGTH = 12
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%+=?'
const ALL = `${LOWER}${UPPER}${DIGITS}${SYMBOLS}`

function pick(chars: string) {
  return chars[randomInt(0, chars.length)]
}

export function generateTemporaryPassword() {
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  const rest = Array.from({ length: TEMP_PASSWORD_LENGTH - required.length }, () => pick(ALL))
  const chars = [...required, ...rest]

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
