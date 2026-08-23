-- An already accepted fee snapshot may change only when the same statement
-- atomically invalidates every piece of client-acceptance evidence. This keeps
-- an acceptance from silently carrying over to different legal content.
CREATE TRIGGER "InstallationOrder_accepted_fee_snapshot_update_guard"
BEFORE UPDATE OF "visitFeePolicyId", "visitFeeStatus", "visitFeeGrossAmount", "visitFeeClauseText", "visitFeeClauseVersion", "visitFeeLegalApprovedAt" ON "InstallationOrder"
WHEN OLD."visitFeeClientAcceptedAt" IS NOT NULL
  AND (
    NEW."visitFeePolicyId" IS NOT OLD."visitFeePolicyId"
    OR NEW."visitFeeStatus" IS NOT OLD."visitFeeStatus"
    OR NEW."visitFeeGrossAmount" IS NOT OLD."visitFeeGrossAmount"
    OR NEW."visitFeeClauseText" IS NOT OLD."visitFeeClauseText"
    OR NEW."visitFeeClauseVersion" IS NOT OLD."visitFeeClauseVersion"
    OR NEW."visitFeeLegalApprovedAt" IS NOT OLD."visitFeeLegalApprovedAt"
  )
  AND (
    NEW."visitFeeClientAcceptedAt" IS NOT NULL
    OR NEW."visitFeeClientIpHash" IS NOT NULL
    OR NEW."visitFeeClientUserAgent" IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'accepted installation visit-fee snapshot requires atomic acceptance invalidation');
END;

-- A non-null legal approval timestamp is insufficient when it is still in the
-- future. Support Prisma's integer-millisecond representation and legacy text
-- timestamps so the invariant also holds for upgraded databases.
CREATE TRIGGER "InstallationBillingTask_mismatch_future_legal_insert_guard"
BEFORE INSERT ON "InstallationBillingTask"
WHEN NEW."kind" = 'MISMATCH_VISIT_FEE'
  AND EXISTS (
    SELECT 1
    FROM "InstallationOrder"
    WHERE "id" = NEW."orderId"
      AND (
        (
          typeof("visitFeeLegalApprovedAt") IN ('integer', 'real')
          AND "visitFeeLegalApprovedAt" > CAST(strftime('%s', 'now') AS INTEGER) * 1000
        )
        OR (
          typeof("visitFeeLegalApprovedAt") = 'text'
          AND julianday("visitFeeLegalApprovedAt") > julianday('now')
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'installation visit-fee legal approval cannot be in the future');
END;

CREATE TRIGGER "InstallationBillingTask_mismatch_future_legal_update_guard"
BEFORE UPDATE ON "InstallationBillingTask"
WHEN NEW."kind" = 'MISMATCH_VISIT_FEE'
  AND EXISTS (
    SELECT 1
    FROM "InstallationOrder"
    WHERE "id" = NEW."orderId"
      AND (
        (
          typeof("visitFeeLegalApprovedAt") IN ('integer', 'real')
          AND "visitFeeLegalApprovedAt" > CAST(strftime('%s', 'now') AS INTEGER) * 1000
        )
        OR (
          typeof("visitFeeLegalApprovedAt") = 'text'
          AND julianday("visitFeeLegalApprovedAt") > julianday('now')
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'installation visit-fee legal approval cannot be in the future');
END;
