-- An active installer account must always point at an active employee.
-- These guards are intentionally forward-looking: the migration performs no
-- backfill or one-off update of existing rows.

CREATE TRIGGER "User_active_installer_employee_insert_guard"
BEFORE INSERT ON "User"
WHEN NEW."role" = 'INSTALLER'
  AND NEW."isActive" = 1
  AND (
    NEW."employeeId" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "Employee"
      WHERE "id" = NEW."employeeId"
        AND "active" = 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'active installer user requires active employee');
END;

CREATE TRIGGER "User_active_installer_employee_update_guard"
BEFORE UPDATE OF "role", "isActive", "employeeId" ON "User"
WHEN NEW."role" = 'INSTALLER'
  AND NEW."isActive" = 1
  AND (
    NEW."employeeId" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "Employee"
      WHERE "id" = NEW."employeeId"
        AND "active" = 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'active installer user requires active employee');
END;

CREATE TRIGGER "Employee_inactive_installer_user_guard"
AFTER UPDATE OF "active" ON "Employee"
WHEN OLD."active" = 1 AND NEW."active" = 0
BEGIN
  UPDATE "User"
  SET "isActive" = 0
  WHERE "employeeId" = NEW."id"
    AND "role" = 'INSTALLER'
    AND "isActive" = 1;
END;
