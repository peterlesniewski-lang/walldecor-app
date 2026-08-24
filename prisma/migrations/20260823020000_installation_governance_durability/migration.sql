-- Task 4 cannot manufacture private-file verification. Task 5 must explicitly
-- replace these two guards with triggers tied to its real private-media table.
CREATE TRIGGER "InstallationMismatch_task5_verification_insert_guard"
BEFORE INSERT ON "InstallationMismatch"
WHEN NEW."evidenceStatus" = 'VERIFIED_PRIVATE_FILE'
  OR NEW."evidenceFileId" IS NOT NULL
  OR NEW."evidenceVerifiedAt" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Task 5 private-file verification is not installed');
END;

CREATE TRIGGER "InstallationMismatch_task5_verification_update_guard"
BEFORE UPDATE OF "evidenceStatus", "evidenceFileId", "evidenceVerifiedAt" ON "InstallationMismatch"
WHEN (NEW."evidenceStatus" = 'VERIFIED_PRIVATE_FILE' AND OLD."evidenceStatus" IS NOT 'VERIFIED_PRIVATE_FILE')
  OR (NEW."evidenceFileId" IS NOT NULL AND NEW."evidenceFileId" IS NOT OLD."evidenceFileId")
  OR (NEW."evidenceVerifiedAt" IS NOT NULL AND NEW."evidenceVerifiedAt" IS NOT OLD."evidenceVerifiedAt")
BEGIN
  SELECT RAISE(ABORT, 'Task 5 private-file verification is not installed');
END;

CREATE TRIGGER "InstallationMismatch_billed_evidence_immutability_guard"
BEFORE UPDATE OF "evidenceStatus", "evidenceFileId", "evidenceVerifiedAt" ON "InstallationMismatch"
WHEN EXISTS (SELECT 1 FROM "InstallationBillingTask" WHERE "mismatchId" = OLD."id" AND "kind" = 'MISMATCH_VISIT_FEE')
  AND (NEW."evidenceStatus" IS NOT OLD."evidenceStatus" OR NEW."evidenceFileId" IS NOT OLD."evidenceFileId" OR NEW."evidenceVerifiedAt" IS NOT OLD."evidenceVerifiedAt")
BEGIN
  SELECT RAISE(ABORT, 'billed installation evidence is immutable');
END;

CREATE TRIGGER "InstallationOrder_billed_fee_snapshot_immutability_guard"
BEFORE UPDATE OF "visitFeePolicyId", "visitFeeStatus", "visitFeeGrossAmount", "visitFeeClauseText", "visitFeeClauseVersion", "visitFeeLegalApprovedAt", "visitFeeSelectedById", "visitFeeSelectedAt", "visitFeeOverrideReason", "visitFeeApprovedById", "visitFeeApprovedAt", "visitFeeClientAcceptedAt", "visitFeeClientIpHash", "visitFeeClientUserAgent" ON "InstallationOrder"
WHEN EXISTS (SELECT 1 FROM "InstallationBillingTask" WHERE "orderId" = OLD."id" AND "kind" = 'MISMATCH_VISIT_FEE')
  AND (NEW."visitFeePolicyId" IS NOT OLD."visitFeePolicyId" OR NEW."visitFeeStatus" IS NOT OLD."visitFeeStatus" OR NEW."visitFeeGrossAmount" IS NOT OLD."visitFeeGrossAmount" OR NEW."visitFeeClauseText" IS NOT OLD."visitFeeClauseText" OR NEW."visitFeeClauseVersion" IS NOT OLD."visitFeeClauseVersion" OR NEW."visitFeeLegalApprovedAt" IS NOT OLD."visitFeeLegalApprovedAt" OR NEW."visitFeeSelectedById" IS NOT OLD."visitFeeSelectedById" OR NEW."visitFeeSelectedAt" IS NOT OLD."visitFeeSelectedAt" OR NEW."visitFeeOverrideReason" IS NOT OLD."visitFeeOverrideReason" OR NEW."visitFeeApprovedById" IS NOT OLD."visitFeeApprovedById" OR NEW."visitFeeApprovedAt" IS NOT OLD."visitFeeApprovedAt" OR NEW."visitFeeClientAcceptedAt" IS NOT OLD."visitFeeClientAcceptedAt" OR NEW."visitFeeClientIpHash" IS NOT OLD."visitFeeClientIpHash" OR NEW."visitFeeClientUserAgent" IS NOT OLD."visitFeeClientUserAgent")
BEGIN
  SELECT RAISE(ABORT, 'billed installation visit-fee snapshot is immutable');
END;
