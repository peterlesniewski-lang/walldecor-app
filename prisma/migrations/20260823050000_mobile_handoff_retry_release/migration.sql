-- The mobile handoff counter is a database-maintained projection of active
-- PENDING/READY mobile files. Capacity is therefore enforced by the file
-- lifecycle itself, not by an application-side increment/decrement race.
DROP TRIGGER "MobileUploadHandoff_state_update_guard";

CREATE TRIGGER "MobileUploadHandoff_state_update_guard"
BEFORE UPDATE OF "sessionSecretHash", "usedFiles", "redeemedAt", "revokedAt" ON "MobileUploadHandoff"
WHEN (NEW."sessionSecretHash" IS NOT NULL AND (length(NEW."sessionSecretHash")<>64 OR NEW."sessionSecretHash" GLOB '*[^0-9a-f]*'))
  OR ((OLD."sessionSecretHash" IS NULL AND NEW."sessionSecretHash" IS NOT NULL) <> (OLD."redeemedAt" IS NULL AND NEW."redeemedAt" IS NOT NULL))
  OR (OLD."sessionSecretHash" IS NOT NULL AND NEW."sessionSecretHash" IS NOT OLD."sessionSecretHash")
  OR (OLD."redeemedAt" IS NOT NULL AND NEW."redeemedAt" IS NOT OLD."redeemedAt")
  OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS NOT OLD."revokedAt")
  OR NEW."usedFiles" < 0 OR NEW."usedFiles" > NEW."maxFiles"
  OR NEW."usedFiles" <> (
    SELECT count(*) FROM "InstallationFile" file
    WHERE file."mobileHandoffId" = NEW."id"
      AND file."softDeletedAt" IS NULL
      AND file."status" IN ('PENDING', 'READY')
  )
BEGIN
  SELECT RAISE(ABORT, 'mobile handoff state is invalid');
END;

CREATE TRIGGER "InstallationFile_mobile_handoff_capacity_guard"
BEFORE INSERT ON "InstallationFile"
WHEN NEW."mobileHandoffId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MobileUploadHandoff" handoff
    WHERE handoff."id" = NEW."mobileHandoffId"
      AND (
        SELECT count(*) FROM "InstallationFile" file
        WHERE file."mobileHandoffId" = handoff."id"
          AND file."softDeletedAt" IS NULL
          AND file."status" IN ('PENDING', 'READY')
      ) < handoff."maxFiles"
  )
BEGIN
  SELECT RAISE(ABORT, 'mobile handoff upload limit has been reached');
END;

CREATE TRIGGER "InstallationFile_mobile_handoff_counter_after_insert"
AFTER INSERT ON "InstallationFile"
WHEN NEW."mobileHandoffId" IS NOT NULL
BEGIN
  UPDATE "MobileUploadHandoff"
  SET "usedFiles" = (
    SELECT count(*) FROM "InstallationFile" file
    WHERE file."mobileHandoffId" = NEW."mobileHandoffId"
      AND file."softDeletedAt" IS NULL
      AND file."status" IN ('PENDING', 'READY')
  )
  WHERE "id" = NEW."mobileHandoffId";
END;

CREATE TRIGGER "InstallationFile_mobile_handoff_counter_after_status"
AFTER UPDATE OF "status" ON "InstallationFile"
WHEN NEW."mobileHandoffId" IS NOT NULL
BEGIN
  UPDATE "MobileUploadHandoff"
  SET "usedFiles" = (
    SELECT count(*) FROM "InstallationFile" file
    WHERE file."mobileHandoffId" = NEW."mobileHandoffId"
      AND file."softDeletedAt" IS NULL
      AND file."status" IN ('PENDING', 'READY')
  )
  WHERE "id" = NEW."mobileHandoffId";
END;

CREATE TRIGGER "InstallationFile_mobile_handoff_counter_after_soft_delete"
AFTER UPDATE OF "softDeletedAt" ON "InstallationFile"
WHEN NEW."mobileHandoffId" IS NOT NULL
BEGIN
  UPDATE "MobileUploadHandoff"
  SET "usedFiles" = (
    SELECT count(*) FROM "InstallationFile" file
    WHERE file."mobileHandoffId" = NEW."mobileHandoffId"
      AND file."softDeletedAt" IS NULL
      AND file."status" IN ('PENDING', 'READY')
  )
  WHERE "id" = NEW."mobileHandoffId";
END;
