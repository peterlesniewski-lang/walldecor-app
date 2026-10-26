ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientDecision" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientFirstName" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientLastName" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientRelationship" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientNote" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientSignature" BLOB;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientRespondedAt" DATETIME;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientResponseHash" TEXT;
ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "clientResponseMetaJson" TEXT;

CREATE TABLE "InstallationAcceptanceLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "protocolId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "sentAt" DATETIME,
  "recipientEmail" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOpenedAt" DATETIME,
  CONSTRAINT "InstallationAcceptanceLink_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "InstallationAcceptanceProtocol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceLink_tokenHash_key" ON "InstallationAcceptanceLink"("tokenHash");
CREATE INDEX "InstallationAcceptanceLink_protocolId_channel_revokedAt_idx" ON "InstallationAcceptanceLink"("protocolId", "channel", "revokedAt");

CREATE TRIGGER "acceptance_client_response_immutable" BEFORE UPDATE OF "clientDecision", "clientFirstName", "clientLastName", "clientRelationship", "clientNote", "clientSignature", "clientRespondedAt", "clientResponseHash", "clientResponseMetaJson" ON "InstallationAcceptanceProtocol"
WHEN OLD."clientDecision" IS NOT NULL AND (
  NEW."clientDecision" IS NOT OLD."clientDecision" OR NEW."clientFirstName" IS NOT OLD."clientFirstName"
  OR NEW."clientLastName" IS NOT OLD."clientLastName" OR NEW."clientRelationship" IS NOT OLD."clientRelationship"
  OR NEW."clientNote" IS NOT OLD."clientNote" OR NEW."clientSignature" IS NOT OLD."clientSignature"
  OR NEW."clientRespondedAt" IS NOT OLD."clientRespondedAt" OR NEW."clientResponseHash" IS NOT OLD."clientResponseHash"
  OR NEW."clientResponseMetaJson" IS NOT OLD."clientResponseMetaJson"
)
BEGIN
  SELECT RAISE(ABORT, 'client acceptance response is immutable');
END;
