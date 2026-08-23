-- Initial visibility revocation and durable remote cleanup reservation are one
-- state transition. A PENDING upload may only enter it while atomically becoming
-- FAILED, which is reserved for post-upload finalization compensation.
DROP TRIGGER IF EXISTS "InstallationFile_soft_delete_remote_state_guard";

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
