-- Additive external observations. No existing invoice, cost or original is rewritten.
CREATE TABLE "InvoiceKsefReconciliation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "draftId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL CHECK (length(trim("externalId")) >= 1 AND length("externalId") <= 191 AND instr("externalId", char(0)) = 0),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "snapshotJson" TEXT NOT NULL CHECK (length(CAST("snapshotJson" AS BLOB)) BETWEEN 1 AND 65536),
  "snapshotHash" TEXT NOT NULL CHECK (length("snapshotHash") = 64 AND length(CAST("snapshotHash" AS BLOB)) = 64 AND "snapshotHash" NOT GLOB '*[^0-9a-f]*'),
  "xmlContent" TEXT CHECK ("xmlContent" IS NULL OR length(CAST("xmlContent" AS BLOB)) <= 4194304),
  "status" TEXT NOT NULL DEFAULT 'MATCHED' CHECK ("status" IN ('MATCHED', 'CONFLICT', 'KEPT_LOCAL', 'APPLIED_TO_DRAFT')),
  "resolvedDataHash" TEXT CHECK ("resolvedDataHash" IS NULL OR (length("resolvedDataHash") = 64 AND length(CAST("resolvedDataHash" AS BLOB)) = 64 AND "resolvedDataHash" NOT GLOB '*[^0-9a-f]*')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InvoiceKsefReconciliation_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InvoiceImportDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
) WITHOUT ROWID;

CREATE UNIQUE INDEX "InvoiceKsefReconciliation_externalId_key" ON "InvoiceKsefReconciliation"("externalId");
CREATE INDEX "InvoiceKsefReconciliation_draftId_idx" ON "InvoiceKsefReconciliation"("draftId");

-- SQLite REPLACE can skip DELETE triggers when recursive_triggers is off.
-- Existing identities must use an explicit, audited UPDATE, never a replacement.
CREATE TRIGGER "InvoiceKsefReconciliation_replace_guard"
BEFORE INSERT ON "InvoiceKsefReconciliation"
WHEN EXISTS (SELECT 1 FROM "InvoiceKsefReconciliation" WHERE "id" = NEW."id" OR "externalId" = NEW."externalId")
BEGIN
  SELECT RAISE(ABORT, 'KSeF reconciliation binding cannot be replaced');
END;

CREATE TRIGGER "InvoiceKsefReconciliation_identity_guard"
BEFORE UPDATE OF "id", "draftId", "externalId" ON "InvoiceKsefReconciliation"
WHEN NEW."id" IS NOT OLD."id" OR NEW."draftId" IS NOT OLD."draftId" OR NEW."externalId" IS NOT OLD."externalId"
BEGIN
  SELECT RAISE(ABORT, 'KSeF reconciliation binding is permanent');
END;

CREATE TRIGGER "InvoiceKsefReconciliation_delete_guard"
BEFORE DELETE ON "InvoiceKsefReconciliation"
BEGIN
  SELECT RAISE(ABORT, 'KSeF reconciliation history must be retained');
END;
