-- Month-level payroll data (ADMIN-only). The payroll list number belongs to the month, not to a
-- settlement version: it is editable at any time and changing it never creates a version.
-- Approving from the month sheet copies the current number into the new version's
-- "payrollOfficeReference". Additive: existing payroll rows are unchanged.

CREATE TABLE "PayrollMonth" (
    "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
    "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
    "listReference" TEXT CHECK ("listReference" IS NULL OR (length(trim("listReference")) >= 1 AND length("listReference") <= 200)),
    "updatedById" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("year", "month")
);
