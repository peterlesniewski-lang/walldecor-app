-- Legacy repair for catalog rows created before the active-hierarchy triggers.
-- No audit event can be written here: a migration has no authenticated actor.
-- Historical scopes, snapshots, and catalog records are preserved; only active
-- descendants below an archived parent are archived.

-- Deactivate products first so the parent-archive guard installed in 020200
-- accepts the subsequent type repair.
UPDATE "InstallationCatalogProduct"
SET
  "isActive" = 0,
  "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = 1
  AND (
    EXISTS (
      SELECT 1
      FROM "InstallationCatalogType" AS "type"
      WHERE "type"."id" = "InstallationCatalogProduct"."typeId"
        AND "type"."isActive" = 0
    )
    OR EXISTS (
      SELECT 1
      FROM "InstallationCatalogType" AS "type"
      INNER JOIN "InstallationCatalogCategory" AS "category"
        ON "category"."id" = "type"."categoryId"
      WHERE "type"."id" = "InstallationCatalogProduct"."typeId"
        AND "category"."isActive" = 0
    )
  );

-- Once descendants are inactive, deactivate types below archived categories.
UPDATE "InstallationCatalogType"
SET
  "isActive" = 0,
  "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = 1
  AND EXISTS (
    SELECT 1
    FROM "InstallationCatalogCategory" AS "category"
    WHERE "category"."id" = "InstallationCatalogType"."categoryId"
      AND "category"."isActive" = 0
  );
