import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { canAccessInstallationOrder } from '@/lib/installations/access'
import { createInstallationFormTemplate, createInstallationOrderFormSnapshot, publishInstallationFormTemplate } from '@/lib/installations/catalog-service'
import { createClientLink, loadPublicInstallationProjection } from '@/lib/installations/client-link'
import {
  approveInstallationMismatchForBilling,
  changeInstallationOwnership,
  createInstallationDelegation,
  createInstallationMismatch,
  createInstallationVisitFeePolicy,
  endInstallationDelegation,
  InstallationGovernanceValidationError,
  requestInstallationVisitFeeOverride,
  selectDefaultInstallationVisitFee,
} from '@/lib/installations/delegation-service'
import { autosaveClientForm, InstallationFormValidationError, submitClientForm } from '@/lib/installations/form-service'
import { createInstallationOrder, getInstallationOrder } from '@/lib/installations/order-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-governance-'))
const databasePath = path.join(databaseDirectory, 'governance.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let orderId: string
let ownerId: string
let backupId: string
let delegateId: string
let replacementOwnerId: string
let clientToken: string

function createDb() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

function applyMigrations() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], {
      cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

async function createClientFormLink(order: string) {
  const draft = await createInstallationFormTemplate(db, {
    name: `Formularz governance ${order}`,
    actorId: 'admin-user',
    questions: [{ key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true }],
  })
  const template = await publishInstallationFormTemplate(db, draft.id, 'admin-user')
  await createInstallationOrderFormSnapshot(db, { orderId: order, templateId: template.id }, 'admin-user')
  return (await createClientLink(db, { orderId: order, createdById: 'admin-user', expiresAt: new Date('2027-01-01') })).token
}

beforeAll(async () => {
  applyMigrations()
  db = createDb()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'GOV', name: 'Governance' } })
  const [owner, backup, delegate, replacement] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'governance.owner@example.test', position: 'Koordynatorka', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'governance.backup@example.test', position: 'Koordynator', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Delegatka', email: 'governance.delegate@example.test', position: 'Koordynatorka', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Dawid', lastName: 'Nowy', email: 'governance.replacement@example.test', position: 'Koordynator', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
  ])
  ownerId = owner.id
  backupId = backup.id
  delegateId = delegate.id
  replacementOwnerId = replacement.id
  const order = await createInstallationOrder(db, {
    client: { name: 'Marta Klientka', email: 'governance.client@example.test', phone: '+48 501 444 555' },
    address: { street: 'Poufna', buildingNumber: '9', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: owner.id,
    backupEmployeeId: backup.id,
  }, 'admin-user')
  orderId = order.id
  clientToken = await createClientFormLink(order.id)
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('audited ownership and delegation', () => {
  it('keeps two active distinct owners while a third employee temporarily takes over and loses access after an early end', async () => {
    const changed = await changeInstallationOwnership(db, orderId, {
      primaryEmployeeId: replacementOwnerId,
      backupEmployeeId: backupId,
    }, 'admin-user')
    expect(changed.primaryEmployeeId).toBe(replacementOwnerId)
    expect(changed.backupEmployeeId).toBe(backupId)

    const delegation = await createInstallationDelegation(db, orderId, {
      delegateEmployeeId: delegateId,
      startsAt: new Date('2026-08-20T08:00:00.000Z'),
      endsAt: new Date('2026-08-24T18:00:00.000Z'),
      reason: 'Planowane zastępstwo bez zależności od ewidencji urlopów.',
    }, 'admin-user')
    const delegatedOrder = await getInstallationOrder(db, orderId)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: delegateId, employeeActive: true }, delegatedOrder!, new Date('2026-08-22T12:00:00.000Z'))).toBe(true)

    await endInstallationDelegation(db, orderId, delegation.id, 'admin-user', new Date('2026-08-22T13:00:00.000Z'))
    const endedOrder = await getInstallationOrder(db, orderId)
    expect(canAccessInstallationOrder({ role: 'EMPLOYEE', employeeId: delegateId, employeeActive: true }, endedOrder!, new Date('2026-08-22T14:00:00.000Z'))).toBe(false)

    const audit = await db.installationAuditEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining([
      'INSTALLATION_OWNERS_CHANGED',
      'INSTALLATION_DELEGATION_CREATED',
      'INSTALLATION_DELEGATION_ENDED',
    ]))
    const ownershipAudit = audit.find((event) => event.action === 'INSTALLATION_OWNERS_CHANGED')!
    expect(ownershipAudit.actorId).toBe('admin-user')
    expect(JSON.parse(ownershipAudit.beforeJson!)).toMatchObject({ primaryEmployeeId: ownerId, backupEmployeeId: backupId })
    expect(JSON.parse(ownershipAudit.afterJson!)).toMatchObject({ primaryEmployeeId: replacementOwnerId, backupEmployeeId: backupId })
  })
})

describe('visit fee clause and documented mismatch', () => {
  it('does not make a legally unapproved policy selectable or visible to the client', async () => {
    await createInstallationVisitFeePolicy(db, {
      grossAmount: '199.00',
      clauseText: 'Projektowa klauzula oczekująca na zatwierdzenie prawne.',
      isDefault: true,
      legalApprovedAt: null,
    }, 'admin-user')

    await expect(selectDefaultInstallationVisitFee(db, orderId, 'owner-user')).rejects.toBeInstanceOf(InstallationGovernanceValidationError)
    const projection = await loadPublicInstallationProjection(db, clientToken)
    expect(projection.visitFee).toBeNull()
  })

  it('requires an explicit client acceptance of the approved amount, stores evidence, and needs coordinator approval before billing exists', async () => {
    const policy = await createInstallationVisitFeePolicy(db, {
      grossAmount: '249.90',
      clauseText: 'Jeżeli stan faktyczny odbiega od informacji potwierdzonych w formularzu, może obowiązywać opłata za bezskuteczny podjazd w zatwierdzonej kwocie.',
      isDefault: true,
      legalApprovedAt: new Date('2026-08-20T10:00:00.000Z'),
    }, 'admin-user')
    await selectDefaultInstallationVisitFee(db, orderId, 'owner-user')
    const projection = await loadPublicInstallationProjection(db, clientToken)
    expect(projection.visitFee).toMatchObject({ grossAmount: '249.90', clauseVersion: policy.version, clientAcceptedAt: null })
    const saved = await autosaveClientForm(db, clientToken, {
      revisionNumber: projection.submission.revisionNumber,
      draftVersion: projection.submission.draftVersion,
      clientMutationId: 'governance-answer-before-submit-0001',
      answers: [{ questionKey: 'glify', value: 'NO' }],
    })

    await expect(submitClientForm(db, clientToken, {
      revisionNumber: saved.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'governance-submit-without-fee-0001',
    })).rejects.toMatchObject({ fieldErrors: { visitFeeAccepted: expect.any(String) } } satisfies Partial<InstallationFormValidationError>)

    const submitted = await submitClientForm(db, clientToken, {
      revisionNumber: saved.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'governance-submit-with-fee-0001',
      visitFeeAccepted: true,
      clientIp: '203.0.113.44',
      clientUserAgent: 'WallDecor governance test',
    })
    expect(submitted.status).toBe('SUBMITTED')
    const order = await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.visitFeeClientAcceptedAt).not.toBeNull()
    expect(order.visitFeeClientIpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(order.visitFeeClientIpHash).not.toContain('203.0.113.44')
    expect(order.visitFeeClientUserAgent).toBe('WallDecor governance test')

    const mismatch = await createInstallationMismatch(db, orderId, {
      description: 'Glif przy drzwiach ukrytych nie odpowiada opisowi z formularza.',
      reason: 'CANNOT_PERFORM',
      evidenceReference: 'installation-file:pending-task5-proof',
    }, 'installer-user')
    expect(await db.installationBillingTask.count({ where: { mismatchId: mismatch.id } })).toBe(0)
    await approveInstallationMismatchForBilling(db, orderId, mismatch.id, { note: 'Potwierdzone przez koordynatora.' }, 'owner-user')
    expect(await db.installationBillingTask.count({ where: { mismatchId: mismatch.id } })).toBe(1)
  })

  it('records another amount as pending until an administrator or manager approves it', async () => {
    const order = await createInstallationOrder(db, {
      client: { name: 'Inny klient', email: 'other.governance.client@example.test', phone: '+48 502 444 555' },
      address: { street: 'Testowa', buildingNumber: '8', postalCode: '00-002', city: 'Warszawa' },
      primaryEmployeeId: replacementOwnerId,
      backupEmployeeId: backupId,
    }, 'admin-user')
    await requestInstallationVisitFeeOverride(db, order.id, { grossAmount: '319.00', reason: 'Dojazd poza standardowym obszarem.' }, 'owner-user')
    const pending = await db.installationOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(pending.visitFeeStatus).toBe('PENDING_APPROVAL')
    expect(pending.visitFeeApprovedAt).toBeNull()
  })

  it('does not allow a dangling policy relation or an unapproved visit-fee billing shortcut', async () => {
    await expect(db.installationOrder.update({
      where: { id: orderId },
      data: { visitFeePolicyId: 'policy-that-does-not-exist' },
    })).rejects.toBeTruthy()

    const feeOrder = await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
    await expect(db.installationBillingTask.create({
      data: {
        orderId,
        mismatchId: null,
        kind: 'MISMATCH_VISIT_FEE',
        status: 'PENDING',
        grossAmount: feeOrder.visitFeeGrossAmount!,
        description: 'Próba ominięcia zatwierdzenia niezgodności.',
        createdById: 'owner-user',
      },
    })).rejects.toBeTruthy()
  })
})
