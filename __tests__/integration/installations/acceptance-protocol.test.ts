import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createAcceptanceDraft, getAcceptanceProtocol, listAcceptanceCandidates, signAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'
import { createAcceptancePhotoFile, listAcceptancePhotoFiles } from '@/lib/installation-media/service'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { dispatchAcceptanceEmailLink, issueAcceptanceLink, publicAcceptanceProjection, revokeAcceptanceLink, submitClientAcceptance } from '@/lib/installations/acceptance-client'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-acceptance-'))
const databasePath = path.join(directory, 'acceptance.db')
const db = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
const tinyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
let signature: string
let orderId: string
let visitId: string
let installerId: string
let wallpaperCategoryId: string
let stuccoCategoryId: string
let wallpaperScopeIds: string[]
let stuccoScopeId: string
let secondInstallerId: string

beforeAll(async () => {
  const drawn = await sharp(Buffer.from('<svg width="650" height="180"><path d="M35 105 Q110 25 180 100 T340 80 Q420 35 540 95" fill="none" stroke="#17252b" stroke-width="4" stroke-linecap="round"/></svg>')).png().toBuffer()
  signature = `data:image/png;base64,${drawn.toString('base64')}`
  for (const sqlPath of readdirSync(path.join(process.cwd(), 'prisma/migrations')).sort()
    .map((entry) => path.join(process.cwd(), 'prisma/migrations', entry, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { input: readFileSync(sqlPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'ACCEPT', name: 'Odbiory' } })
  const [owner, backup, installer] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'owner@example.test', position: 'Opiekun', costCenterId: 'ACCEPT', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'backup@example.test', position: 'Opiekun', costCenterId: 'ACCEPT', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Wykonawca', email: 'installer@example.test', position: 'Wykonawca', costCenterId: 'ACCEPT', startDate: new Date('2026-01-01'), active: true } }),
  ])
  installerId = installer.id
  secondInstallerId = backup.id
  const order = await db.installationOrder.create({ data: {
    number: 'MON-ACCEPT-1', client: { create: { name: 'Klient', email: 'client@example.test', phone: '+48 500 100 100' } },
    addressStreet: 'Testowa', addressBuildingNumber: '1', addressPostalCode: '00-001', addressCity: 'Warszawa',
    primaryEmployee: { connect: { id: owner.id } }, backupEmployee: { connect: { id: backup.id } },
  } })
  orderId = order.id
  const wallpaper = await db.installationCatalogCategory.create({ data: { name: 'Tapetowanie', nameKey: 'tapetowanie' } })
  const stucco = await db.installationCatalogCategory.create({ data: { name: 'Sztukateria', nameKey: 'sztukateria' } })
  wallpaperCategoryId = wallpaper.id
  stuccoCategoryId = stucco.id
  const salon = await db.installationRoom.create({ data: { orderId, name: 'Salon', sortOrder: 0 } })
  const bedroom = await db.installationRoom.create({ data: { orderId, name: 'Sypialnia', sortOrder: 1 } })
  const scopes = await Promise.all([
    db.installationScope.create({ data: { roomId: salon.id, catalogCategoryId: wallpaper.id, name: 'Tapeta ściana A' } }),
    db.installationScope.create({ data: { roomId: bedroom.id, catalogCategoryId: wallpaper.id, name: 'Tapeta ściana B' } }),
    db.installationScope.create({ data: { roomId: salon.id, catalogCategoryId: stucco.id, name: 'Listwy' } }),
  ])
  wallpaperScopeIds = scopes.slice(0, 2).map((scope) => scope.id)
  stuccoScopeId = scopes[2].id
  await db.installationScopeAssignment.createMany({ data: scopes.map((scope) => ({ orderId, scopeId: scope.id, employeeId: installer.id, createdById: 'test' })) })
  const visit = await db.installationVisit.create({ data: {
    orderId, status: 'CONFIRMED', startsAt: new Date('2026-09-23T08:00:00Z'), endsAt: new Date('2026-09-23T12:00:00Z'), createdById: 'test',
    scopes: { create: scopes.map((scope) => ({ orderId, scopeId: scope.id })) },
  } })
  visitId = visit.id
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('protokół odbioru prac', () => {
  it('groups one work type across rooms in a visit and preserves the signed card snapshot', async () => {
    expect((await listAcceptanceCandidates(db, orderId, installerId)).map((candidate) => candidate.workType).sort()).toEqual(['Sztukateria', 'Tapetowanie'])
    const draft = await createAcceptanceDraft(db, { orderId, visitId, groupKey: `category:${wallpaperCategoryId}`, installerId })
    expect(draft.snapshot.workType).toBe('Tapetowanie')
    expect(draft.snapshot.items.map((item) => item.roomName)).toEqual(['Salon', 'Sypialnia'])
    expect(draft.snapshot.items.map((item) => item.scopeId)).toEqual(wallpaperScopeIds)
    expect((await createAcceptanceDraft(db, { orderId, visitId, groupKey: `category:${wallpaperCategoryId}`, installerId })).id).toBe(draft.id)

    await expect(signAcceptanceProtocol(db, draft.id, installerId, {
      results: wallpaperScopeIds.map((scopeId) => ({ scopeId, result: 'PARTIAL' as const, note: '' })), signature,
    })).rejects.toThrow('Opisz pracę')
    await expect(signAcceptanceProtocol(db, draft.id, installerId, {
      results: wallpaperScopeIds.map((scopeId) => ({ scopeId, result: 'DONE' as const, note: '' })), signature: tinyImage,
    })).rejects.toThrow('Złóż czytelny podpis')

    const signed = await signAcceptanceProtocol(db, draft.id, installerId, {
      results: wallpaperScopeIds.map((scopeId) => ({ scopeId, result: 'DONE' as const, note: '' })), signature,
    })
    expect(signed.status).toBe('INSTALLER_SIGNED')
    expect(signed.contentHash).toMatch(/^[a-f0-9]{64}$/)

    await db.installationScope.update({ where: { id: wallpaperScopeIds[0] }, data: { name: 'Zmieniona po odbiorze' } })
    const stored = await getAcceptanceProtocol(db, draft.id, installerId)
    expect(stored.snapshot.items[0].scopeName).toBe('Tapeta ściana A')
    expect(stored.results).toHaveLength(2)
    await expect(signAcceptanceProtocol(db, draft.id, installerId, { results: signed.results, signature })).rejects.toThrow()
  })

  it('lets the client decide on a separate link and freezes the signed response', async () => {
    const protocol = await db.installationAcceptanceProtocol.findFirstOrThrow({ where: { visitId, groupKey: `category:${wallpaperCategoryId}` } })
    const { token, link } = await issueAcceptanceLink(db, protocol.id, installerId, 'ONSITE')
    const publicView = await publicAcceptanceProjection(db, token)
    expect(publicView.snapshot.items).toHaveLength(2)
    expect(JSON.stringify(publicView)).not.toContain('owner@example.test')
    await expect(submitClientAcceptance(db, token, { decision: 'ACCEPTED_WITH_REMARKS', firstName: 'Jan', lastName: 'Klient', relationship: 'klient', note: '', signature })).rejects.toThrow('Uwagi')
    await expect(submitClientAcceptance(db, token, { decision: 'ACCEPTED', firstName: 'Jan', lastName: 'Klient', relationship: 'klient', note: '', signature: null })).rejects.toThrow('podpisu')
    const response = await submitClientAcceptance(db, token, { decision: 'ACCEPTED_WITH_REMARKS', firstName: 'Jan', lastName: 'Klient', relationship: 'klient', note: 'Poprawić narożnik.', signature })
    expect(response.decision).toBe('ACCEPTED_WITH_REMARKS')
    expect((await publicAcceptanceProjection(db, token)).clientNote).toBe('Poprawić narożnik.')
    await expect(submitClientAcceptance(db, token, { decision: 'ACCEPTED', firstName: 'Jan', lastName: 'Klient', relationship: 'klient', note: '', signature })).rejects.toThrow('nie oczekuje')
    await expect(db.installationAcceptanceProtocol.update({ where: { id: protocol.id }, data: { clientNote: 'zmiana' } })).rejects.toThrow()
    await db.installationAcceptanceLink.update({ where: { id: link.id }, data: { expiresAt: new Date('2020-01-01') } })
    await expect(publicAcceptanceProjection(db, token)).rejects.toThrow('Nie znaleziono')
  })

  it('accepts an optional private photo before signing and locks its association afterward', async () => {
    const draft = await createAcceptanceDraft(db, { orderId, visitId, groupKey: `category:${stuccoCategoryId}`, installerId })
    expect(await db.installationAcceptanceProtocol.count({ where: { id: draft.id } })).toBe(1)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const media = {
      async upload({ fileId, jobId, contentType }: { fileId: string; jobId: string; contentType: string }) {
        return { fileId, jobId, contentType, byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
      },
      async download() { return new Response(bytes) },
      async remove() {},
    }
    const photo = await createAcceptancePhotoFile(db, draft.id, installerId, { filename: 'po-montazu.png', contentType: 'image/png', bytes }, media)
    expect((await listAcceptancePhotoFiles(db, draft.id, installerId)).map((file) => file.id)).toEqual([photo.id])
    const signed = await signAcceptanceProtocol(db, draft.id, installerId, { results: [{ scopeId: stuccoScopeId, result: 'DONE', note: '' }], signature })
    expect(signed.contentHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(createAcceptancePhotoFile(db, draft.id, installerId, { filename: 'pozniej.png', contentType: 'image/png', bytes }, media)).rejects.toThrow()

    const messages: string[] = []
    const first = await dispatchAcceptanceEmailLink(db, draft.id, installerId, 'https://app.example.test', async (email) => { messages.push(email.text) })
    const firstLink = await db.installationAcceptanceLink.findUniqueOrThrow({ where: { id: first.linkId } })
    expect(firstLink.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(firstLink.sentAt).not.toBeNull()
    expect(messages[0]).toContain('https://app.example.test/p/')
    expect(firstLink.expiresAt.getTime() - firstLink.createdAt.getTime()).toBeGreaterThan(89 * 24 * 60 * 60_000)
    await expect(dispatchAcceptanceEmailLink(db, draft.id, installerId, 'https://app.example.test', async () => { throw new Error('SMTP failed') })).rejects.toThrow('Nie udało się wysłać')
    expect((await db.installationAcceptanceLink.findUniqueOrThrow({ where: { id: first.linkId } })).revokedAt).toBeNull()
    const second = await dispatchAcceptanceEmailLink(db, draft.id, installerId, 'https://app.example.test', async (email) => { messages.push(email.text) })
    expect(second.linkId).not.toBe(first.linkId)
    expect((await db.installationAcceptanceLink.findUniqueOrThrow({ where: { id: first.linkId } })).revokedAt).not.toBeNull()
    await revokeAcceptanceLink(db, second.linkId)
    expect((await db.installationAcceptanceLink.findUniqueOrThrow({ where: { id: second.linkId } })).revokedAt).not.toBeNull()
    const secondToken = messages[1]?.match(/\/p\/([A-Za-z0-9_-]{43})/)?.[1]
    expect(secondToken).toBeTruthy()
    await expect(publicAcceptanceProjection(db, secondToken!)).rejects.toThrow('Nie znaleziono')
  })

  it('creates a separate protocol on the next visit and rejects ambiguous ownership or a cancelled visit', async () => {
    const next = await db.installationVisit.create({ data: {
      orderId, status: 'CONFIRMED', startsAt: new Date('2026-09-23T14:00:00Z'), endsAt: new Date('2026-09-23T17:00:00Z'), createdById: 'test',
      scopes: { create: wallpaperScopeIds.map((scopeId) => ({ orderId, scopeId })) },
    } })
    await db.installationScopeAssignment.createMany({ data: wallpaperScopeIds.map((scopeId) => ({ orderId, scopeId, employeeId: secondInstallerId, createdById: 'test' })) })
    const candidate = (await listAcceptanceCandidates(db, orderId, installerId)).find((item) => item.visitId === next.id)
    expect(candidate?.blockedReason).toContain('jednego odpowiedzialnego')
    await expect(createAcceptanceDraft(db, { orderId, visitId: next.id, groupKey: `category:${wallpaperCategoryId}`, installerId })).rejects.toThrow('jednego odpowiedzialnego')
    await db.installationScopeAssignment.deleteMany({ where: { orderId, scopeId: { in: wallpaperScopeIds }, employeeId: secondInstallerId } })
    const draft = await createAcceptanceDraft(db, { orderId, visitId: next.id, groupKey: `category:${wallpaperCategoryId}`, installerId })
    expect(draft.id).not.toBe((await db.installationAcceptanceProtocol.findFirstOrThrow({ where: { visitId, groupKey: `category:${wallpaperCategoryId}` } })).id)
    await expect(getAcceptanceProtocol(db, draft.id, secondInstallerId)).rejects.toThrow('Nie znaleziono')
    await db.installationVisit.update({ where: { id: next.id }, data: { status: 'CANCELLED' } })
    await expect(signAcceptanceProtocol(db, draft.id, installerId, { results: wallpaperScopeIds.map((scopeId) => ({ scopeId, result: 'DONE', note: '' })), signature })).rejects.toThrow('odwołana')
  })
})
