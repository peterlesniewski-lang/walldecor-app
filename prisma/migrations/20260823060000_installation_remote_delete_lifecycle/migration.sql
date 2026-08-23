ALTER TABLE "InstallationFile" ADD COLUMN "remoteDeleteStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE "InstallationFile" ADD COLUMN "remoteDeleteAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InstallationFile" ADD COLUMN "remoteDeleteLastError" TEXT;
ALTER TABLE "InstallationFile" ADD COLUMN "remoteDeleteNextAttemptAt" DATETIME;
ALTER TABLE "InstallationFile" ADD COLUMN "remoteDeletedAt" DATETIME;

CREATE INDEX "InstallationFile_remoteDeleteStatus_remoteDeleteNextAttemptAt_idx"
ON "InstallationFile"("remoteDeleteStatus", "remoteDeleteNextAttemptAt");

-- Every pre-migration soft-delete already made one best-effort remote call,
-- but its outcome was not durable. Keep it visible for a safe idempotent retry.
UPDATE "InstallationFile"
SET "remoteDeleteStatus" = 'RETRY',
    "remoteDeleteAttemptCount" = 1,
    "remoteDeleteLastError" = 'Stan zdalnego usunięcia sprzed migracji wymaga ponownej weryfikacji.',
    "remoteDeleteNextAttemptAt" = CURRENT_TIMESTAMP
WHERE "softDeletedAt" IS NOT NULL;

CREATE TRIGGER "InstallationFile_remote_delete_insert_guard"
BEFORE INSERT ON "InstallationFile"
WHEN NEW."remoteDeleteStatus" IS NOT 'NOT_REQUESTED'
  OR NEW."remoteDeleteAttemptCount" <> 0
  OR NEW."remoteDeleteLastError" IS NOT NULL
  OR NEW."remoteDeleteNextAttemptAt" IS NOT NULL
  OR NEW."remoteDeletedAt" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'installation file remote delete must start unrequested');
END;

CREATE TRIGGER "InstallationFile_remote_delete_update_guard"
BEFORE UPDATE OF "remoteDeleteStatus", "remoteDeleteAttemptCount", "remoteDeleteLastError", "remoteDeleteNextAttemptAt", "remoteDeletedAt" ON "InstallationFile"
WHEN NEW."remoteDeleteStatus" NOT IN ('NOT_REQUESTED','PENDING','RETRY','SUCCEEDED')
  OR NEW."remoteDeleteAttemptCount" < 0
  OR (NEW."remoteDeleteStatus" = 'NOT_REQUESTED' AND (
    NEW."softDeletedAt" IS NOT NULL OR NEW."remoteDeleteAttemptCount" <> 0
    OR NEW."remoteDeleteLastError" IS NOT NULL OR NEW."remoteDeleteNextAttemptAt" IS NOT NULL OR NEW."remoteDeletedAt" IS NOT NULL
  ))
  OR (NEW."remoteDeleteStatus" = 'PENDING' AND (
    NEW."softDeletedAt" IS NULL OR NEW."remoteDeleteLastError" IS NOT NULL
    OR NEW."remoteDeleteNextAttemptAt" IS NOT NULL OR NEW."remoteDeletedAt" IS NOT NULL
  ))
  OR (NEW."remoteDeleteStatus" = 'RETRY' AND (
    NEW."softDeletedAt" IS NULL OR NEW."remoteDeleteAttemptCount" < 1
    OR length(trim(COALESCE(NEW."remoteDeleteLastError",''))) = 0
    OR length(NEW."remoteDeleteLastError") > 1000
    OR NEW."remoteDeleteNextAttemptAt" IS NULL OR NEW."remoteDeletedAt" IS NOT NULL
  ))
  OR (NEW."remoteDeleteStatus" = 'SUCCEEDED' AND (
    NEW."softDeletedAt" IS NULL OR NEW."remoteDeleteAttemptCount" < 1
    OR NEW."remoteDeleteLastError" IS NOT NULL OR NEW."remoteDeleteNextAttemptAt" IS NOT NULL OR NEW."remoteDeletedAt" IS NULL
    OR NOT (
      (typeof(NEW."remoteDeletedAt") IN ('integer','real') AND NEW."remoteDeletedAt" <= CAST(strftime('%s','now') AS INTEGER) * 1000 + 999)
      OR (typeof(NEW."remoteDeletedAt") = 'text' AND julianday(NEW."remoteDeletedAt") <= julianday('now'))
    )
  ))
  OR NOT (
    (OLD."remoteDeleteStatus" = 'NOT_REQUESTED' AND NEW."remoteDeleteStatus" = 'PENDING' AND NEW."remoteDeleteAttemptCount" = OLD."remoteDeleteAttemptCount")
    OR (OLD."remoteDeleteStatus" = 'RETRY' AND NEW."remoteDeleteStatus" = 'PENDING' AND NEW."remoteDeleteAttemptCount" = OLD."remoteDeleteAttemptCount")
    OR (OLD."remoteDeleteStatus" = 'PENDING' AND NEW."remoteDeleteStatus" IN ('RETRY','SUCCEEDED') AND NEW."remoteDeleteAttemptCount" = OLD."remoteDeleteAttemptCount" + 1)
  )
BEGIN
  SELECT RAISE(ABORT, 'installation file remote delete transition is invalid');
END;

-- Initial visibility revocation and durable remote cleanup reservation are one
-- state transition. A PENDING upload may only enter it while atomically becoming
-- FAILED, which is reserved for post-upload finalization compensation.
CREATE TRIGGER "InstallationFile_soft_delete_remote_state_guard"
BEFORE UPDATE OF "status", "softDeletedAt", "softDeletedById", "remoteDeleteStatus" ON "InstallationFile"
WHEN OLD."softDeletedAt" IS NULL
  AND NEW."softDeletedAt" IS NOT NULL
  AND (
    length(trim(COALESCE(NEW."softDeletedById", ''))) = 0
    OR NEW."remoteDeleteStatus" IS NOT 'PENDING'
    OR NEW."status" NOT IN ('READY', 'FAILED')
  )
BEGIN
  SELECT RAISE(ABORT, 'installation file soft-delete requires an attributable pending remote cleanup');
END;

DROP TRIGGER "InstallationFileAuditEvent_insert_guard";
CREATE TRIGGER "InstallationFileAuditEvent_insert_guard"
BEFORE INSERT ON "InstallationFileAuditEvent"
WHEN NEW."action" NOT IN (
  'INSTALLATION_PRIVATE_FILE_PENDING',
  'INSTALLATION_PRIVATE_FILE_READY',
  'INSTALLATION_PRIVATE_FILE_FAILED',
  'INSTALLATION_PRIVATE_FILE_SOFT_DELETED',
  'INSTALLATION_PRIVATE_FILE_DELETE_REMOTE_FAILED',
  'INSTALLATION_MISMATCH_PRIVATE_EVIDENCE_ATTACHED',
  'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_PENDING',
  'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_RETRY',
  'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_SUCCEEDED'
) OR NOT EXISTS (
  SELECT 1 FROM "InstallationFile" f WHERE f."id" = NEW."fileId" AND f."orderId" = NEW."orderId"
)
OR (
  NEW."action" = 'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM "InstallationFile" f
    WHERE f."id" = NEW."fileId" AND f."remoteDeleteStatus" = 'PENDING'
  )
)
OR (
  NEW."action" = 'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_RETRY'
  AND NOT EXISTS (
    SELECT 1 FROM "InstallationFile" f
    WHERE f."id" = NEW."fileId" AND f."remoteDeleteStatus" = 'RETRY'
  )
)
OR (
  NEW."action" = 'INSTALLATION_PRIVATE_FILE_REMOTE_DELETE_SUCCEEDED'
  AND NOT EXISTS (
    SELECT 1 FROM "InstallationFile" f
    WHERE f."id" = NEW."fileId" AND f."remoteDeleteStatus" = 'SUCCEEDED'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'installation file audit event is invalid');
END;

-- Prisma stores SQLite DateTime values as integer milliseconds. A value made
-- during the current second is legal through its final millisecond; the Task 5
-- trigger installed earlier compared it only with the start of that second.
DROP TRIGGER "InstallationMismatch_private_evidence_update_guard";
CREATE TRIGGER "InstallationMismatch_private_evidence_update_guard"
BEFORE UPDATE OF "evidenceStatus","evidenceFileId","evidenceVerifiedAt" ON "InstallationMismatch"
WHEN (
  NEW."evidenceStatus" IS NOT OLD."evidenceStatus"
  OR NEW."evidenceFileId" IS NOT OLD."evidenceFileId"
  OR NEW."evidenceVerifiedAt" IS NOT OLD."evidenceVerifiedAt"
) AND NOT (
  (
    OLD."evidenceStatus"='VERIFIED_PRIVATE_FILE'
    AND NEW."evidenceStatus"='PENDING_PRIVATE_FILE'
    AND NEW."evidenceFileId" IS NULL
    AND NEW."evidenceVerifiedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "InstallationBillingTask" b
      WHERE b."mismatchId"=OLD."id" AND b."kind"='MISMATCH_VISIT_FEE'
    )
  )
  OR (
    NEW."evidenceStatus"='VERIFIED_PRIVATE_FILE'
    AND NEW."evidenceFileId" IS NOT NULL
    AND NEW."evidenceVerifiedAt" IS NOT NULL
    AND (
      (typeof(NEW."evidenceVerifiedAt") IN ('integer','real') AND NEW."evidenceVerifiedAt"<=CAST(strftime('%s','now') AS INTEGER)*1000+999)
      OR (typeof(NEW."evidenceVerifiedAt")='text' AND julianday(NEW."evidenceVerifiedAt")<=julianday('now'))
    )
    AND EXISTS (
      SELECT 1
      FROM "InstallationMismatchEvidence" e
      JOIN "InstallationFile" f ON f."id"=e."fileId"
      WHERE e."mismatchId"=NEW."id"
        AND e."orderId"=NEW."orderId"
        AND e."fileId"=NEW."evidenceFileId"
        AND f."orderId"=NEW."orderId"
        AND f."purpose"='MISMATCH_EVIDENCE'
        AND f."status"='READY'
        AND f."softDeletedAt" IS NULL
        AND f."byteSize">0
        AND length(f."sha256")=64
        AND f."sha256" NOT GLOB '*[^0-9a-f]*'
        AND EXISTS (
          SELECT 1 FROM "InstallationFileAuditEvent" a
          WHERE a."fileId"=f."id"
            AND a."orderId"=NEW."orderId"
            AND a."action"='INSTALLATION_PRIVATE_FILE_READY'
        )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'verified mismatch requires ready same-order private evidence');
END;
