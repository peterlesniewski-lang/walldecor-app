import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

type InstallationIpEnvironment = Partial<Pick<NodeJS.ProcessEnv,
  'INSTALLATION_TRUSTED_CLIENT_IP_HEADER' | 'INSTALLATION_IP_HASH_SECRET' | 'NEXTAUTH_SECRET'>>

export class InstallationClientIpConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallationClientIpConfigurationError'
  }
}

function normalizeIp(value: string): string {
  const trimmed = value.trim()
  const version = isIP(trimmed)
  if (version === 0) throw new InstallationClientIpConfigurationError('Skonfigurowany nagłówek klienta nie zawiera jednego poprawnego adresu IP.')
  if (version === 4) return trimmed.split('.').map((part) => String(Number(part))).join('.')
  // URL applies the WHATWG canonical IPv6 compression rules. The brackets
  // belong to URL syntax and are not part of the address passed to the HMAC.
  return new URL(`http://[${trimmed}]/`).hostname.slice(1, -1).toLowerCase()
}

/**
 * Reads only a header that the deployment explicitly promises to strip and
 * overwrite at the trusted proxy. Ordinary XFF/X-Real-IP are ignored by
 * default because a public caller can spoof them.
 */
export function readTrustedClientIp(
  headers: Headers,
  env: InstallationIpEnvironment = process.env,
): string | null {
  const configured = env.INSTALLATION_TRUSTED_CLIENT_IP_HEADER?.trim()
  if (!configured) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,126}$/.test(configured)) {
    throw new InstallationClientIpConfigurationError('INSTALLATION_TRUSTED_CLIENT_IP_HEADER nie jest poprawną nazwą nagłówka HTTP.')
  }
  const value = headers.get(configured)
  if (!value) throw new InstallationClientIpConfigurationError('Brakuje skonfigurowanego nagłówka z adresem klienta.')
  return normalizeIp(value)
}

/** Raw client addresses are never persisted; the version prefix enables a
 * deliberate future key/hash rotation without confusing historic values. */
export function hashTrustedClientIp(
  normalizedIp: string | null,
  env: InstallationIpEnvironment = process.env,
): string | null {
  if (normalizedIp === null) return null
  const secret = env.INSTALLATION_IP_HASH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim()
  if (!secret) {
    throw new InstallationClientIpConfigurationError('Brakuje sekretu HMAC dla metadanych IP klienta.')
  }
  return `hmac-sha256:v1:${createHmac('sha256', secret).update(normalizedIp, 'utf8').digest('hex')}`
}
