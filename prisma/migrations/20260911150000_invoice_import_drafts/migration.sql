-- Additive draft-only foundation. Uploading metadata does not create invoices or cost events.
CREATE TABLE "InvoiceImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceImportBatch_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'STAGED' CHECK ("state" IN ('STAGED', 'READY', 'STORAGE_ERROR')),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceAttachment_ready_size_check" CHECK (
      "state" != 'READY' OR ("byteSize" > 0 AND "byteSize" <= 10485760)
    ),
    CONSTRAINT "InvoiceAttachment_ready_metadata_check" CHECK (
      "state" != 'READY' OR (
        ("mimeType" = 'application/pdf' AND "pageCount" IS NOT NULL AND "pageCount" BETWEEN 1 AND 10) OR
        ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp') AND "pageCount" IS NULL)
      )
    )
);

CREATE TABLE "InvoiceImportDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "extractionRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("extractionRevision" >= 0),
    "dataJson" TEXT NOT NULL DEFAULT '{}',
    "manualFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "latestAiJobId" TEXT,
    "invoiceId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("state" IN ('OPEN', 'APPROVED', 'ARCHIVED')),
    "skippedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceImportDraft_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InvoiceImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceImportDraft_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "InvoiceAttachment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceImportDraft_latestAiJobId_fkey" FOREIGN KEY ("latestAiJobId") REFERENCES "AiJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceImportDraft_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "KsefInvoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceDraftAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "aiJobId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceDraftAudit_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InvoiceImportDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceDraftAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceDraftAudit_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AiJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InvoiceAttachment_storageKey_key" ON "InvoiceAttachment"("storageKey");
CREATE UNIQUE INDEX "InvoiceAttachment_sha256_key" ON "InvoiceAttachment"("sha256");
CREATE UNIQUE INDEX "InvoiceImportDraft_attachmentId_key" ON "InvoiceImportDraft"("attachmentId");
CREATE UNIQUE INDEX "InvoiceImportDraft_latestAiJobId_key" ON "InvoiceImportDraft"("latestAiJobId");
CREATE UNIQUE INDEX "InvoiceImportDraft_invoiceId_key" ON "InvoiceImportDraft"("invoiceId");
CREATE INDEX "InvoiceImportDraft_batchId_idx" ON "InvoiceImportDraft"("batchId");
CREATE UNIQUE INDEX "InvoiceDraftAudit_actorId_idempotencyKey_key" ON "InvoiceDraftAudit"("actorId", "idempotencyKey");
CREATE INDEX "InvoiceDraftAudit_draftId_createdAt_idx" ON "InvoiceDraftAudit"("draftId", "createdAt");

CREATE TRIGGER "InvoiceImportDraft_invoice_permanence_guard"
BEFORE UPDATE OF "invoiceId" ON "InvoiceImportDraft"
WHEN OLD."invoiceId" IS NOT NULL AND NEW."invoiceId" IS NOT OLD."invoiceId"
BEGIN
  SELECT RAISE(ABORT, 'InvoiceImportDraft invoiceId is permanent once assigned');
END;

CREATE TRIGGER "InvoiceDraftAudit_update_guard"
BEFORE UPDATE ON "InvoiceDraftAudit"
BEGIN
  SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable');
END;

CREATE TRIGGER "InvoiceDraftAudit_delete_guard"
BEFORE DELETE ON "InvoiceDraftAudit"
BEGIN
  SELECT RAISE(ABORT, 'InvoiceDraftAudit rows are immutable');
END;
