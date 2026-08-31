const DEFAULT_INSTALLATION_PUBLIC_ORIGIN = 'https://app.walldecor.pl'

function isInternalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '0.0.0.0' || normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('127.') || normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true
  const match = /^172\.(\d{1,3})\./.exec(normalized)
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false
}

function parsedOrigin(value: string | undefined, options: { allowHttp: boolean; allowInternal: boolean }): string | null {
  if (!value?.trim()) return null
  try {
    const parsed = new URL(value.trim())
    const validProtocol = parsed.protocol === 'https:' || (options.allowHttp && parsed.protocol === 'http:')
    if (!validProtocol || parsed.username || parsed.password || !parsed.hostname) return null
    if (!options.allowInternal && isInternalHostname(parsed.hostname)) return null
    return parsed.origin
  } catch {
    return null
  }
}

export function installationPublicOrigin(requestOrigin?: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return parsedOrigin(requestOrigin, { allowHttp: true, allowInternal: true })
      ?? parsedOrigin(process.env.NEXTAUTH_URL, { allowHttp: true, allowInternal: true })
      ?? DEFAULT_INSTALLATION_PUBLIC_ORIGIN
  }

  return parsedOrigin(process.env.NEXTAUTH_URL, { allowHttp: false, allowInternal: false })
    ?? DEFAULT_INSTALLATION_PUBLIC_ORIGIN
}

export function installationPublicUrl(pathname: string, requestOrigin?: string): string {
  return new URL(pathname, installationPublicOrigin(requestOrigin)).toString()
}
