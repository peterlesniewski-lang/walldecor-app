CREATE TABLE "InstallationAcceptanceProtocol" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "previousId" TEXT,
  "installerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "snapshotJson" TEXT NOT NULL,
  "resultsJson" TEXT,
  "contentHash" TEXT,
  "installerSignature" BLOB,
  "installerSignedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationAcceptanceProtocol_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationAcceptanceProtocol_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "InstallationVisit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationAcceptanceProtocol_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InstallationAcceptanceProtocol_visitId_groupKey_revision_key" ON "InstallationAcceptanceProtocol"("visitId", "groupKey", "revision");
CREATE INDEX "InstallationAcceptanceProtocol_orderId_status_idx" ON "InstallationAcceptanceProtocol"("orderId", "status");
CREATE INDEX "InstallationAcceptanceProtocol_installerId_createdAt_idx" ON "InstallationAcceptanceProtocol"("installerId", "createdAt");

ALTER TABLE "InstallationFile" ADD COLUMN "acceptanceProtocolId" TEXT REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InstallationFile_acceptanceProtocolId_idx" ON "InstallationFile"("acceptanceProtocolId");

CREATE TRIGGER "acceptance_photo_only_on_draft" BEFORE INSERT ON "InstallationFile"
WHEN NEW."acceptanceProtocolId" IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "InstallationAcceptanceProtocol" p
    WHERE p."id" = NEW."acceptanceProtocolId" AND p."orderId" = NEW."orderId" AND p."status" = 'DRAFT'
  ) THEN RAISE(ABORT, 'acceptance photo requires matching draft') END;
END;

CREATE TRIGGER "acceptance_photo_no_relink" BEFORE UPDATE OF "acceptanceProtocolId" ON "InstallationFile"
WHEN NEW."acceptanceProtocolId" IS NOT OLD."acceptanceProtocolId"
BEGIN
  SELECT RAISE(ABORT, 'acceptance photo link is immutable');
END;

CREATE TRIGGER "acceptance_photo_signed_immutable" BEFORE UPDATE ON "InstallationFile"
WHEN OLD."acceptanceProtocolId" IS NOT NULL
  AND (SELECT "status" FROM "InstallationAcceptanceProtocol" WHERE "id" = OLD."acceptanceProtocolId") != 'DRAFT'
  AND (NEW."status" IS NOT OLD."status" OR NEW."sha256" IS NOT OLD."sha256" OR NEW."softDeletedAt" IS NOT OLD."softDeletedAt")
BEGIN
  SELECT RAISE(ABORT, 'signed acceptance photo is immutable');
END;

CREATE TRIGGER "acceptance_photo_signed_no_delete" BEFORE DELETE ON "InstallationFile"
WHEN OLD."acceptanceProtocolId" IS NOT NULL
  AND (SELECT "status" FROM "InstallationAcceptanceProtocol" WHERE "id" = OLD."acceptanceProtocolId") != 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'signed acceptance photo is immutable');
END;

CREATE TRIGGER "acceptance_protocol_identity_immutable" BEFORE UPDATE OF "orderId", "visitId", "groupKey", "revision", "previousId", "installerId", "snapshotJson" ON "InstallationAcceptanceProtocol"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."visitId" IS NOT OLD."visitId"
  OR NEW."groupKey" IS NOT OLD."groupKey" OR NEW."revision" IS NOT OLD."revision"
  OR NEW."previousId" IS NOT OLD."previousId" OR NEW."installerId" IS NOT OLD."installerId"
  OR NEW."snapshotJson" IS NOT OLD."snapshotJson"
BEGIN
  SELECT RAISE(ABORT, 'acceptance protocol identity and snapshot are immutable');
END;

CREATE TRIGGER "acceptance_protocol_signed_immutable" BEFORE UPDATE OF "resultsJson", "contentHash", "installerSignature", "installerSignedAt" ON "InstallationAcceptanceProtocol"
WHEN OLD."status" != 'DRAFT' AND (
  NEW."resultsJson" IS NOT OLD."resultsJson" OR NEW."contentHash" IS NOT OLD."contentHash"
  OR NEW."installerSignature" IS NOT OLD."installerSignature" OR NEW."installerSignedAt" IS NOT OLD."installerSignedAt"
)
BEGIN
  SELECT RAISE(ABORT, 'signed acceptance protocol is immutable');
END;
