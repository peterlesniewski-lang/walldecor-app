-- Fixed monthly costs without a VAT invoice. Amounts in integer grosze; months are "YYYY-MM".

CREATE TABLE "CostContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "counterparty" TEXT NOT NULL CHECK (length(trim("counterparty")) >= 2),
    "description" TEXT NOT NULL CHECK (length(trim("description")) >= 2),
    "startMonth" TEXT NOT NULL CHECK ("startMonth" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    "endMonth" TEXT CHECK ("endMonth" IS NULL OR ("endMonth" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND "endMonth" >= "startMonth")),
    "isConfidential" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "CostContractAmount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    "amountGrosze" INTEGER NOT NULL CHECK ("amountGrosze" >= 0 AND "amountGrosze" <= 100000000),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "CostContractAmount_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL))
);
CREATE INDEX "CostContractAmount_contractId_effectiveFrom_idx" ON "CostContractAmount"("contractId", "effectiveFrom");
CREATE UNIQUE INDEX "CostContractAmount_active_contract_month_key" ON "CostContractAmount"("contractId", "effectiveFrom") WHERE "revokedAt" IS NULL;

CREATE TABLE "CostContractSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    "jagPercent" INTEGER NOT NULL CHECK ("jagPercent" BETWEEN 0 AND 100),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "CostContractSplit_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL))
);
CREATE INDEX "CostContractSplit_contractId_effectiveFrom_idx" ON "CostContractSplit"("contractId", "effectiveFrom");
CREATE UNIQUE INDEX "CostContractSplit_active_contract_month_key" ON "CostContractSplit"("contractId", "effectiveFrom") WHERE "revokedAt" IS NULL;

CREATE TABLE "CostContractAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostContractAuditEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CostContractAuditEvent_contractId_createdAt_idx" ON "CostContractAuditEvent"("contractId", "createdAt");

-- History is kept: contracts are ended, amounts and splits revoked, audit never edited.
CREATE TRIGGER "CostContract_no_delete" BEFORE DELETE ON "CostContract"
BEGIN SELECT RAISE(ABORT, 'cost contracts cannot be deleted; end them instead'); END;

CREATE TRIGGER "CostContractAmount_no_delete" BEFORE DELETE ON "CostContractAmount"
BEGIN SELECT RAISE(ABORT, 'cost contract amounts are append-only; revoke instead'); END;
CREATE TRIGGER "CostContractAmount_immutable" BEFORE UPDATE ON "CostContractAmount"
WHEN OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL
  OR NEW."contractId" IS NOT OLD."contractId" OR NEW."effectiveFrom" IS NOT OLD."effectiveFrom"
  OR NEW."amountGrosze" IS NOT OLD."amountGrosze" OR NEW."createdById" IS NOT OLD."createdById" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'cost contract amounts are append-only; revoke instead'); END;

CREATE TRIGGER "CostContractSplit_no_delete" BEFORE DELETE ON "CostContractSplit"
BEGIN SELECT RAISE(ABORT, 'cost contract splits are append-only; revoke instead'); END;
CREATE TRIGGER "CostContractSplit_immutable" BEFORE UPDATE ON "CostContractSplit"
WHEN OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL
  OR NEW."contractId" IS NOT OLD."contractId" OR NEW."effectiveFrom" IS NOT OLD."effectiveFrom"
  OR NEW."jagPercent" IS NOT OLD."jagPercent" OR NEW."createdById" IS NOT OLD."createdById" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'cost contract splits are append-only; revoke instead'); END;

CREATE TRIGGER "CostContractAuditEvent_no_update" BEFORE UPDATE ON "CostContractAuditEvent"
BEGIN SELECT RAISE(ABORT, 'cost contract audit events are append-only'); END;
CREATE TRIGGER "CostContractAuditEvent_no_delete" BEFORE DELETE ON "CostContractAuditEvent"
BEGIN SELECT RAISE(ABORT, 'cost contract audit events are append-only'); END;
