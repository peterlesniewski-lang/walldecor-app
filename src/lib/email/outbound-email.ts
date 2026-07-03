import net from 'node:net'
import tls from 'node:tls'

export interface OutboundEmail {
  to: string
  subject: string
  text: string
  html?: string
}

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  from: string
  startTls: boolean
}

export function isEmailDeliveryConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY ||
      process.env.SMTP_HOST ||
      process.env.PASSWORD_RESET_EMAIL_MODE === 'console' ||
      process.env.NODE_ENV !== 'production'
  )
}

export async function sendEmail(email: OutboundEmail) {
  if (process.env.RESEND_API_KEY) {
    await sendWithResend(email)
    return
  }

  const smtpConfig = getSmtpConfig()
  if (smtpConfig) {
    await sendWithSmtp(email, smtpConfig)
    return
  }

  if (process.env.PASSWORD_RESET_EMAIL_MODE === 'console' || process.env.NODE_ENV !== 'production') {
    console.info(`[email:console] ${email.to}\n${email.subject}\n${email.text}`)
    return
  }

  throw new Error('Email delivery is not configured')
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  if (!host) return null

  const port = Number(process.env.SMTP_PORT ?? 587)
  const secure = process.env.SMTP_SECURE === 'true' || port === 465

  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM ?? process.env.PASSWORD_RESET_EMAIL_FROM ?? 'no-reply@walldecor.pl',
    startTls: process.env.SMTP_STARTTLS !== 'false' && !secure,
  }
}

async function sendWithResend(email: OutboundEmail) {
  const from = process.env.RESEND_FROM ?? process.env.PASSWORD_RESET_EMAIL_FROM
  if (!from) throw new Error('RESEND_FROM or PASSWORD_RESET_EMAIL_FROM is required')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend email failed: ${response.status} ${body}`.trim())
  }
}

async function sendWithSmtp(email: OutboundEmail, config: SmtpConfig) {
  let socket: net.Socket | tls.TLSSocket = await connectSmtp(config)

  const read = createSmtpReader(socket)
  const write = (line: string) => socket.write(`${line}\r\n`)
  const expect = async (code: number) => {
    const response = await read()
    if (!response.startsWith(String(code))) {
      throw new Error(`SMTP expected ${code}, got ${response}`)
    }
    return response
  }

  await expect(220)
  write('EHLO app.walldecor.pl')
  await expect(250)

  if (config.startTls) {
    write('STARTTLS')
    await expect(220)
    socket = tls.connect({ socket, servername: config.host })
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })
    const tlsRead = createSmtpReader(socket)
    const tlsWrite = (line: string) => socket.write(`${line}\r\n`)
    tlsWrite('EHLO app.walldecor.pl')
    const response = await tlsRead()
    if (!response.startsWith('250')) throw new Error(`SMTP expected 250, got ${response}`)

    await authenticateSmtp(socket, tlsRead, tlsWrite, config)
    await sendSmtpMessage(socket, tlsRead, tlsWrite, email, config.from)
    return
  }

  await authenticateSmtp(socket, read, write, config)
  await sendSmtpMessage(socket, read, write, email, config.from)
}

async function connectSmtp(config: SmtpConfig) {
  const socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port })

  await new Promise<void>((resolve, reject) => {
    socket.once(config.secure ? 'secureConnect' : 'connect', resolve)
    socket.once('error', reject)
  })
  return socket
}

async function authenticateSmtp(
  socket: net.Socket | tls.TLSSocket,
  read: () => Promise<string>,
  write: (line: string) => void,
  config: SmtpConfig
) {
  if (!config.user || !config.password) return

  write('AUTH LOGIN')
  await expectSmtp(read, 334)
  write(Buffer.from(config.user).toString('base64'))
  await expectSmtp(read, 334)
  write(Buffer.from(config.password).toString('base64'))
  await expectSmtp(read, 235)
  socket.setTimeout(30_000)
}

async function sendSmtpMessage(
  socket: net.Socket | tls.TLSSocket,
  read: () => Promise<string>,
  write: (line: string) => void,
  email: OutboundEmail,
  from: string
) {
  write(`MAIL FROM:<${addressOnly(from)}>`)
  await expectSmtp(read, 250)
  write(`RCPT TO:<${addressOnly(email.to)}>`)
  await expectSmtp(read, 250)
  write('DATA')
  await expectSmtp(read, 354)
  socket.write(`${buildMimeMessage(email, from)}\r\n.\r\n`)
  await expectSmtp(read, 250)
  write('QUIT')
  socket.end()
}

async function expectSmtp(read: () => Promise<string>, code: number) {
  const response = await read()
  if (!response.startsWith(String(code))) {
    throw new Error(`SMTP expected ${code}, got ${response}`)
  }
}

function createSmtpReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = ''

  return () =>
    new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split(/\r?\n/)
        const completeIndex = lines.findIndex((line) => /^\d{3} /.test(line))
        if (completeIndex === -1) return

        socket.off('data', onData)
        socket.off('error', onError)
        const responseLines = lines.slice(0, completeIndex + 1)
        buffer = lines.slice(completeIndex + 1).join('\n')
        resolve(responseLines.join('\n'))
      }
      const onError = (error: Error) => {
        socket.off('data', onData)
        reject(error)
      }
      socket.on('data', onData)
      socket.once('error', onError)
    })
}

function buildMimeMessage(email: OutboundEmail, from: string) {
  const boundary = `wd-${Date.now()}`
  const headers = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(email.to)}`,
    `Subject: ${encodeSubject(email.subject)}`,
    'MIME-Version: 1.0',
  ]

  if (!email.html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      dotStuff(email.text),
    ].join('\r\n')
  }

  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(email.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(email.html),
    `--${boundary}--`,
  ].join('\r\n')
}

function encodeSubject(subject: string) {
  return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim()
}

function addressOnly(value: string) {
  const match = value.match(/<([^>]+)>/)
  return sanitizeHeader(match?.[1] ?? value)
}

function dotStuff(value: string) {
  return value.replace(/\r?\n\./g, '\r\n..')
}
