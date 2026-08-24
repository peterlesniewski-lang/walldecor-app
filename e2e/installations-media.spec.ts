import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import QRCode from 'qrcode'
import { PrismaClient } from '@/generated/prisma'
import { createClientLink } from '@/lib/installations/client-link'
import { createInstallationOrder } from '@/lib/installations/order-service'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'

const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite montaży.')

// A complete 1x1 PNG: signature, IHDR, IDAT and IEND. It is accepted by the
// structural checks of the real private-media service, not merely by its MIME.
const uploadedBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLxVwAAAABJRU5ErkJggg==', 'base64')
const uploadedSha256 = createHash('sha256').update(uploadedBytes).digest('hex')
let db: PrismaClient
let orderId: string
let clientToken: string

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'MEDIA_E2E', name: 'E2E prywatnych plików' } })
  const [owner, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Alicja', lastName: 'Media', email: 'e2e.media.owner@example.test', position: 'Koordynatorka', costCenterId: 'MEDIA_E2E', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartosz', lastName: 'Media', email: 'e2e.media.backup@example.test', position: 'Koordynator', costCenterId: 'MEDIA_E2E', startDate: new Date('2026-01-01'), active: true } }),
  ])
  const order = await createInstallationOrder(db, {
    client: { name: 'Klient plików E2E', email: 'e2e.media.client@example.test', phone: '+48 503 444 555' },
    address: { street: 'Montażowa', buildingNumber: '12', postalCode: '00-012', city: 'Warszawa' },
    primaryEmployeeId: owner.id,
    backupEmployeeId: backup.id,
  }, 'admin')
  orderId = order.id
  const draft = await createInstallationFormTemplate(db, {
    name: 'E2E przekazanie zdjęcia', actorId: 'admin',
    questions: [
      { key: 'uwagi-do-sciany', type: 'TEXT', label: 'Uwagi do ściany' },
      { key: 'zdjecie-przed-montazem', type: 'FILE', label: 'Zdjęcie przed montażem', required: true },
    ],
  })
  const template = await publishInstallationFormTemplate(db, draft.id, 'admin')
  await createInstallationOrderFormSnapshot(db, { orderId, templateId: template.id }, 'admin')
  const link = await createClientLink(db, { orderId, createdById: 'admin', expiresAt: new Date(Date.now() + 86_400_000) })
  clientToken = link.token
})

test.afterAll(async () => { await db?.$disconnect() })

test('desktop QR handoff streams a mobile file through the app and revokes every later access', async ({ page, browser }) => {
  await page.goto(`/m/${clientToken}`)
  await expect(page.getByText('Zdjęcie przed montażem')).toBeVisible()
  const wallNotes = page.getByRole('textbox', { name: 'Uwagi do ściany', exact: true })
  await wallNotes.fill('Ściana przy oknie — zachować ostrożność.')
  await expect(page.getByRole('status')).toContainText('Wszystko zapisane', { timeout: 5_000 })
  const handoffResponse = page.waitForResponse((response) => response.url().endsWith(`/api/public/installations/${clientToken}/handoffs`) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Dodaj z telefonu' }).click()
  const handoff = await (await handoffResponse).json() as { handoffId: string; handoffUrl: string }
  expect(handoff.handoffUrl).toContain('/m/u/')
  const qr = page.getByRole('img', { name: 'Kod QR do dodania pliku z telefonu' })
  await expect(qr).toBeVisible()
  const renderedQr = decodeURIComponent((await qr.getAttribute('src'))!.split(',', 2)[1]!)
  expect(renderedQr).toBe(await QRCode.toString(handoff.handoffUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))

  const mobileContext = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 390, height: 844 } })
  const mobile = await mobileContext.newPage()
  await mobile.goto(handoff.handoffUrl)
  const camera = mobile.getByLabel('Zrób zdjęcie')
  const library = mobile.getByLabel('Wybierz z urządzenia')
  await expect(camera).toHaveAttribute('capture', 'environment')
  await expect(library).toHaveAttribute('accept', /application\/pdf/)
  const mobileUploadResponse = mobile.waitForResponse((response) => response.url().endsWith('/api/public/mobile-upload/session/files') && response.request().method() === 'POST')
  await library.setInputFiles({ name: 'mobilne-zdjecie.png', mimeType: 'image/png', buffer: uploadedBytes })
  expect((await mobileUploadResponse).status()).toBe(201)
  await expect(mobile.getByText('Plik został dodany. Możesz bezpiecznie wrócić do formularza na drugim urządzeniu.')).toBeVisible()

  await expect(page.getByRole('list', { name: 'Dodane pliki: Zdjęcie przed montażem' })).toContainText('mobilne-zdjecie.png', { timeout: 12_000 })
  await page.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(page.getByText(/Formularz został wysłany/i)).toBeVisible()

  const deniedSubmittedMobileSession = await mobile.evaluate(async ({ bytes }) => {
    const body = new FormData()
    body.set('file', new File([Uint8Array.from(bytes)], 'po-wyslaniu.png', { type: 'image/png' }))
    return (await fetch('/api/public/mobile-upload/session/files', { method: 'POST', body })).status
  }, { bytes: [...uploadedBytes] })
  expect(deniedSubmittedMobileSession).toBe(404)

  const deniedBeforeCorrection = await page.evaluate(async ({ token, bytes }) => {
    const upload = new FormData()
    upload.set('questionKey', 'zdjecie-przed-montazem')
    upload.set('file', new File([Uint8Array.from(bytes)], 'niejawna-korekta.png', { type: 'image/png' }))
    const [files, newFile, handoff] = await Promise.all([
      fetch(`/api/public/installations/${token}/files?questionKey=zdjecie-przed-montazem`, { cache: 'no-store' }),
      fetch(`/api/public/installations/${token}/files`, { method: 'POST', body: upload }),
      fetch(`/api/public/installations/${token}/handoffs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionKey: 'zdjecie-przed-montazem' }),
      }),
    ])
    return [files.status, newFile.status, handoff.status]
  }, { token: clientToken, bytes: [...uploadedBytes] })
  expect(deniedBeforeCorrection).toEqual([404, 404, 404])
  await expect(db.installationFormSubmission.count({ where: { orderId } })).resolves.toBe(1)
  await expect(db.installationFormSubmission.findUnique({ where: { draftKey: orderId } })).resolves.toBeNull()

  await page.getByRole('button', { name: 'Zgłoś korektę' }).click()
  await expect(wallNotes).toHaveValue('Ściana przy oknie — zachować ostrożność.')
  await expect(page.getByRole('list', { name: 'Dodane pliki: Zdjęcie przed montażem' })).toContainText('mobilne-zdjecie.png')
  const correction = await db.installationFormSubmission.findUniqueOrThrow({ where: { draftKey: orderId }, include: { answers: true } })
  const submitted = await db.installationFormSubmission.findFirstOrThrow({ where: { orderId, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'desc' } })
  expect(correction).toMatchObject({ revisionNumber: 2, revisionOfId: submitted.id, status: 'DRAFT' })
  expect(correction.answers).toEqual(expect.arrayContaining([
    expect.objectContaining({ questionKey: 'uwagi-do-sciany', normalizedValue: 'Ściana przy oknie — zachować ostrożność.' }),
  ]))

  const stored = await db.installationFile.findFirstOrThrow({ where: { orderId, originalFilename: 'mobilne-zdjecie.png', status: 'READY', softDeletedAt: null } })
  expect(stored.sha256).toBe(uploadedSha256)
  const downloadPath = `/api/installations/${orderId}/files/${stored.id}`

  await page.goto('/login')
  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[type="password"]', 'ChangeMe123!')
  await page.getByRole('button', { name: /zaloguj/i }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  const downloaded = await page.request.get(downloadPath)
  expect(downloaded.status()).toBe(200)
  expect(createHash('sha256').update(await downloaded.body()).digest('hex')).toBe(uploadedSha256)

  const revoked = await page.evaluate(async ({ token, handoffId }) => {
    const response = await fetch(`/api/public/installations/${token}/handoffs/${handoffId}`, { method: 'DELETE' })
    return response.status
  }, { token: clientToken, handoffId: handoff.handoffId })
  expect(revoked).toBe(200)
  const deniedMobileUpload = await mobile.evaluate(async () => {
    const body = new FormData()
    body.set('file', new File([new Uint8Array([1, 2, 3])], 'po-cofnieciu.png', { type: 'image/png' }))
    return (await fetch('/api/public/mobile-upload/session/files', { method: 'POST', body })).status
  })
  expect(deniedMobileUpload).toBe(404)

  const deleted = await page.request.delete(downloadPath)
  expect(deleted.status()).toBe(200)
  const deniedDownload = await page.request.get(downloadPath)
  expect(deniedDownload.status()).toBe(404)
  await mobileContext.close()
})
