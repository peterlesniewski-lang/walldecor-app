-- Task 5 will attach a private-media file and mark this record VERIFIED.
-- Until then, a report can be reviewed but can never become a billing task.
ALTER TABLE "InstallationMismatch" ADD COLUMN "evidenceStatus" TEXT NOT NULL DEFAULT 'PENDING_PRIVATE_FILE';
ALTER TABLE "InstallationMismatch" ADD COLUMN "evidenceFileId" TEXT;
ALTER TABLE "InstallationMismatch" ADD COLUMN "evidenceVerifiedAt" DATETIME;
CREATE INDEX "InstallationMismatch_evidenceStatus_idx" ON "InstallationMismatch"("evidenceStatus");

DROP TRIGGER "InstallationBillingTask_mismatch_approval_guard";
DROP TRIGGER "InstallationBillingTask_mismatch_approval_update_guard";

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
        AND mismatch."evidenceStatus" = 'VERIFIED_PRIVATE_FILE'
        AND mismatch."evidenceFileId" IS NOT NULL
        AND mismatch."evidenceVerifiedAt" IS NOT NULL
        AND installation_order."visitFeeStatus" = 'APPROVED'
        AND installation_order."visitFeePolicyId" IS NOT NULL
        AND installation_order."visitFeeGrossAmount" IS NOT NULL
        AND length(trim(COALESCE(installation_order."visitFeeClauseText", ''))) > 0
        AND installation_order."visitFeeClauseVersion" IS NOT NULL
        AND installation_order."visitFeeLegalApprovedAt" IS NOT NULL
        AND installation_order."visitFeeClientAcceptedAt" IS NOT NULL
        AND NEW."grossAmount" = installation_order."visitFeeGrossAmount"
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Installation billing requires verified private evidence and a complete accepted visit-fee snapshot');
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
        AND mismatch."evidenceStatus" = 'VERIFIED_PRIVATE_FILE'
        AND mismatch."evidenceFileId" IS NOT NULL
        AND mismatch."evidenceVerifiedAt" IS NOT NULL
        AND installation_order."visitFeeStatus" = 'APPROVED'
        AND installation_order."visitFeePolicyId" IS NOT NULL
        AND installation_order."visitFeeGrossAmount" IS NOT NULL
        AND length(trim(COALESCE(installation_order."visitFeeClauseText", ''))) > 0
        AND installation_order."visitFeeClauseVersion" IS NOT NULL
        AND installation_order."visitFeeLegalApprovedAt" IS NOT NULL
        AND installation_order."visitFeeClientAcceptedAt" IS NOT NULL
        AND NEW."grossAmount" = installation_order."visitFeeGrossAmount"
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Installation billing requires verified private evidence and a complete accepted visit-fee snapshot');
END;

-- An order retains a historical legal snapshot, so those source policy fields
-- are immutable once a policy has been selected by any order.
CREATE TRIGGER "InstallationVisitFeePolicy_historic_snapshot_update_guard"
BEFORE UPDATE OF "grossAmount", "clauseText", "version", "legalApprovedAt", "legalApprovedById" ON "InstallationVisitFeePolicy"
WHEN EXISTS (SELECT 1 FROM "InstallationOrder" WHERE "visitFeePolicyId" = OLD."id")
BEGIN
  SELECT RAISE(ABORT, 'historic installation visit-fee policy cannot change');
END;
