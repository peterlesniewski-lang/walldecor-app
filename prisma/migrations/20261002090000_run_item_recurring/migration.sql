-- Tasks on a month-closing run can be one-off (recurring = false); they are skipped when the next month is copied from this run.
ALTER TABLE "ChecklistRunItem" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT true;
