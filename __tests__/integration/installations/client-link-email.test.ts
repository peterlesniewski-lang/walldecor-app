import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationOrder } from '@/lib/installations/order-service'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import {
  createClientLink,
  InstallationClientEmailMissingError,
  InstallationClientLinkDeliveryError,
  retrieveCurrentClientLink,
  sendClientLinkEmail,
} from '@/lib/installations/client-link'
import type { OutboundEmail } from '@/lib/email/outbound-email'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-link-email-'))
const databasePath = path.join(directory, 'test.db')
const dayMs = 24 * 60 * 60 * 1000
let db: PrismaClient
let people: Array<{ id: string }>

async function createOrderWithForm(email: string) {
  const order = await createInstallationOrder(db, {
    client: { name: 'Klient Testowy', email, phone: '+48 501 444 555' },
    address: { street: 'Testowa', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: people[0].id, backupEmployeeId: people[1].id,
  }, 'admin')
  const draft = await createInstallationFormTemplate(db, { name: `Mail ${order.id}`, actorId: 'admin', questions: [{ key: 'test', type: 'TEXT', label: 'Test' }] })
  const template = await publishInstallationFormTemplate(db, draft.id, 'admin')
  await createInstallationOrderFormSnapshot(db, { orderId: order.id, templateId: template.id }, 'admin')
  return order.id
}

beforeAll(async () => {
  const root = path.join(process.cwd(), 'prisma/migrations')
  for (const migration of readdirSync(root).sort().map((name) => path.join(root, name, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { input: readFileSync(migration, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
  }
  db = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  await db.costCenter.create({ data: { id: 'MAIL', name: 'Test' } })
  people = await Promise.all(['Owner', 'Backup'].map((name) => db.employee.create({ data: { firstName: name, lastName: 'Test', email: `${name}@example.test`, position: 'Test', costCenterId: 'MAIL', startDate: new Date(), active: true } })))
})
afterAll(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }) })

describe('sendClientLinkEmail', () => {
  it('creates a 21-day link when none is active, e-mails the /m/ URL to the card e-mail and marks it sent', async () => {
    const orderId = await createOrderWithForm('marta.private@example.test')
    const emailSender = vi.fn<(email: OutboundEmail) => Promise<void>>().mockResolvedValue(undefined)
    const before = Date.now()
    const result = await sendClientLinkEmail(db, { orderId, actorId: 'owner-user', origin: 'http://localhost:3000', emailSender })

    expect(result).toMatchObject({ sentTo: 'marta.private@example.test', created: true })
    expect(result.url).toBe(`http://localhost:3000/m/${result.token}`)
    expect(emailSender).toHaveBeenCalledTimes(1)
    const email = emailSender.mock.calls[0][0]
    expect(email.to).toBe('marta.private@example.test')
    expect(email.subject).toBe('Formularz przed montażem WallDecor')
    expect(email.text).toContain(result.url)
    expect(email.text).toMatch(/ważny do \d{2}\.\d{2}\.\d{4}/)
    expect(email.text).toContain('WallDecor')
    const stored = await db.installationClientLink.findUniqueOrThrow({ where: { id: result.link.id } })
    expect(stored.sentById).toBe('owner-user')
    expect(stored.sentAt).not.toBeNull()
    expect(stored.revokedAt).toBeNull()
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 21 * dayMs - 1000)
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 21 * dayMs + 1000)
    const audit = JSON.stringify(await db.installationAuditEvent.findMany({ where: { orderId, action: { startsWith: 'INSTALLATION_CLIENT_LINK' } } }))
    expect(audit).toContain('INSTALLATION_CLIENT_LINK_SENT')
    expect(audit).not.toContain(result.token)
    expect(audit).not.toContain('marta.private@example.test')
  })

  it('reuses an active recoverable link instead of rotating it and honours a custom expiry only for a fresh link', async () => {
    const orderId = await createOrderWithForm('reuse@example.test')
    const existing = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: new Date(Date.now() + 5 * dayMs) })
    const emailSender = vi.fn<(email: OutboundEmail) => Promise<void>>().mockResolvedValue(undefined)
    const result = await sendClientLinkEmail(db, { orderId, actorId: 'owner-user', origin: 'http://localhost:3000', expiresAt: new Date(Date.now() + 40 * dayMs), emailSender })

    expect(result.created).toBe(false)
    expect(result.link.id).toBe(existing.link.id)
    expect(result.token).toBe(existing.token)
    expect(await db.installationClientLink.count({ where: { orderId } })).toBe(1)
    expect(emailSender.mock.calls[0][0].text).toContain(`/m/${existing.token}`)
    expect((await db.installationClientLink.findUniqueOrThrow({ where: { id: existing.link.id } })).sentById).toBe('owner-user')
  })

  it('keeps a pre-existing link active and unmarked when delivery fails', async () => {
    const orderId = await createOrderWithForm('keep@example.test')
    const existing = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: new Date(Date.now() + 5 * dayMs) })
    const emailSender = vi.fn<(email: OutboundEmail) => Promise<void>>().mockRejectedValue(new Error('SMTP expected 250, got 550'))
    const failure = await sendClientLinkEmail(db, { orderId, actorId: 'owner-user', emailSender }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(InstallationClientLinkDeliveryError)
    expect((failure as Error).message).toBe('Nie udało się wysłać wiadomości. Link nie został oznaczony jako wysłany.')
    const stored = await db.installationClientLink.findUniqueOrThrow({ where: { id: existing.link.id } })
    expect(stored.revokedAt).toBeNull()
    expect(stored.sentAt).toBeNull()
    expect((await retrieveCurrentClientLink(db, orderId)).token).toBe(existing.token)
  })

  it('revokes only the link it created when delivery fails and leaves no active link behind', async () => {
    const orderId = await createOrderWithForm('fresh@example.test')
    const emailSender = vi.fn<(email: OutboundEmail) => Promise<void>>().mockRejectedValue(new Error('offline'))
    await expect(sendClientLinkEmail(db, { orderId, actorId: 'owner-user', emailSender })).rejects.toBeInstanceOf(InstallationClientLinkDeliveryError)

    const links = await db.installationClientLink.findMany({ where: { orderId } })
    expect(links).toHaveLength(1)
    expect(links[0].revokedAt).not.toBeNull()
    expect(links[0].sentAt).toBeNull()
    expect((await retrieveCurrentClientLink(db, orderId)).reason).toBe('NO_ACTIVE_LINK')
  })

  it('refuses to send when the card has no client e-mail and touches neither links nor the sender', async () => {
    const orderId = await createOrderWithForm('to-be-cleared@example.test')
    const order = await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
    await db.installationClient.update({ where: { id: order.clientId }, data: { email: '   ' } })
    const emailSender = vi.fn<(email: OutboundEmail) => Promise<void>>().mockResolvedValue(undefined)
    const failure = await sendClientLinkEmail(db, { orderId, actorId: 'owner-user', emailSender }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(InstallationClientEmailMissingError)
    expect((failure as Error).message).toBe('Karta nie ma adresu e-mail klienta.')
    expect(emailSender).not.toHaveBeenCalled()
    expect(await db.installationClientLink.count({ where: { orderId } })).toBe(0)
  })
})
