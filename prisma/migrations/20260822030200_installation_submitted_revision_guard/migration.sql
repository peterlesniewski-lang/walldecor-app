-- Submitted client revisions are immutable records. Draft and correction-draft
-- rows remain mutable until the submit transition changes OLD.status.
CREATE TRIGGER "InstallationFormSubmission_submitted_update_guard"
BEFORE UPDATE ON "InstallationFormSubmission"
FOR EACH ROW WHEN OLD."status" = 'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'submitted installation revisions are immutable');
END;

CREATE TRIGGER "InstallationFormSubmission_submitted_delete_guard"
BEFORE DELETE ON "InstallationFormSubmission"
FOR EACH ROW WHEN OLD."status" = 'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'submitted installation revisions are immutable');
END;
