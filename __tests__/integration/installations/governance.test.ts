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
  approveInstallationVisitFeeOverride,
  changeInstallationOwnership,
  createInstallationDelegation,
  createInstallationMismatch,
  createInstallationVisitFeePolicy,
  endInstallationDelegation,
  InstallationGovernanceValidationError,
  requestInstallationVisitFeeOverride,
  selectDefaultInstallationVisitFee,
} from '@/lib/installations/delegation-service'
import { acceptClientVisitFee, autosaveClientForm, InstallationFormValidationError, InstallationVisitFeeAcceptanceConflictError, submitClientForm } from '@/lib/installations/form-service'
import { createInstallationOrder, getInstallationOrder } from '@/lib/installations/order-service'
import { getInstallationReadiness } from '@/lib/installations/readiness'

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
let previousIpHashSecret: string | undefined
let protectedOrderId: string
let protectedMismatchForCompletenessId: string
let protectedMismatchForBillingId: string
let futureProtectedOrderId: string
let futureProtectedMismatchForInsertId: string
let futureProtectedBillingId: string

const durabilityMigration = '20260823020000_installation_governance_durability'
const acceptanceIntegrityMigration = '20260823030000_installation_fee_acceptance_integrity'
const privateMediaMigration = '20260823040000_installation_private_media'
const mobileHandoffRetryMigration = '20260823050000_mobile_handoff_retry_release'
const remoteDeleteLifecycleMigration = '20260823060000_installation_remote_delete_lifecycle'
const hardeningMigrations = new Set([durabilityMigration, acceptanceIntegrityMigration, privateMediaMigration, mobileHandoffRetryMigration, remoteDeleteLifecycleMigration])
const dayMs = 24 * 60 * 60 * 1000

function futureDate(days = 30) {
  return new Date(Date.now() + days * dayMs)
}

function createDb() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

function applyMigrations(filter: (directory: string) => boolean = () => true) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort()
    .filter(filter)
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
  return (await createClientLink(db, { orderId: order, createdById: 'admin-user', expiresAt: futureDate() })).token
}

beforeAll(async () => {
  previousIpHashSecret = process.env.INSTALLATION_IP_HASH_SECRET
  process.env.INSTALLATION_IP_HASH_SECRET = 'governance-integration-test-only-secret'
  // Seed two legitimate legacy VERIFIED rows before the Task 4 hardening
  // migration. Task 5 will eventually own the real transition to VERIFIED;
  // these fixtures let us prove existing billing guards and new immutability
  // without giving current generic code a verification back door.
  applyMigrations((directory) => !hardeningMigrations.has(directory))
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
  const protectedOrder = await createInstallationOrder(db, {
    client: { name: 'Kontrola migawki', email: 'snapshot.governance.client@example.test', phone: '+48 504 444 555' },
    address: { street: 'Testowa', buildingNumber: '9', postalCode: '00-004', city: 'Warszawa' },
    primaryEmployeeId: replacement.id,
    backupEmployeeId: backup.id,
  }, 'admin-user')
  protectedOrderId = protectedOrder.id
  const protectedPolicy = await db.installationVisitFeePolicy.create({ data: {
    version: 900,
    grossAmount: '249.90',
    clauseText: 'Historyczna zatwierdzona klauzula używana wyłącznie do testu trwałości rozliczenia.',
    legalApprovedAt: new Date('2026-08-20T10:00:00.000Z'),
    legalApprovedById: 'legacy-admin',
    isDefault: false,
    createdById: 'legacy-admin',
  } })
  await db.installationOrder.update({ where: { id: protectedOrder.id }, data: {
    visitFeePolicyId: protectedPolicy.id,
    visitFeeStatus: 'APPROVED',
    visitFeeGrossAmount: protectedPolicy.grossAmount,
    visitFeeClauseText: protectedPolicy.clauseText,
    visitFeeClauseVersion: protectedPolicy.version,
    visitFeeLegalApprovedAt: protectedPolicy.legalApprovedAt,
    visitFeeSelectedById: 'legacy-owner',
    visitFeeSelectedAt: new Date('2026-08-23T08:58:00.000Z'),
    visitFeeApprovedById: 'legacy-admin',
    visitFeeApprovedAt: new Date('2026-08-23T08:59:00.000Z'),
    visitFeeClientAcceptedAt: new Date('2026-08-23T09:00:00.000Z'),
    visitFeeClientIpHash: 'hmac-sha256:v1:legacy-test-value',
    visitFeeClientUserAgent: 'Legacy governance integrity test',
  } })
  const legacyMismatchData = {
    orderId: protectedOrder.id,
    description: 'Zweryfikowany prywatny dowód niezgodności utworzony przed migracją ochronną.',
    reason: 'CANNOT_PERFORM',
    evidenceReference: 'private-file:legacy-task5-verification',
    evidenceStatus: 'VERIFIED_PRIVATE_FILE',
    evidenceFileId: 'private-file-verified-before-hardening',
    evidenceVerifiedAt: new Date('2026-08-23T09:01:00.000Z'),
    reportedById: 'installer-user',
    coordinatorApprovedAt: new Date('2026-08-23T09:02:00.000Z'),
    coordinatorApprovedById: 'owner-user',
  }
  protectedMismatchForCompletenessId = (await db.installationMismatch.create({ data: legacyMismatchData })).id
  protectedMismatchForBillingId = (await db.installationMismatch.create({ data: {
    ...legacyMismatchData,
    evidenceReference: 'private-file:legacy-task5-verification-billing',
    evidenceFileId: 'private-file-verified-before-hardening-billing',
  } })).id
  const futureOrder = await createInstallationOrder(db, {
    client: { name: 'Kontrola przyszłej daty', email: 'future.snapshot@example.test', phone: '+48 505 444 555' },
    address: { street: 'Testowa', buildingNumber: '10', postalCode: '00-005', city: 'Warszawa' },
    primaryEmployeeId: replacement.id,
    backupEmployeeId: backup.id,
  }, 'admin-user')
  futureProtectedOrderId = futureOrder.id
  const futurePolicy = await db.installationVisitFeePolicy.create({ data: {
    version: 901,
    grossAmount: '289.90',
    clauseText: 'Historyczna klauzula z błędną przyszłą datą używana do testu ochrony billingowej.',
    legalApprovedAt: new Date('2099-01-01T00:00:00.000Z'),
    legalApprovedById: 'legacy-admin',
    isDefault: false,
    createdById: 'legacy-admin',
  } })
  await db.installationOrder.update({ where: { id: futureOrder.id }, data: {
    visitFeePolicyId: futurePolicy.id,
    visitFeeStatus: 'APPROVED',
    visitFeeGrossAmount: futurePolicy.grossAmount,
    visitFeeClauseText: futurePolicy.clauseText,
    visitFeeClauseVersion: futurePolicy.version,
    visitFeeLegalApprovedAt: futurePolicy.legalApprovedAt,
    visitFeeClientAcceptedAt: new Date('2026-08-23T09:10:00.000Z'),
  } })
  const futureMismatchData = {
    orderId: futureOrder.id,
    description: 'Historyczny dowód dla ochrony billingowej przed przyszłą datą prawną.',
    reason: 'CANNOT_PERFORM',
    evidenceReference: 'private-file:legacy-future-legal',
    evidenceStatus: 'VERIFIED_PRIVATE_FILE',
    evidenceFileId: 'private-file-future-legal',
    evidenceVerifiedAt: new Date('2026-08-23T09:11:00.000Z'),
    reportedById: 'installer-user',
    coordinatorApprovedAt: new Date('2026-08-23T09:12:00.000Z'),
    coordinatorApprovedById: 'owner-user',
  }
  const futureMismatchForLegacyBilling = await db.installationMismatch.create({ data: futureMismatchData })
  futureProtectedMismatchForInsertId = (await db.installationMismatch.create({ data: {
    ...futureMismatchData,
    evidenceReference: 'private-file:legacy-future-legal-insert',
    evidenceFileId: 'private-file-future-legal-insert',
  } })).id
  futureProtectedBillingId = (await db.installationBillingTask.create({ data: {
    orderId: futureOrder.id,
    mismatchId: futureMismatchForLegacyBilling.id,
    kind: 'MISMATCH_VISIT_FEE',
    status: 'PENDING',
    grossAmount: futurePolicy.grossAmount,
    description: 'Historyczny billing z przyszłą datą przed migracją ochronną.',
    createdById: 'legacy-admin',
  } })).id
  await db.$disconnect()
  applyMigrations((directory) => hardeningMigrations.has(directory))
  db = createDb()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  clientToken = await createClientFormLink(order.id)
})

afterAll(async () => {
  await db?.$disconnect()
  if (previousIpHashSecret === undefined) delete process.env.INSTALLATION_IP_HASH_SECRET
  else process.env.INSTALLATION_IP_HASH_SECRET = previousIpHashSecret
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

  it('rejects future legal approval and defensively hides a future-dated direct snapshot', async () => {
    await expect(createInstallationVisitFeePolicy(db, {
      grossAmount: '209.00',
      clauseText: 'Klauzula z niemożliwą datą zatwierdzenia prawnego w przyszłości.',
      isDefault: true,
      legalApprovedAt: new Date('2099-01-01T00:00:00.000Z'),
    }, 'admin-user')).rejects.toBeInstanceOf(InstallationGovernanceValidationError)

    await db.installationVisitFeePolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    const futurePolicy = await db.installationVisitFeePolicy.create({ data: {
      version: 99,
      grossAmount: '209.00',
      clauseText: 'Klauzula zapisana bezpośrednio z przyszłą datą, której serwis nie może aktywować.',
      legalApprovedAt: new Date('2099-01-01T00:00:00.000Z'),
      isDefault: true,
      createdById: 'legacy-import',
    } })
    await expect(selectDefaultInstallationVisitFee(db, orderId, 'owner-user')).rejects.toBeInstanceOf(InstallationGovernanceValidationError)
    await db.installationOrder.update({ where: { id: orderId }, data: {
      visitFeePolicyId: futurePolicy.id,
      visitFeeStatus: 'APPROVED',
      visitFeeGrossAmount: futurePolicy.grossAmount,
      visitFeeClauseText: futurePolicy.clauseText,
      visitFeeClauseVersion: futurePolicy.version,
      visitFeeLegalApprovedAt: futurePolicy.legalApprovedAt,
    } })
    expect((await loadPublicInstallationProjection(db, clientToken)).visitFee).toBeNull()
  })

  it('blocks readiness after a submitted form when an approved legal fee is selected but not yet accepted', async () => {
    const order = await createInstallationOrder(db, {
      client: { name: 'Klientka po formularzu', email: 'fee-after-submit@example.test', phone: '+48 503 111 222' },
      address: { street: 'Testowa', buildingNumber: '3', postalCode: '00-003', city: 'Warszawa' },
      primaryEmployeeId: replacementOwnerId,
      backupEmployeeId: backupId,
    }, 'admin-user')
    const token = await createClientFormLink(order.id)
    const initial = await loadPublicInstallationProjection(db, token)
    const saved = await autosaveClientForm(db, token, {
      revisionNumber: initial.submission.revisionNumber,
      draftVersion: initial.submission.draftVersion,
      clientMutationId: 'fee-after-submit-answer-0001',
      answers: [{ questionKey: 'glify', value: 'NO' }],
    })
    await submitClientForm(db, token, {
      revisionNumber: saved.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'fee-after-submit-submit-0001',
    })
    await createInstallationVisitFeePolicy(db, {
      grossAmount: '279.90',
      clauseText: 'Po wysłaniu formularza wybrano prawnie zatwierdzoną informację o możliwej opłacie za bezskuteczny podjazd.',
      isDefault: true,
      legalApprovedAt: new Date('2026-08-21T10:00:00.000Z'),
    }, 'admin-user')
    await selectDefaultInstallationVisitFee(db, order.id, 'owner-user')

    expect(await getInstallationReadiness(db, order.id)).toMatchObject({
      isReady: false,
      submittedCount: 1,
      visitFeeAcceptanceRequired: true,
    })

    const feeProjection = await loadPublicInstallationProjection(db, token)
    await db.installationOrder.update({ where: { id: order.id }, data: {
      visitFeeClauseText: `${feeProjection.visitFee!.clauseText} Doprecyzowanie bez zmiany kwoty ani wersji.`,
    } })
    await expect(acceptClientVisitFee(db, token, {
      accepted: true,
      snapshotDigest: feeProjection.visitFee!.snapshotDigest,
      clientIp: null,
      clientUserAgent: 'WallDecor stale post-submit snapshot test',
    })).rejects.toBeInstanceOf(InstallationVisitFeeAcceptanceConflictError)
    expect((await db.installationOrder.findUniqueOrThrow({ where: { id: order.id } })).visitFeeClientAcceptedAt).toBeNull()
    const refreshedFeeProjection = await loadPublicInstallationProjection(db, token)
    const [firstAcceptance, secondAcceptance] = await Promise.all([
      acceptClientVisitFee(db, token, {
        accepted: true,
        snapshotDigest: refreshedFeeProjection.visitFee!.snapshotDigest,
        clientIp: '203.0.113.55',
        clientUserAgent: 'WallDecor post-submit fee acceptance test A',
      }),
      acceptClientVisitFee(db, token, {
        accepted: true,
        snapshotDigest: refreshedFeeProjection.visitFee!.snapshotDigest,
        clientIp: '203.0.113.56',
        clientUserAgent: 'WallDecor post-submit fee acceptance test B',
      }),
    ])
    expect(firstAcceptance.acceptedAt).toEqual(secondAcceptance.acceptedAt)
    const feeAcceptanceAudits = await db.installationAuditEvent.findMany({
      where: { orderId: order.id, action: 'INSTALLATION_VISIT_FEE_CLIENT_ACCEPTED' },
    })
    expect(feeAcceptanceAudits).toHaveLength(1)
    expect(feeAcceptanceAudits[0].actorId).toBe('PUBLIC_CLIENT')
    expect(feeAcceptanceAudits[0].afterJson).toContain('279.90')
    expect(feeAcceptanceAudits[0].afterJson).not.toContain('203.0.113.')
    expect(feeAcceptanceAudits[0].afterJson).not.toContain(token)
    expect(await getInstallationReadiness(db, order.id)).toMatchObject({
      isReady: true,
      visitFeeAcceptanceRequired: false,
    })
  })

  it('requires an explicit client acceptance of the approved amount, and coordinator approval waits for a Task 5 verified private file before billing', async () => {
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

    const staleDigest = projection.visitFee!.snapshotDigest
    await db.installationOrder.update({ where: { id: orderId }, data: {
      visitFeeClauseText: `${projection.visitFee!.clauseText} Doprecyzowana treść bez zmiany kwoty ani wersji.`,
    } })
    await expect(submitClientForm(db, clientToken, {
      revisionNumber: saved.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'governance-submit-stale-fee-0001',
      visitFeeAccepted: true,
      visitFeeSnapshotDigest: staleDigest,
    })).rejects.toBeInstanceOf(InstallationVisitFeeAcceptanceConflictError)
    expect((await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })).visitFeeClientAcceptedAt).toBeNull()
    expect((await loadPublicInstallationProjection(db, clientToken)).submission.status).toBe('DRAFT')

    const refreshedProjection = await loadPublicInstallationProjection(db, clientToken)

    const submitted = await submitClientForm(db, clientToken, {
      revisionNumber: saved.revisionNumber,
      draftVersion: saved.draftVersion,
      clientMutationId: 'governance-submit-with-fee-0001',
      visitFeeAccepted: true,
      visitFeeSnapshotDigest: refreshedProjection.visitFee!.snapshotDigest,
      clientIp: '203.0.113.44',
      clientUserAgent: 'WallDecor governance test',
    })
    expect(submitted.status).toBe('SUBMITTED')
    const order = await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.visitFeeClientAcceptedAt).not.toBeNull()
    expect(order.visitFeeClientIpHash).toMatch(/^hmac-sha256:v1:[a-f0-9]{64}$/)
    expect(order.visitFeeClientIpHash).not.toContain('203.0.113.44')
    expect(order.visitFeeClientUserAgent).toBe('WallDecor governance test')

    const mismatch = await createInstallationMismatch(db, orderId, {
      description: 'Glif przy drzwiach ukrytych nie odpowiada opisowi z formularza.',
      reason: 'CANNOT_PERFORM',
      evidenceReference: 'installation-report:awaiting-private-file',
    }, 'installer-user')
    expect(mismatch.evidenceStatus).toBe('PENDING_PRIVATE_FILE')
    expect(await db.installationBillingTask.count({ where: { mismatchId: mismatch.id } })).toBe(0)
    const approval = await approveInstallationMismatchForBilling(db, orderId, mismatch.id, { note: 'Potwierdzone przez koordynatora.' }, {
      userId: 'owner-user', role: 'EMPLOYEE', employeeId: replacementOwnerId, employeeActive: true,
    })
    expect(approval.status).toBe('AWAITING_VERIFIED_PRIVATE_FILE')
    expect(await db.installationBillingTask.count({ where: { mismatchId: mismatch.id } })).toBe(0)
    expect(await db.installationMismatch.findUniqueOrThrow({ where: { id: mismatch.id } })).toMatchObject({
      coordinatorApprovedAt: expect.any(Date),
      evidenceStatus: 'PENDING_PRIVATE_FILE',
      evidenceFileId: null,
    })
    await expect(approveInstallationMismatchForBilling(db, orderId, mismatch.id, { note: 'Próba obcego użytkownika.' }, {
      userId: 'attacker-user', role: 'EMPLOYEE', employeeId: delegateId, employeeActive: true,
    })).rejects.toBeInstanceOf(InstallationGovernanceValidationError)
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
    await db.installationOrder.update({ where: { id: order.id }, data: { visitFeeLegalApprovedAt: new Date('2099-01-01T00:00:00.000Z') } })
    await expect(approveInstallationVisitFeeOverride(db, order.id, 'admin-user')).rejects.toBeInstanceOf(InstallationGovernanceValidationError)
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

  it('does not let generic Task 4 code manufacture Task 5 verified private evidence', async () => {
    const mismatch = await createInstallationMismatch(db, orderId, {
      description: 'Dowód nadal oczekuje na prywatny plik obsługiwany dopiero przez Task 5.',
      reason: 'EXECUTION_RISK',
      evidenceReference: 'installation-report:private-file-pending',
    }, 'installer-user')

    await expect(db.installationMismatch.update({ where: { id: mismatch.id }, data: {
      evidenceStatus: 'VERIFIED_PRIVATE_FILE',
      evidenceFileId: 'manufactured-without-task5',
      evidenceVerifiedAt: new Date(),
    } })).rejects.toBeTruthy()
    await expect(db.installationMismatch.create({ data: {
      orderId,
      description: 'Bezpośredni insert nie może udawać dowodu z prywatnego repozytorium Task 5.',
      reason: 'EXECUTION_RISK',
      evidenceReference: 'private-file:manufactured-insert',
      evidenceStatus: 'VERIFIED_PRIVATE_FILE',
      evidenceFileId: 'manufactured-insert',
      evidenceVerifiedAt: new Date(),
      reportedById: 'attacker-user',
    } })).rejects.toBeTruthy()
  })

  it('invalidates every acceptance-evidence field atomically before an accepted legal snapshot can change', async () => {
    const accepted = await db.installationOrder.findUniqueOrThrow({ where: { id: protectedOrderId } })
    const changedClause = `${accepted.visitFeeClauseText} Zmieniona dopiero po unieważnieniu akceptacji.`

    await expect(db.installationOrder.update({ where: { id: protectedOrderId }, data: {
      visitFeeClauseText: changedClause,
    } })).rejects.toBeTruthy()
    await expect(db.installationOrder.update({ where: { id: protectedOrderId }, data: {
      visitFeeClauseText: changedClause,
      visitFeeClientAcceptedAt: null,
    } })).rejects.toBeTruthy()

    const cleared = await db.installationOrder.update({ where: { id: protectedOrderId }, data: {
      visitFeeClauseText: changedClause,
      visitFeeClientAcceptedAt: null,
      visitFeeClientIpHash: null,
      visitFeeClientUserAgent: null,
    } })
    expect(cleared).toMatchObject({
      visitFeeClauseText: changedClause,
      visitFeeClientAcceptedAt: null,
      visitFeeClientIpHash: null,
      visitFeeClientUserAgent: null,
    })

    await db.installationOrder.update({ where: { id: protectedOrderId }, data: {
      visitFeeClauseText: accepted.visitFeeClauseText,
      visitFeeClientAcceptedAt: accepted.visitFeeClientAcceptedAt,
      visitFeeClientIpHash: accepted.visitFeeClientIpHash,
      visitFeeClientUserAgent: accepted.visitFeeClientUserAgent,
    } })
  })

  it('rejects direct insert and update billing when the order legal approval is still in the future', async () => {
    const futureOrder = await db.installationOrder.findUniqueOrThrow({ where: { id: futureProtectedOrderId } })
    await expect(db.installationBillingTask.create({ data: {
      orderId: futureProtectedOrderId,
      mismatchId: futureProtectedMismatchForInsertId,
      kind: 'MISMATCH_VISIT_FEE',
      status: 'PENDING',
      grossAmount: futureOrder.visitFeeGrossAmount!,
      description: 'Próba insertu billing z przyszłą datą zatwierdzenia prawnego.',
      createdById: 'attacker-user',
    } })).rejects.toBeTruthy()
    await expect(db.installationBillingTask.update({ where: { id: futureProtectedBillingId }, data: {
      description: 'Próba aktualizacji historycznego billing z przyszłą datą prawną.',
    } })).rejects.toBeTruthy()
  })

  it('keeps direct billing behind verified private evidence and every approved fee snapshot field', async () => {
    const complete = await db.installationOrder.findUniqueOrThrow({ where: { id: protectedOrderId } })
    const acceptanceEvidence = {
      visitFeeClientAcceptedAt: complete.visitFeeClientAcceptedAt,
      visitFeeClientIpHash: complete.visitFeeClientIpHash,
      visitFeeClientUserAgent: complete.visitFeeClientUserAgent,
    }
    const billingData = {
      orderId: protectedOrderId,
      mismatchId: protectedMismatchForCompletenessId,
      kind: 'MISMATCH_VISIT_FEE',
      status: 'PENDING',
      grossAmount: complete.visitFeeGrossAmount!,
      description: 'Próba utworzenia zadania rozliczeniowego z niepełną migawką.',
      createdById: 'owner-user',
    }
    const rejectDirectBilling = () => expect(db.installationBillingTask.create({ data: billingData })).rejects.toBeTruthy()
    const changeAcceptedSnapshot = async (data: Parameters<typeof db.installationOrder.update>[0]['data']) => {
      await db.installationOrder.update({ where: { id: protectedOrderId }, data: {
        ...data,
        visitFeeClientAcceptedAt: null,
        visitFeeClientIpHash: null,
        visitFeeClientUserAgent: null,
      } })
      await db.installationOrder.update({ where: { id: protectedOrderId }, data: acceptanceEvidence })
    }

    await changeAcceptedSnapshot({ visitFeePolicyId: null })
    await rejectDirectBilling()
    await changeAcceptedSnapshot({ visitFeePolicyId: complete.visitFeePolicyId! })

    await changeAcceptedSnapshot({ visitFeeGrossAmount: null })
    await rejectDirectBilling()
    await changeAcceptedSnapshot({ visitFeeGrossAmount: complete.visitFeeGrossAmount! })

    await changeAcceptedSnapshot({ visitFeeClauseText: '   ' })
    await rejectDirectBilling()
    await changeAcceptedSnapshot({ visitFeeClauseText: complete.visitFeeClauseText! })

    await changeAcceptedSnapshot({ visitFeeClauseVersion: null })
    await rejectDirectBilling()
    await changeAcceptedSnapshot({ visitFeeClauseVersion: complete.visitFeeClauseVersion! })

    await changeAcceptedSnapshot({ visitFeeLegalApprovedAt: null })
    await rejectDirectBilling()
    await changeAcceptedSnapshot({ visitFeeLegalApprovedAt: complete.visitFeeLegalApprovedAt! })

    await db.installationOrder.update({ where: { id: protectedOrderId }, data: {
      visitFeeClientAcceptedAt: null,
      visitFeeClientIpHash: null,
      visitFeeClientUserAgent: null,
    } })
    await rejectDirectBilling()
    await db.installationOrder.update({ where: { id: protectedOrderId }, data: acceptanceEvidence })

    await expect(db.installationBillingTask.create({ data: { ...billingData, grossAmount: '1.00' } })).rejects.toBeTruthy()

    await db.installationMismatch.update({ where: { id: protectedMismatchForCompletenessId }, data: { evidenceStatus: 'PENDING_PRIVATE_FILE', evidenceFileId: null, evidenceVerifiedAt: null } })
    await rejectDirectBilling()

    await expect(db.installationVisitFeePolicy.update({
      where: { id: complete.visitFeePolicyId! },
      data: { clauseText: 'Zmiana historycznej klauzuli po zapisaniu jej na karcie montażu.' },
    })).rejects.toBeTruthy()

    await expect(db.installationBillingTask.create({ data: {
      ...billingData,
      mismatchId: protectedMismatchForBillingId,
      description: 'Historyczny rekord bez rzeczywistego mostka Task 5 nie może utworzyć nowego rozliczenia.',
    } })).rejects.toBeTruthy()
  })
})
