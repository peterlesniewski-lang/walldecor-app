-- Dynamic catalog, immutable form-template versions, rooms/scopes and audited measurements.
-- Catalog names are stored with a normalized case-insensitive key by the service layer.
CREATE TABLE "InstallationCatalogCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationCatalogCategory_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationCatalogType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationCatalogType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InstallationCatalogCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationCatalogType_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationCatalogProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "manufacturer" TEXT,
    "collection" TEXT,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationCatalogProduct_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "InstallationCatalogType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationCatalogProduct_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationFormTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationFormTemplate_version_check" CHECK ("version" > 0),
    CONSTRAINT "InstallationFormTemplate_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
    CONSTRAINT "InstallationFormTemplate_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationQuestionDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "help" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "optionsJson" TEXT,
    "conditionJson" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationQuestionDefinition_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InstallationFormTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationQuestionDefinition_type_check" CHECK ("type" IN ('YES_NO_UNKNOWN', 'NUMBER', 'DIMENSION', 'TEXT', 'SINGLE', 'MULTI', 'FILE')),
    CONSTRAINT "InstallationQuestionDefinition_riskLevel_check" CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "InstallationQuestionDefinition_key_check" CHECK (length(trim("key")) > 0)
);

CREATE TABLE "InstallationOrderFormSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "schemaJson" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationOrderFormSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrderFormSnapshot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InstallationFormTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrderFormSnapshot_version_check" CHECK ("templateVersion" > 0)
);

CREATE TABLE "InstallationRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationRoom_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationRoom_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationScope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationScope_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "InstallationRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationScope_name_check" CHECK (length(trim("name")) > 0)
);

CREATE TABLE "InstallationScopeProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "productCodeSnapshot" TEXT,
    "manufacturerSnapshot" TEXT,
    "collectionSnapshot" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationScopeProduct_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeProduct_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "InstallationCatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeProduct_snapshot_name_check" CHECK (length(trim("productNameSnapshot")) > 0)
);

CREATE TABLE "InstallationMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "scopeId" TEXT,
    "elementName" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "authorId" TEXT,
    "authorContext" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationMeasurement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "InstallationRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationMeasurement_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationMeasurement_value_check" CHECK (CAST("value" AS REAL) >= 0),
    CONSTRAINT "InstallationMeasurement_unit_check" CHECK ("unit" IN ('MM', 'CM', 'M', 'M2')),
    CONSTRAINT "InstallationMeasurement_source_check" CHECK ("source" IN ('CLIENT', 'EMPLOYEE', 'INSTALLER')),
    CONSTRAINT "InstallationMeasurement_element_check" CHECK (length(trim("elementName")) > 0)
);

CREATE UNIQUE INDEX "InstallationCatalogCategory_nameKey_key" ON "InstallationCatalogCategory"("nameKey");
CREATE INDEX "InstallationCatalogCategory_isActive_sortOrder_idx" ON "InstallationCatalogCategory"("isActive", "sortOrder");
CREATE UNIQUE INDEX "InstallationCatalogType_categoryId_nameKey_key" ON "InstallationCatalogType"("categoryId", "nameKey");
CREATE INDEX "InstallationCatalogType_categoryId_isActive_sortOrder_idx" ON "InstallationCatalogType"("categoryId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "InstallationCatalogProduct_typeId_nameKey_key" ON "InstallationCatalogProduct"("typeId", "nameKey");
CREATE INDEX "InstallationCatalogProduct_typeId_isActive_sortOrder_idx" ON "InstallationCatalogProduct"("typeId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "InstallationFormTemplate_familyId_version_key" ON "InstallationFormTemplate"("familyId", "version");
CREATE INDEX "InstallationFormTemplate_nameKey_status_idx" ON "InstallationFormTemplate"("nameKey", "status");
CREATE INDEX "InstallationFormTemplate_familyId_status_idx" ON "InstallationFormTemplate"("familyId", "status");
CREATE UNIQUE INDEX "InstallationQuestionDefinition_templateId_key_key" ON "InstallationQuestionDefinition"("templateId", "key");
CREATE INDEX "InstallationQuestionDefinition_templateId_sortOrder_idx" ON "InstallationQuestionDefinition"("templateId", "sortOrder");
CREATE UNIQUE INDEX "InstallationOrderFormSnapshot_orderId_key" ON "InstallationOrderFormSnapshot"("orderId");
CREATE INDEX "InstallationOrderFormSnapshot_templateId_templateVersion_idx" ON "InstallationOrderFormSnapshot"("templateId", "templateVersion");
CREATE INDEX "InstallationRoom_orderId_sortOrder_idx" ON "InstallationRoom"("orderId", "sortOrder");
CREATE INDEX "InstallationScope_roomId_sortOrder_idx" ON "InstallationScope"("roomId", "sortOrder");
CREATE INDEX "InstallationScopeProduct_scopeId_sortOrder_idx" ON "InstallationScopeProduct"("scopeId", "sortOrder");
CREATE INDEX "InstallationScopeProduct_catalogProductId_idx" ON "InstallationScopeProduct"("catalogProductId");
CREATE INDEX "InstallationMeasurement_roomId_createdAt_idx" ON "InstallationMeasurement"("roomId", "createdAt");
CREATE INDEX "InstallationMeasurement_scopeId_createdAt_idx" ON "InstallationMeasurement"("scopeId", "createdAt");
