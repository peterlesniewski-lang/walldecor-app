-- User-approved exception to the UI-only change: optional supporting note/material
-- for RESOLVED. Preserve all rows, foreign keys, indexes and WAIVED safeguards.
BEGIN IMMEDIATE;

CREATE TABLE "new_InstallationClarification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "sourceSubmissionId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "isBlocking" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "resolutionNote" TEXT,
  "evidenceReference" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationClarification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationClarification_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "InstallationFormSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationClarification_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED', 'WAIVED')),
  CONSTRAINT "InstallationClarification_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
    OR ("status" = 'RESOLVED' AND length(trim(COALESCE("resolution", ''))) > 0 AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
    OR ("status" = 'WAIVED' AND length(trim(COALESCE("resolutionNote", ''))) > 0 AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
  )
);
INSERT INTO "new_InstallationClarification" (
  "id", "orderId", "sourceSubmissionId", "questionKey", "reasonCode", "reason", "isBlocking", "status",
  "resolution", "resolutionNote", "evidenceReference", "resolvedById", "resolvedAt", "createdAt", "updatedAt"
) SELECT
  "id", "orderId", "sourceSubmissionId", "questionKey", "reasonCode", "reason", "isBlocking", "status",
  "resolution", "resolutionNote", "evidenceReference", "resolvedById", "resolvedAt", "createdAt", "updatedAt"
FROM "InstallationClarification";
DROP TABLE "InstallationClarification";
ALTER TABLE "new_InstallationClarification" RENAME TO "InstallationClarification";
CREATE UNIQUE INDEX "InstallationClarification_sourceSubmissionId_questionKey_reasonCode_key" ON "InstallationClarification"("sourceSubmissionId", "questionKey", "reasonCode");
CREATE INDEX "InstallationClarification_orderId_status_isBlocking_idx" ON "InstallationClarification"("orderId", "status", "isBlocking");
CREATE INDEX "InstallationClarification_sourceSubmissionId_idx" ON "InstallationClarification"("sourceSubmissionId");

COMMIT;
