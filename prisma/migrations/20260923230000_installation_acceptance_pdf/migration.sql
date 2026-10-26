CREATE TABLE "InstallationAcceptanceDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "protocolId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "bytes" BLOB NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationAcceptanceDocument_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "InstallationAcceptanceProtocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InstallationAcceptanceDocument_protocolId_kind_key" ON "InstallationAcceptanceDocument"("protocolId", "kind");

CREATE TRIGGER "acceptance_document_immutable_update" BEFORE UPDATE ON "InstallationAcceptanceDocument"
BEGIN SELECT RAISE(ABORT, 'signed acceptance PDF is immutable'); END;
CREATE TRIGGER "acceptance_document_immutable_delete" BEFORE DELETE ON "InstallationAcceptanceDocument"
BEGIN SELECT RAISE(ABORT, 'signed acceptance PDF is immutable'); END;
