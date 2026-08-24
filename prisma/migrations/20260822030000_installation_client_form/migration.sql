-- Requiredness must survive template publication into the immutable client snapshot.
ALTER TABLE "InstallationQuestionDefinition" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false;

-- Public client links deliberately retain only SHA-256 token digests. The raw
-- 256-bit URL secret is returned once by the authenticated generate response.
CREATE TABLE "InstallationClientLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOpenedAt" DATETIME,
  CONSTRAINT "InstallationClientLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationClientLink_token_hash_shape" CHECK (length("tokenHash") = 64 AND "tokenHash" NOT GLOB '*[^0-9a-f]*')
);
CREATE UNIQUE INDEX "InstallationClientLink_tokenHash_key" ON "InstallationClientLink"("tokenHash");
CREATE INDEX "InstallationClientLink_orderId_expiresAt_idx" ON "InstallationClientLink"("orderId", "expiresAt");
CREATE INDEX "InstallationClientLink_orderId_revokedAt_idx" ON "InstallationClientLink"("orderId", "revokedAt");

CREATE TABLE "InstallationFormSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "formSnapshotId" TEXT NOT NULL,
  "revisionOfId" TEXT,
  "revisionNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draftKey" TEXT,
  "draftVersion" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationFormSubmission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationFormSubmission_formSnapshotId_fkey" FOREIGN KEY ("formSnapshotId") REFERENCES "InstallationOrderFormSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationFormSubmission_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "InstallationFormSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationFormSubmission_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED')),
  CONSTRAINT "InstallationFormSubmission_revision_check" CHECK ("revisionNumber" > 0 AND "draftVersion" >= 0),
  CONSTRAINT "InstallationFormSubmission_lineage_check" CHECK ("revisionOfId" IS NULL OR "revisionOfId" <> "id")
);
CREATE UNIQUE INDEX "InstallationFormSubmission_orderId_revisionNumber_key" ON "InstallationFormSubmission"("orderId", "revisionNumber");
CREATE UNIQUE INDEX "InstallationFormSubmission_draftKey_key" ON "InstallationFormSubmission"("draftKey");
CREATE INDEX "InstallationFormSubmission_orderId_status_createdAt_idx" ON "InstallationFormSubmission"("orderId", "status", "createdAt");
CREATE INDEX "InstallationFormSubmission_revisionOfId_idx" ON "InstallationFormSubmission"("revisionOfId");

CREATE TABLE "InstallationAnswer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "questionType" TEXT NOT NULL,
  "valueJson" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "isUnknown" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "InstallationFormSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAnswer_submissionId_questionKey_key" ON "InstallationAnswer"("submissionId", "questionKey");
CREATE INDEX "InstallationAnswer_submissionId_isUnknown_idx" ON "InstallationAnswer"("submissionId", "isUnknown");

CREATE TABLE "InstallationFormSubmissionMutation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "clientMutationId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationFormSubmissionMutation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "InstallationFormSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationFormSubmissionMutation_operation_check" CHECK ("operation" IN ('AUTOSAVE', 'SUBMIT'))
);
CREATE UNIQUE INDEX "InstallationFormSubmissionMutation_submissionId_draftVersion_clientMutationId_key" ON "InstallationFormSubmissionMutation"("submissionId", "draftVersion", "clientMutationId");
CREATE INDEX "InstallationFormSubmissionMutation_submissionId_createdAt_idx" ON "InstallationFormSubmissionMutation"("submissionId", "createdAt");

CREATE TABLE "InstallationClarification" (
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
    OR ("status" = 'RESOLVED' AND length(trim(COALESCE("resolution", ''))) > 0 AND (length(trim(COALESCE("resolutionNote", ''))) > 0 OR length(trim(COALESCE("evidenceReference", ''))) > 0) AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
    OR ("status" = 'WAIVED' AND length(trim(COALESCE("resolutionNote", ''))) > 0 AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "InstallationClarification_sourceSubmissionId_questionKey_reasonCode_key" ON "InstallationClarification"("sourceSubmissionId", "questionKey", "reasonCode");
CREATE INDEX "InstallationClarification_orderId_status_isBlocking_idx" ON "InstallationClarification"("orderId", "status", "isBlocking");
CREATE INDEX "InstallationClarification_sourceSubmissionId_idx" ON "InstallationClarification"("sourceSubmissionId");

-- A submitted revision is a legal/history record, so direct SQL and Prisma
-- cannot rewrite or remove its answers after the submit transaction commits.
CREATE TRIGGER "InstallationAnswer_submitted_update_guard"
BEFORE UPDATE ON "InstallationAnswer"
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM "InstallationFormSubmission" WHERE "id" = OLD."submissionId" AND "status" = 'SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'submitted installation answers are immutable');
END;

CREATE TRIGGER "InstallationAnswer_submitted_delete_guard"
BEFORE DELETE ON "InstallationAnswer"
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM "InstallationFormSubmission" WHERE "id" = OLD."submissionId" AND "status" = 'SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'submitted installation answers are immutable');
END;
