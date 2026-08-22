-- Submitted client answers are a history record. UPDATE and DELETE guards
-- exist in the original client-form migration; this additive guard closes the
-- remaining direct INSERT path without restricting any DRAFT/correction draft.
CREATE TRIGGER "InstallationAnswer_submitted_insert_guard"
BEFORE INSERT ON "InstallationAnswer"
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM "InstallationFormSubmission" WHERE "id" = NEW."submissionId" AND "status" = 'SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'submitted installation answers are immutable');
END;
