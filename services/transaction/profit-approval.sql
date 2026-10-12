-- Migration 006. Apply once after 005. Historic settled rows are preserved.
BEGIN;
ALTER TABLE sajada.profit_report
 ADD COLUMN approved_by text,
 ADD COLUMN approved_at timestamptz,
 ADD COLUMN approval_reference text,
 ADD CONSTRAINT profit_approval_complete CHECK(COALESCE(
 (approved_by IS NULL AND approved_at IS NULL AND approval_reference IS NULL)
 OR (length(trim(approved_by))>0 AND approved_at IS NOT NULL
  AND length(trim(approval_reference)) BETWEEN 1 AND 128 AND approved_by<>created_by),false));
CREATE FUNCTION sajada.guard_profit_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reference IS NOT NULL THEN
   RAISE EXCEPTION 'New reports must start as unapproved drafts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.approved_by IS NOT NULL AND
 (NEW.approved_by,NEW.approved_at,NEW.approval_reference) IS DISTINCT FROM
 (OLD.approved_by,OLD.approved_at,OLD.approval_reference) THEN
  RAISE EXCEPTION 'Approval is immutable' USING ERRCODE='55000';
 END IF;
 IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL AND
 (OLD.status<>'draft' OR NEW.status<>'draft') THEN
  RAISE EXCEPTION 'Approval must be recorded before settlement' USING ERRCODE='23514';
 END IF;
 IF OLD.status='draft' AND NEW.status='settled' AND OLD.approved_by IS NULL THEN
  RAISE EXCEPTION 'Independent approval required before settlement' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profit_approval_guard BEFORE INSERT OR UPDATE ON sajada.profit_report
 FOR EACH ROW EXECUTE FUNCTION sajada.guard_profit_approval();
COMMIT;
