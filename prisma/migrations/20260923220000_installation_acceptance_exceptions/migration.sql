CREATE TABLE "InstallationAcceptanceUnilateral" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "protocolId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT,
  "circumstances" TEXT,
  "signature" BLOB,
  "signedAt" DATETIME,
  "contentHash" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InstallationAcceptanceUnilateral_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceUnilateral_protocolId_key" ON "InstallationAcceptanceUnilateral"("protocolId");

CREATE TABLE "InstallationAcceptanceAlert" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "protocolId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "notificationId" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailLeaseUntil" DATETIME,
  "emailSentAt" DATETIME,
  "lastEmailError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationAcceptanceAlert_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceAlert_eventKey_key" ON "InstallationAcceptanceAlert"("eventKey");
CREATE INDEX "InstallationAcceptanceAlert_emailStatus_emailLeaseUntil_idx" ON "InstallationAcceptanceAlert"("emailStatus", "emailLeaseUntil");
CREATE INDEX "InstallationAcceptanceAlert_protocolId_kind_idx" ON "InstallationAcceptanceAlert"("protocolId", "kind");

ALTER TABLE "InstallationFile" ADD COLUMN "unilateralProtocolId" TEXT REFERENCES "InstallationAcceptanceUnilateral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InstallationFile_unilateralProtocolId_idx" ON "InstallationFile"("unilateralProtocolId");

CREATE TRIGGER "unilateral_photo_only_on_draft" BEFORE INSERT ON "InstallationFile"
WHEN NEW."unilateralProtocolId" IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW."acceptanceProtocolId" IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM "InstallationAcceptanceUnilateral" u
    JOIN "InstallationAcceptanceProtocol" p ON p."id" = u."protocolId"
    WHERE u."id" = NEW."unilateralProtocolId" AND p."orderId" = NEW."orderId" AND u."status" = 'DRAFT'
  ) THEN RAISE(ABORT, 'unilateral photo requires matching draft') END;
END;

CREATE TRIGGER "unilateral_photo_no_relink" BEFORE UPDATE OF "unilateralProtocolId" ON "InstallationFile"
WHEN NEW."unilateralProtocolId" IS NOT OLD."unilateralProtocolId"
BEGIN
  SELECT RAISE(ABORT, 'unilateral photo link is immutable');
END;

CREATE TRIGGER "unilateral_photo_signed_immutable" BEFORE UPDATE ON "InstallationFile"
WHEN OLD."unilateralProtocolId" IS NOT NULL
  AND (SELECT "status" FROM "InstallationAcceptanceUnilateral" WHERE "id" = OLD."unilateralProtocolId") != 'DRAFT'
  AND (NEW."status" IS NOT OLD."status" OR NEW."sha256" IS NOT OLD."sha256" OR NEW."softDeletedAt" IS NOT OLD."softDeletedAt")
BEGIN
  SELECT RAISE(ABORT, 'signed unilateral photo is immutable');
END;

CREATE TRIGGER "unilateral_photo_signed_no_delete" BEFORE DELETE ON "InstallationFile"
WHEN OLD."unilateralProtocolId" IS NOT NULL
  AND (SELECT "status" FROM "InstallationAcceptanceUnilateral" WHERE "id" = OLD."unilateralProtocolId") != 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'signed unilateral photo is immutable');
END;

CREATE TRIGGER "acceptance_unilateral_signed_immutable" BEFORE UPDATE OF "reason", "circumstances", "signature", "signedAt", "contentHash" ON "InstallationAcceptanceUnilateral"
WHEN OLD."status" != 'DRAFT' AND (
  NEW."reason" IS NOT OLD."reason" OR NEW."circumstances" IS NOT OLD."circumstances"
  OR NEW."signature" IS NOT OLD."signature" OR NEW."signedAt" IS NOT OLD."signedAt" OR NEW."contentHash" IS NOT OLD."contentHash"
)
BEGIN
  SELECT RAISE(ABORT, 'signed unilateral protocol is immutable');
END;
