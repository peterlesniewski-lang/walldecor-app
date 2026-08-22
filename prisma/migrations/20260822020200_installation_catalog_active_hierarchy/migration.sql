-- A catalog child may be active only while every catalog parent is active.
-- Service checks improve messages, while these triggers make the invariant
-- durable for direct Prisma/SQL writes and concurrent SQLite writers.

CREATE TRIGGER "InstallationCatalogType_active_parent_insert"
BEFORE INSERT ON "InstallationCatalogType"
WHEN NEW."isActive" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "InstallationCatalogCategory"
    WHERE "id" = NEW."categoryId" AND "isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Aktywny typ wymaga aktywnej kategorii.');
END;

CREATE TRIGGER "InstallationCatalogType_active_parent_update"
BEFORE UPDATE OF "isActive", "categoryId" ON "InstallationCatalogType"
WHEN NEW."isActive" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "InstallationCatalogCategory"
    WHERE "id" = NEW."categoryId" AND "isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Aktywny typ wymaga aktywnej kategorii.');
END;

CREATE TRIGGER "InstallationCatalogProduct_active_parent_insert"
BEFORE INSERT ON "InstallationCatalogProduct"
WHEN NEW."isActive" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "InstallationCatalogType" AS "type"
    JOIN "InstallationCatalogCategory" AS "category" ON "category"."id" = "type"."categoryId"
    WHERE "type"."id" = NEW."typeId"
      AND "type"."isActive" = 1
      AND "category"."isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Aktywny produkt wymaga aktywnego typu i kategorii.');
END;

CREATE TRIGGER "InstallationCatalogProduct_active_parent_update"
BEFORE UPDATE OF "isActive", "typeId" ON "InstallationCatalogProduct"
WHEN NEW."isActive" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "InstallationCatalogType" AS "type"
    JOIN "InstallationCatalogCategory" AS "category" ON "category"."id" = "type"."categoryId"
    WHERE "type"."id" = NEW."typeId"
      AND "type"."isActive" = 1
      AND "category"."isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Aktywny produkt wymaga aktywnego typu i kategorii.');
END;

-- Direct parent updates must not leave an invalid hierarchy either. The
-- service archives descendants first in its transaction, then the parent.
CREATE TRIGGER "InstallationCatalogCategory_archive_active_children"
BEFORE UPDATE OF "isActive" ON "InstallationCatalogCategory"
WHEN NEW."isActive" = 0
  AND EXISTS (
    SELECT 1 FROM "InstallationCatalogType"
    WHERE "categoryId" = OLD."id" AND "isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Nie można zarchiwizować kategorii z aktywnymi typami.');
END;

CREATE TRIGGER "InstallationCatalogType_archive_active_children"
BEFORE UPDATE OF "isActive" ON "InstallationCatalogType"
WHEN NEW."isActive" = 0
  AND EXISTS (
    SELECT 1 FROM "InstallationCatalogProduct"
    WHERE "typeId" = OLD."id" AND "isActive" = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Nie można zarchiwizować typu z aktywnymi produktami.');
END;
