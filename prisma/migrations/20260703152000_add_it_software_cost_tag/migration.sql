INSERT INTO "CostTag" ("id", "groupId", "slug", "name", "active")
SELECT 'role-it-software', "id", 'it-software', 'Oprogramowanie i usługi IT', 1
FROM "CostTagGroup"
WHERE "slug" = 'role'
  AND NOT EXISTS (
    SELECT 1 FROM "CostTag" WHERE "slug" = 'it-software'
  );
