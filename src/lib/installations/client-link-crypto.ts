import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export class ClientLinkEncryptionConfigurationError extends Error {
  constructor() { super('Szyfrowanie linków klienta nie jest skonfigurowane.'); this.name = 'ClientLinkEncryptionConfigurationError' }
}
export class ClientLinkDecryptionError extends Error {
  constructor() { super('Nie można odczytać zapisanego adresu linku klienta.'); this.name = 'ClientLinkDecryptionError' }
}
type Context = { orderId: string; tokenHash: string }
function key() {
  const encoded = process.env.INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY ?? ''
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) throw new ClientLinkEncryptionConfigurationError()
  return decoded
}
function aad(context: Context) { return Buffer.from(JSON.stringify(['installation-client-link', 'v1', context.orderId, context.tokenHash])) }
function validToken(token: string, context: Context) {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && createHash('sha256').update(token).digest('hex') === context.tokenHash
}
export function encryptClientLinkToken(token: string, context: Context): string {
  const encryptionKey = key()
  if (!validToken(token, context)) throw new ClientLinkDecryptionError()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(aad(context))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}
export function decryptClientLinkToken(encrypted: string, context: Context): string {
  const encryptionKey = key()
  try {
    const parts = encrypted.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error()
    const [iv, tag, ciphertext] = parts.slice(1).map((part) => {
      const value = Buffer.from(part, 'base64url')
      if (value.toString('base64url') !== part) throw new Error()
      return value
    })
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length !== 43) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAAD(aad(context))
    decipher.setAuthTag(tag)
    const token = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    if (!validToken(token, context)) throw new Error()
    return token
  } catch { throw new ClientLinkDecryptionError() }
}
