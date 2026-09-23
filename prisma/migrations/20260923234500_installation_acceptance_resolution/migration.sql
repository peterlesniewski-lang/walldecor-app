ALTER TABLE "InstallationAcceptanceProtocol" ADD COLUMN "resolvesProtocolId" TEXT REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InstallationAcceptanceProtocol_resolvesProtocolId_idx" ON "InstallationAcceptanceProtocol"("resolvesProtocolId");

CREATE TABLE "InstallationAcceptanceResolution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "priorProtocolId" TEXT NOT NULL,
  "resolvingProtocolId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationAcceptanceResolution_priorProtocolId_fkey" FOREIGN KEY ("priorProtocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InstallationAcceptanceResolution_resolvingProtocolId_fkey" FOREIGN KEY ("resolvingProtocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceResolution_priorProtocolId_key" ON "InstallationAcceptanceResolution"("priorProtocolId");
CREATE INDEX "InstallationAcceptanceResolution_resolvingProtocolId_idx" ON "InstallationAcceptanceResolution"("resolvingProtocolId");

CREATE TRIGGER "acceptance_resolves_identity_immutable" BEFORE UPDATE OF "resolvesProtocolId" ON "InstallationAcceptanceProtocol"
WHEN NEW."resolvesProtocolId" IS NOT OLD."resolvesProtocolId"
BEGIN SELECT RAISE(ABORT, 'acceptance resolution link is immutable'); END;
CREATE TRIGGER "acceptance_resolution_immutable_update" BEFORE UPDATE ON "InstallationAcceptanceResolution"
BEGIN SELECT RAISE(ABORT, 'acceptance resolution is immutable'); END;
CREATE TRIGGER "acceptance_resolution_immutable_delete" BEFORE DELETE ON "InstallationAcceptanceResolution"
BEGIN SELECT RAISE(ABORT, 'acceptance resolution is immutable'); END;
