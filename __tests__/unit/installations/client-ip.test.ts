import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  InstallationClientIpConfigurationError,
  hashTrustedClientIp,
  readTrustedClientIp,
} from '@/lib/installations/client-ip'

describe('trusted installation client IP metadata', () => {
  it('ignores ordinary forwarding headers unless an overwritten proxy header is explicitly configured', () => {
    const headers = new Headers({ 'X-Forwarded-For': '203.0.113.10', 'X-Real-IP': '203.0.113.11' })
    expect(readTrustedClientIp(headers, {})).toBeNull()
  })

  it('accepts one valid configured IP, normalizes it and hashes with a versioned HMAC', () => {
    const headers = new Headers({ 'X-WallDecor-Client-IP': ' 2001:0DB8:0:0:0:0:0:1 ' })
    const env = { INSTALLATION_TRUSTED_CLIENT_IP_HEADER: 'X-WallDecor-Client-IP', INSTALLATION_IP_HASH_SECRET: 'test-only-secret' }
    const ip = readTrustedClientIp(headers, env)

    expect(ip).toBe('2001:db8::1')
    expect(hashTrustedClientIp(ip, env)).toBe(`hmac-sha256:v1:${createHmac('sha256', 'test-only-secret').update('2001:db8::1').digest('hex')}`)
  })

  it.each([
    [{ INSTALLATION_TRUSTED_CLIENT_IP_HEADER: 'bad header name' }, new Headers()],
    [{ INSTALLATION_TRUSTED_CLIENT_IP_HEADER: 'X-WallDecor-Client-IP' }, new Headers({ 'X-WallDecor-Client-IP': '203.0.113.10, 10.0.0.1' })],
    [{ INSTALLATION_TRUSTED_CLIENT_IP_HEADER: 'X-WallDecor-Client-IP' }, new Headers()],
  ])('rejects an invalid configured header or value', (env, headers) => {
    expect(() => readTrustedClientIp(headers, env)).toThrow(InstallationClientIpConfigurationError)
  })
})
