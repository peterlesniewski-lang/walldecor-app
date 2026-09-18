// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const workspace = process.cwd()
const migrationName = '20260911150000_invoice_import_drafts'
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-import-schema-'))
const freshDatabaseUrl = `file:${path.join(directory, 'fresh.db')}`
const upgradeDatabaseUrl = `file:${path.join(directory, 'upgrade.db')}`

function runMigrate(databaseUrl: string, schemaPath?: string) {
  const args = [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']
  if (schemaPath) args.push('--schema', schemaPath)
  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (result.error) throw result.error
  expect(result.status, result.stderr || result.stdout).toBe(0)
}

function createPriorPrismaDirectory() {
  const root = path.join(directory, 'prior-prisma')
  const migrations = path.join(root, 'migrations')
  mkdirSync(migrations, { recursive: true })
  cpSync(path.join(workspace, 'prisma', 'schema.prisma'), path.join(root, 'schema.prisma'))
  cpSync(path.join(workspace, 'prisma', 'migrations', 'migration_lock.toml'), path.join(migrations, 'migration_lock.toml'))
  for (const name of readdirSync(path.join(workspace, 'prisma', 'migrations')).sort()) {
    const source = path.join(workspace, 'prisma', 'migrations', name)
    if (name < migrationName && existsSync(path.join(source, 'migration.sql'))) {
      cpSync(source, path.join(migrations, name), { recursive: true })
    }
  }
  return path.join(root, 'schema.prisma')
}

async function tableNames(db: PrismaClient) {
  const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('InvoiceImportBatch', 'InvoiceAttachment', 'InvoiceImportDraft', 'InvoiceDraftAudit') ORDER BY name",
  )
  return tables.map(({ name }) => name)
}

afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('invoice import draft additive schema', () => {
  it('applies the fresh chain, enforces durable relations and uniqueness, and creates no financial records', async () => {
    runMigrate(freshDatabaseUrl)
    let db = new PrismaClient({ datasources: { db: { url: freshDatabaseUrl } } })
    try {
      expect(await tableNames(db)).toEqual([
        'InvoiceAttachment',
        'InvoiceDraftAudit',
        'InvoiceImportBatch',
        'InvoiceImportDraft',
      ])

      const foreignKeyTargets = async (table: string) => {
        const rows = await db.$queryRawUnsafe<Array<{ table: string; on_delete: string }>>(`PRAGMA foreign_key_list('${table}')`)
        return rows.map((row) => `${row.table}:${row.on_delete}`).sort()
      }
      expect(await foreignKeyTargets('InvoiceImportBatch')).toEqual(['User:RESTRICT'])
      expect(await foreignKeyTargets('InvoiceAttachment')).toEqual(['User:RESTRICT'])
      expect(await foreignKeyTargets('InvoiceImportDraft')).toEqual([
        'AiJob:RESTRICT', 'InvoiceAttachment:RESTRICT', 'InvoiceImportBatch:RESTRICT', 'KsefInvoice:RESTRICT',
      ])
      expect(await foreignKeyTargets('InvoiceDraftAudit')).toEqual([
        'AiJob:RESTRICT', 'InvoiceImportDraft:RESTRICT', 'User:RESTRICT',
      ])

      const [owner, otherActor] = await Promise.all([
        db.user.create({ data: { id: 'draft-owner', name: 'Draft Owner', email: 'draft-owner@example.test', passwordHash: 'test-only', role: 'ADMIN' } }),
        db.user.create({ data: { id: 'other-actor', name: 'Other Actor', email: 'other-actor@example.test', passwordHash: 'test-only', role: 'ADMIN' } }),
      ])
      const batch = await db.invoiceImportBatch.create({ data: { id: 'batch-a', ownerUserId: owner.id } })
      const attachment = await db.invoiceAttachment.create({ data: {
        id: 'attachment-a', storageKey: 'invoice-import/a', sha256: 'a'.repeat(64), originalName: 'invoice.pdf',
        mimeType: 'application/pdf', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })
      const job = await db.aiJob.create({ data: {
        id: 'invoice-job-a', ownerUserId: owner.id, kind: 'INVOICE_EXTRACT', status: 'QUEUED',
        payloadJson: '{"draftId":"draft-a","revision":1,"attachmentId":"attachment-a"}',
      } })
      const draft = await db.invoiceImportDraft.create({ data: {
        id: 'draft-a', batchId: batch.id, attachmentId: attachment.id, latestAiJobId: job.id,
      } })
      const audit = await db.invoiceDraftAudit.create({ data: {
        id: 'audit-a', draftId: draft.id, action: 'CREATED', actorId: owner.id,
        aiJobId: job.id, idempotencyKey: 'request-a', requestHash: 'hash-a', resultJson: '{"ok":true}',
      } })

      expect(await db.ksefInvoice.count()).toBe(0)
      expect(await db.costEvent.count()).toBe(0)
      await expect(db.invoiceAttachment.create({ data: {
        storageKey: 'invoice-import/other', sha256: attachment.sha256, originalName: 'duplicate.pdf',
        mimeType: 'application/pdf', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })).rejects.toThrow()
      await expect(db.invoiceAttachment.create({ data: {
        storageKey: attachment.storageKey, sha256: 'b'.repeat(64), originalName: 'duplicate-key.pdf',
        mimeType: 'application/pdf', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })).rejects.toThrow()
      await expect(db.invoiceImportDraft.create({ data: {
        batchId: batch.id, attachmentId: attachment.id,
      } })).rejects.toThrow()
      await expect(db.invoiceDraftAudit.create({ data: {
        draftId: draft.id, action: 'RETRY', actorId: owner.id, idempotencyKey: 'request-a',
      } })).rejects.toThrow()
      await expect(db.invoiceDraftAudit.create({ data: {
        draftId: draft.id, action: 'OTHER_ACTOR_RETRY', actorId: otherActor.id, idempotencyKey: 'request-a',
      } })).resolves.toBeTruthy()

      const invoice = await db.ksefInvoice.create({ data: {
        id: 'approved-invoice', supplierName: 'Supplier', invoiceNumber: 'FV/1',
        issueDate: new Date('2026-09-11T00:00:00.000Z'), grossAmount: 100,
      } })
      const secondAttachment = await db.invoiceAttachment.create({ data: {
        id: 'attachment-b', storageKey: 'invoice-import/b', sha256: 'c'.repeat(64), originalName: 'invoice.png',
        mimeType: 'image/png', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })
      await db.invoiceImportDraft.create({ data: {
        id: 'draft-b', batchId: batch.id, attachmentId: secondAttachment.id, invoiceId: invoice.id,
      } })
      await expect(db.invoiceImportDraft.update({
        where: { id: 'draft-b' }, data: { invoiceId: null },
      })).rejects.toThrow()
      await expect(db.invoiceImportDraft.findUniqueOrThrow({ where: { id: 'draft-b' } }))
        .resolves.toMatchObject({ invoiceId: invoice.id })
      const thirdAttachment = await db.invoiceAttachment.create({ data: {
        id: 'attachment-c', storageKey: 'invoice-import/c', sha256: 'd'.repeat(64), originalName: 'invoice.webp',
        mimeType: 'image/webp', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })
      await expect(db.invoiceImportDraft.create({ data: {
        id: 'draft-c', batchId: batch.id, attachmentId: thirdAttachment.id, invoiceId: invoice.id,
      } })).rejects.toThrow()
      const fourthAttachment = await db.invoiceAttachment.create({ data: {
        id: 'attachment-d', storageKey: 'invoice-import/d', sha256: 'e'.repeat(64), originalName: 'invoice.jpeg',
        mimeType: 'image/jpeg', byteSize: 0, state: 'STAGED', createdById: owner.id,
      } })
      await expect(db.invoiceImportDraft.create({ data: {
        id: 'draft-d', batchId: batch.id, attachmentId: fourthAttachment.id, latestAiJobId: job.id,
      } })).rejects.toThrow()

      for (const valid of [
        { id: 'ready-pdf-min', mimeType: 'application/pdf', byteSize: 1, pageCount: 1 },
        { id: 'ready-pdf-max', mimeType: 'application/pdf', byteSize: 10 * 1024 * 1024, pageCount: 10 },
        { id: 'ready-jpeg', mimeType: 'image/jpeg', byteSize: 1, pageCount: null },
        { id: 'ready-png', mimeType: 'image/png', byteSize: 1, pageCount: null },
        { id: 'ready-webp', mimeType: 'image/webp', byteSize: 1, pageCount: null },
      ]) {
        await expect(db.invoiceAttachment.create({ data: {
          ...valid, storageKey: `invoice-import/${valid.id}`, sha256: valid.id.padEnd(64, '0'),
          originalName: valid.id, state: 'READY', createdById: owner.id,
        } })).resolves.toMatchObject({ state: 'READY', ...valid })
      }

      for (const invalid of [
        { id: 'ready-zero', mimeType: 'application/pdf', byteSize: 0, pageCount: 1 },
        { id: 'ready-large', mimeType: 'application/pdf', byteSize: 10 * 1024 * 1024 + 1, pageCount: 1 },
        { id: 'ready-mime', mimeType: 'text/plain', byteSize: 1, pageCount: null },
        { id: 'ready-pdf-without-pages', mimeType: 'application/pdf', byteSize: 1, pageCount: null },
        { id: 'ready-pages', mimeType: 'application/pdf', byteSize: 1, pageCount: 11 },
        { id: 'ready-image-pages', mimeType: 'image/png', byteSize: 1, pageCount: 1 },
      ]) {
        await expect(db.invoiceAttachment.create({ data: {
          ...invalid, storageKey: `invoice-import/${invalid.id}`, sha256: invalid.id.padEnd(64, '0'),
          originalName: invalid.id, state: 'READY', createdById: owner.id,
        } })).rejects.toThrow()
      }
      await expect(db.invoiceImportDraft.update({ where: { id: draft.id }, data: { version: 0 } })).rejects.toThrow()
      await expect(db.invoiceImportDraft.update({ where: { id: draft.id }, data: { extractionRevision: -1 } })).rejects.toThrow()
      await expect(db.invoiceDraftAudit.update({ where: { id: audit.id }, data: { action: 'ALTERED' } })).rejects.toThrow()
      await expect(db.invoiceDraftAudit.delete({ where: { id: audit.id } })).rejects.toThrow()

      await db.$disconnect()
      db = new PrismaClient({ datasources: { db: { url: freshDatabaseUrl } } })
      const persistedDraft = await db.invoiceImportDraft.findUniqueOrThrow({
        where: { id: draft.id },
        include: { batch: true, attachment: true, latestAiJob: true, audits: true },
      })
      expect(persistedDraft).toMatchObject({
        id: 'draft-a', version: 1, extractionRevision: 0, dataJson: '{}', manualFieldsJson: '[]', state: 'OPEN',
        attachment: { id: 'attachment-a' }, latestAiJob: { id: 'invoice-job-a' },
      })
      expect(persistedDraft.audits).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'audit-a' })]))
      expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
      expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally {
      await db.$disconnect()
    }
  })

  it('upgrades the prior real migration chain without changing existing user, revenue, or AI job data', async () => {
    runMigrate(upgradeDatabaseUrl, createPriorPrismaDirectory())
    let db = new PrismaClient({ datasources: { db: { url: upgradeDatabaseUrl } } })
    try {
      await db.costCenter.create({ data: { id: 'upgrade-center', name: 'Upgrade Center' } })
      await db.user.create({ data: {
        id: 'upgrade-user', name: 'Upgrade User', email: 'upgrade@example.test', passwordHash: 'test-only', role: 'ADMIN',
      } })
      await db.revenue.create({ data: {
        id: 'upgrade-revenue', year: 2026, month: 9, amount: 1234.56, costCenterId: 'upgrade-center', channel: 'SALON',
      } })
      await db.aiJob.create({ data: {
        id: 'upgrade-ai-job', ownerUserId: 'upgrade-user', kind: 'FINANCE_CHAT', status: 'QUEUED', payloadJson: '{"question":"q","context":"c"}',
      } })
    } finally {
      await db.$disconnect()
    }

    runMigrate(upgradeDatabaseUrl)
    db = new PrismaClient({ datasources: { db: { url: upgradeDatabaseUrl } } })
    try {
      expect(await tableNames(db)).toHaveLength(4)
      await expect(db.user.findUniqueOrThrow({ where: { id: 'upgrade-user' } })).resolves.toMatchObject({ email: 'upgrade@example.test' })
      await expect(db.revenue.findUniqueOrThrow({ where: { id: 'upgrade-revenue' } })).resolves.toMatchObject({ amount: 1234.56 })
      await expect(db.aiJob.findUniqueOrThrow({ where: { id: 'upgrade-ai-job' } })).resolves.toMatchObject({ status: 'QUEUED' })
      expect(await db.ksefInvoice.count()).toBe(0)
      expect(await db.costEvent.count()).toBe(0)
      expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([])
      expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally {
      await db.$disconnect()
    }
  })
})
