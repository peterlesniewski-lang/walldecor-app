-- Corrective provenance for internal measurement mutations. Existing Task 2
-- rows remain readable; newly written rows receive the authenticated user and role.
ALTER TABLE "InstallationMeasurement" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "InstallationMeasurement" ADD COLUMN "actorRole" TEXT;

CREATE INDEX "InstallationMeasurement_actorUserId_createdAt_idx"
ON "InstallationMeasurement"("actorUserId", "createdAt");
