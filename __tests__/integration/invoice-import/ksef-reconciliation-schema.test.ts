// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const directory = mkdtempSync(join(tmpdir(), 'invoice-ksef-schema-'))
const migrationName = '20260911190000_invoice_ksef_reconciliation'
const migrate = (databaseUrl: string, schema = 'prisma/schema.prisma') => execFileSync(process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schema],
  { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60_000 })
afterAll(() => rmSync(directory, { recursive: true, force: true }))

function emptyDatabase(name: string) {
  const databasePath = join(directory, name)
  // This pinned local schema engine fails when bootstrapping a nonexistent DB.
  // Create an empty SQLite file; migrate deploy still applies the entire chain.
  execFileSync('/usr/bin/sqlite3', [databasePath, 'VACUUM;'], { stdio: 'pipe' })
  return `file:${databasePath}`
}

async function seed(db: PrismaClient) {
  await db.user.create({ data: { id: 'owner', name: 'Owner', email: 'schema@example.test', passwordHash: 'test-only', role: 'ADMIN' } })
  await db.invoiceImportBatch.create({ data: { id: 'batch', ownerUserId: 'owner' } })
  for (const id of ['a', 'b']) {
    await db.invoiceAttachment.create({ data: { id, storageKey: id, sha256: id.repeat(64), originalName: 'file.png', mimeType: 'image/png', byteSize: 1, state: 'READY', createdById: 'owner' } })
    await db.invoiceImportDraft.create({ data: { id, batchId: 'batch', attachmentId: id, dataJson: '{"gross":123}' } })
  }
}

async function insert(db: PrismaClient, id: string, draftId: string, externalId: string) {
  return db.$executeRaw`INSERT INTO "InvoiceKsefReconciliation" ("id", "draftId", "externalId", "snapshotJson", "snapshotHash", "updatedAt")
    VALUES (${id}, ${draftId}, ${externalId}, '{}', ${'a'.repeat(64)}, CURRENT_TIMESTAMP)`
}

describe('additive, durable KSeF reconciliation schema', () => {
  it.each(['rowid', '_rowid_', 'oid'])('has no hidden %s identity for INSERT/UPDATE REPLACE to overwrite', async (alias) => {
    const url = emptyDatabase(`hidden-${alias}.db`)
    migrate(url)
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      await seed(db)
      await insert(db, 'link-a', 'a', 'KSEF-A')
      await insert(db, 'link-b', 'b', 'KSEF-B')
      await db.$executeRawUnsafe('PRAGMA recursive_triggers=OFF')
      const before = await db.invoiceKsefReconciliation.findMany({ orderBy: { id: 'asc' } })
      // The interpolated alias is exclusively one of these three fixed SQLite identifiers.
      await expect(db.$executeRawUnsafe(`INSERT OR REPLACE INTO "InvoiceKsefReconciliation"
        (${alias}, "id", "draftId", "externalId", "snapshotJson", "snapshotHash", "updatedAt")
        VALUES (1, 'replacement', 'b', 'KSEF-REPLACE', '{}', '${'c'.repeat(64)}', CURRENT_TIMESTAMP)`)).rejects.toThrow()
      await expect(db.$executeRawUnsafe(`UPDATE OR REPLACE "InvoiceKsefReconciliation"
        SET ${alias}=(SELECT ${alias} FROM "InvoiceKsefReconciliation" WHERE "id"='link-b') WHERE "id"='link-a'`)).rejects.toThrow()
      expect(await db.invoiceKsefReconciliation.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
    } finally { await db.$disconnect() }
  })

  it.each(['padded-external-id', 'nul-external-id', 'nul-hash', 'nul-resolved-hash', 'replace-external-id', 'replace-primary-id', 'update-replace-primary-id'])('rejects boundary bypass: %s', async (mode) => {
    const url = emptyDatabase(`${mode}.db`)
    migrate(url)
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      await seed(db)
      await insert(db, 'link', 'a', 'KSEF-ONE')
      await expect(db.invoiceKsefReconciliation.create({ data: {
        draftId: 'b', externalId: 'KSEF-PRISMA-CREATE', snapshotJson: '{}', snapshotHash: 'b'.repeat(64),
      } })).resolves.toMatchObject({ id: expect.any(String), draftId: 'b', externalId: 'KSEF-PRISMA-CREATE' })
      if (mode === 'update-replace-primary-id') await insert(db, 'link-b', 'b', 'KSEF-TWO')
      const before = await db.invoiceKsefReconciliation.findMany()
      if (mode === 'padded-external-id') {
        await expect(insert(db, 'padding', 'b', `${' '.repeat(200)}KSEF-X`)).rejects.toThrow()
      } else if (mode === 'nul-external-id') {
        await expect(insert(db, 'nul', 'b', `KSEF-X\0${'x'.repeat(200)}`)).rejects.toThrow()
      } else if (mode === 'nul-hash') {
        await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "snapshotHash"=${`${'a'.repeat(64)}\0INVALID`} WHERE "id"='link'`).rejects.toThrow()
      } else if (mode === 'nul-resolved-hash') {
        await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "resolvedDataHash"=${`${'a'.repeat(64)}\0INVALID`} WHERE "id"='link'`).rejects.toThrow()
      } else if (mode === 'update-replace-primary-id') {
        await db.$executeRawUnsafe('PRAGMA recursive_triggers=OFF')
        await expect(db.$executeRaw`UPDATE OR REPLACE "InvoiceKsefReconciliation" SET "id"='link-b' WHERE "id"='link'`).rejects.toThrow()
      } else {
        // Prisma's connection defaults recursive_triggers off; guard REPLACE
        // before it can delete the old binding without firing delete triggers.
        await db.$executeRawUnsafe('PRAGMA recursive_triggers=OFF')
        const id = mode === 'replace-primary-id' ? 'link' : 'replacement'
        const externalId = mode === 'replace-external-id' ? 'KSEF-ONE' : 'KSEF-TWO'
        await expect(db.$executeRaw`INSERT OR REPLACE INTO "InvoiceKsefReconciliation"
          ("id", "draftId", "externalId", "snapshotJson", "snapshotHash", "updatedAt")
          VALUES (${id}, 'b', ${externalId}, '{}', ${'b'.repeat(64)}, CURRENT_TIMESTAMP)`).rejects.toThrow()
      }
      expect(await db.invoiceKsefReconciliation.findMany()).toEqual(before)
    } finally { await db.$disconnect() }
  })

  it('retains one external document binding across restart and guards identity, state and content bounds', async () => {
    const url = emptyDatabase('fresh.db')
    migrate(url)
    let db = new PrismaClient({ datasources: { db: { url } } })
    try {
      expect(await db.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='InvoiceKsefReconciliation'`)
        .toEqual([{ name: 'InvoiceKsefReconciliation' }])
      await seed(db)
      await insert(db, 'link', 'a', 'KSEF-ONE')
      expect(await db.invoiceKsefReconciliation.findUniqueOrThrow({ where: { externalId: 'KSEF-ONE' }, include: { draft: true } }))
        .toMatchObject({ id: 'link', version: 1, status: 'MATCHED', resolvedDataHash: null, draft: { id: 'a', dataJson: '{"gross":123}' } })
      expect(await db.$queryRawUnsafe('PRAGMA foreign_key_list("InvoiceKsefReconciliation")'))
        .toEqual([expect.objectContaining({ table: 'InvoiceImportDraft', from: 'draftId', to: 'id', on_delete: 'RESTRICT' })])
      expect(await db.ksefInvoice.count()).toBe(0)
      expect(await db.costEvent.count()).toBe(0)
      await expect(insert(db, 'duplicate', 'b', 'KSEF-ONE')).rejects.toThrow()
      await expect(insert(db, 'orphan', 'missing', 'KSEF-TWO')).rejects.toThrow()
      await expect(insert(db, 'empty', 'a', ' ')).rejects.toThrow()
      await expect(insert(db, 'long', 'a', 'x'.repeat(192))).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "draftId"='b' WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "externalId"='KSEF-TWO' WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`DELETE FROM "InvoiceKsefReconciliation" WHERE "id"='link'`).rejects.toThrow()
      await expect(db.invoiceImportDraft.delete({ where: { id: 'a' } })).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "status"='GUESSED' WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "version"=0 WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "snapshotHash"=${'z'.repeat(64)} WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "resolvedDataHash"='bad' WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "snapshotJson"=${'x'.repeat(65_537)} WHERE "id"='link'`).rejects.toThrow()
      await expect(db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "xmlContent"=${'ą'.repeat(2_097_153)} WHERE "id"='link'`).rejects.toThrow()
      await db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "snapshotJson"=${'ą'.repeat(32_768)}, "xmlContent"=${'ą'.repeat(2_097_152)} WHERE "id"='link'`
      for (const status of ['CONFLICT', 'APPLIED_TO_DRAFT']) {
        await expect(db.invoiceKsefReconciliation.update({ where: { id: 'link' }, data: { status } })).resolves.toMatchObject({ status })
      }
      await db.$executeRaw`UPDATE "InvoiceKsefReconciliation" SET "status"='KEPT_LOCAL', "resolvedDataHash"=${'b'.repeat(64)}, "version"=2, "xmlContent"='<Faktura/>' WHERE "id"='link'`
      await db.$disconnect()
      db = new PrismaClient({ datasources: { db: { url } } })
      expect(await db.$queryRaw`SELECT "draftId", "externalId", "version", "status", "xmlContent", "resolvedDataHash" FROM "InvoiceKsefReconciliation" WHERE "id"='link'`)
        .toEqual([{ draftId: 'a', externalId: 'KSEF-ONE', version: 2, status: 'KEPT_LOCAL', xmlContent: '<Faktura/>', resolvedDataHash: 'b'.repeat(64) }])
      expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
      expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally { await db.$disconnect() }
  })

  it('upgrades the preceding migration chain without rewriting drafts, originals or money', async () => {
    const prior = join(directory, 'prior')
    mkdirSync(join(prior, 'migrations'), { recursive: true })
    cpSync('prisma/schema.prisma', join(prior, 'schema.prisma'))
    cpSync('prisma/migrations/migration_lock.toml', join(prior, 'migrations/migration_lock.toml'))
    for (const name of readdirSync('prisma/migrations').filter((name) => name < migrationName && /^\d/u.test(name))) {
      cpSync(join('prisma/migrations', name), join(prior, 'migrations', name), { recursive: true })
    }
    const url = emptyDatabase('upgrade.db')
    migrate(url, join(prior, 'schema.prisma'))
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      await seed(db)
      const invoice = await db.ksefInvoice.create({ data: {
        source: 'MANUAL', supplierName: 'Migration supplier', invoiceNumber: 'UPGRADE/1', issueDate: new Date('2026-09-11T00:00:00Z'), grossAmount: 123, status: 'APPROVED',
      } })
      await db.costEvent.create({ data: { source: 'MANUAL', sourceInvoiceId: invoice.id, eventDate: invoice.issueDate, grossAmount: 123, status: 'APPROVED' } })
      await db.invoiceImportDraft.update({ where: { id: 'a' }, data: { invoiceId: invoice.id, state: 'APPROVED' } })
      const before = { drafts: await db.invoiceImportDraft.findMany(), attachments: await db.invoiceAttachment.findMany(), invoices: await db.ksefInvoice.findMany(), costs: await db.costEvent.findMany() }
      await db.$disconnect()
      migrate(url)
      expect({ drafts: await db.invoiceImportDraft.findMany(), attachments: await db.invoiceAttachment.findMany(), invoices: await db.ksefInvoice.findMany(), costs: await db.costEvent.findMany() }).toEqual(before)
      await insert(db, 'upgraded-link', 'a', 'KSEF-UPGRADE')
      expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
      expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally { await db.$disconnect() }
  })
})
