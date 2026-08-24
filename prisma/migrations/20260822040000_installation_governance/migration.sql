-- Versioned, legally gated visit-fee configuration and immutable per-order snapshot.
CREATE TABLE "InstallationVisitFeePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "grossAmount" DECIMAL NOT NULL,
    "clauseText" TEXT NOT NULL,
    "legalApprovedAt" DATETIME,
    "legalApprovedById" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "InstallationVisitFeePolicy_version_key" ON "InstallationVisitFeePolicy"("version");
CREATE INDEX "InstallationVisitFeePolicy_isDefault_archivedAt_idx" ON "InstallationVisitFeePolicy"("isDefault", "archivedAt");
CREATE INDEX "InstallationVisitFeePolicy_legalApprovedAt_idx" ON "InstallationVisitFeePolicy"("legalApprovedAt");
CREATE UNIQUE INDEX "InstallationVisitFeePolicy_one_active_default"
ON "InstallationVisitFeePolicy"("isDefault")
WHERE "isDefault" = true AND "archivedAt" IS NULL;

ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeePolicyId" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeGrossAmount" DECIMAL;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeClauseText" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeClauseVersion" INTEGER;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeLegalApprovedAt" DATETIME;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeSelectedById" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeSelectedAt" DATETIME;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeOverrideReason" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeApprovedById" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeApprovedAt" DATETIME;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeClientAcceptedAt" DATETIME;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeClientIpHash" TEXT;
ALTER TABLE "InstallationOrder" ADD COLUMN "visitFeeClientUserAgent" TEXT;
CREATE INDEX "InstallationOrder_visitFeeStatus_idx" ON "InstallationOrder"("visitFeeStatus");

-- SQLite cannot add a foreign key through ALTER TABLE without rebuilding the
-- live parent table. These guards provide the same safe boundary for this
-- additive migration: no dangling policy can be written and referenced policy
-- rows cannot be changed or removed underneath historic order snapshots.
CREATE TRIGGER "InstallationOrder_visitFeePolicy_insert_guard"
BEFORE INSERT ON "InstallationOrder"
WHEN NEW."visitFeePolicyId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "InstallationVisitFeePolicy" WHERE "id" = NEW."visitFeePolicyId")
BEGIN
  SELECT RAISE(ABORT, 'installation visit-fee policy does not exist');
END;

CREATE TRIGGER "InstallationOrder_visitFeePolicy_update_guard"
BEFORE UPDATE OF "visitFeePolicyId" ON "InstallationOrder"
WHEN NEW."visitFeePolicyId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "InstallationVisitFeePolicy" WHERE "id" = NEW."visitFeePolicyId")
BEGIN
  SELECT RAISE(ABORT, 'installation visit-fee policy does not exist');
END;

CREATE TRIGGER "InstallationVisitFeePolicy_referenced_delete_guard"
BEFORE DELETE ON "InstallationVisitFeePolicy"
WHEN EXISTS (SELECT 1 FROM "InstallationOrder" WHERE "visitFeePolicyId" = OLD."id")
BEGIN
  SELECT RAISE(ABORT, 'referenced installation visit-fee policy cannot be deleted');
END;

CREATE TRIGGER "InstallationVisitFeePolicy_referenced_id_update_guard"
BEFORE UPDATE OF "id" ON "InstallationVisitFeePolicy"
WHEN EXISTS (SELECT 1 FROM "InstallationOrder" WHERE "visitFeePolicyId" = OLD."id")
BEGIN
  SELECT RAISE(ABORT, 'referenced installation visit-fee policy id cannot change');
END;

CREATE TABLE "InstallationMismatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coordinatorApprovedById" TEXT,
    "coordinatorApprovedAt" DATETIME,
    "approvalNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationMismatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InstallationMismatch_orderId_reportedAt_idx" ON "InstallationMismatch"("orderId", "reportedAt");
CREATE INDEX "InstallationMismatch_coordinatorApprovedAt_idx" ON "InstallationMismatch"("coordinatorApprovedAt");

CREATE TABLE "InstallationBillingTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "mismatchId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "grossAmount" DECIMAL NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationBillingTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationBillingTask_mismatchId_fkey" FOREIGN KEY ("mismatchId") REFERENCES "InstallationMismatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationBillingTask_mismatchId_key" ON "InstallationBillingTask"("mismatchId");
CREATE INDEX "InstallationBillingTask_orderId_status_idx" ON "InstallationBillingTask"("orderId", "status");

CREATE TRIGGER "InstallationBillingTask_mismatch_approval_guard"
BEFORE INSERT ON "InstallationBillingTask"
WHEN NEW."kind" = 'MISMATCH_VISIT_FEE'
  AND (
    NEW."mismatchId" IS NULL
    OR NOT EXISTS (
    SELECT 1
    FROM "InstallationMismatch" mismatch
    JOIN "InstallationOrder" installation_order ON installation_order."id" = mismatch."orderId"
    WHERE mismatch."id" = NEW."mismatchId"
      AND mismatch."orderId" = NEW."orderId"
      AND mismatch."coordinatorApprovedAt" IS NOT NULL
      AND installation_order."visitFeeStatus" = 'APPROVED'
      AND installation_order."visitFeeLegalApprovedAt" IS NOT NULL
      AND installation_order."visitFeeClientAcceptedAt" IS NOT NULL
      AND NEW."grossAmount" = installation_order."visitFeeGrossAmount"
  )
  )
BEGIN
  SELECT RAISE(ABORT, 'Installation billing requires an approved mismatch and accepted visit-fee clause');
END;

CREATE TRIGGER "InstallationBillingTask_mismatch_approval_update_guard"
BEFORE UPDATE OF "orderId", "mismatchId", "kind", "grossAmount" ON "InstallationBillingTask"
WHEN NEW."kind" = 'MISMATCH_VISIT_FEE'
  AND (
    NEW."mismatchId" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "InstallationMismatch" mismatch
      JOIN "InstallationOrder" installation_order ON installation_order."id" = mismatch."orderId"
      WHERE mismatch."id" = NEW."mismatchId"
        AND mismatch."orderId" = NEW."orderId"
        AND mismatch."coordinatorApprovedAt" IS NOT NULL
        AND installation_order."visitFeeStatus" = 'APPROVED'
        AND installation_order."visitFeeLegalApprovedAt" IS NOT NULL
        AND installation_order."visitFeeClientAcceptedAt" IS NOT NULL
        AND NEW."grossAmount" = installation_order."visitFeeGrossAmount"
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Installation billing requires an approved mismatch and accepted visit-fee clause');
END;
