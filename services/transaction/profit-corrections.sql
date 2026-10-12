-- Migration 005. Apply once after migration 004. Keeps all prior reports.
BEGIN;
ALTER TABLE sajada.profit_report
 ADD COLUMN cancelled_by text,
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancellation_reference text,
 ADD COLUMN cancellation_reason text,
 ADD COLUMN replaces_report_id uuid,
 ADD CONSTRAINT profit_replacement_fk FOREIGN KEY(tenant_id,replaces_report_id) REFERENCES sajada.profit_report(tenant_id,id),
 ADD CONSTRAINT profit_no_self_replacement CHECK(replaces_report_id IS DISTINCT FROM id),
 ADD CONSTRAINT profit_one_replacement UNIQUE(tenant_id,replaces_report_id);
ALTER TABLE sajada.profit_report DROP CONSTRAINT profit_report_tenant_id_member_id_period_key;
-- Replace only the two old checks that mention lifecycle status. Other checks stay.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint
 WHERE conrelid='sajada.profit_report'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
 EXECUTE format('ALTER TABLE sajada.profit_report DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE sajada.profit_report
 ADD CONSTRAINT profit_status_values CHECK(status IN ('draft','settled','cancelled')),
 ADD CONSTRAINT profit_lifecycle_fields CHECK(COALESCE(
 (status='draft' AND settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL
  AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reference IS NULL AND cancellation_reason IS NULL)
 OR (status='settled' AND settled_at IS NOT NULL AND length(trim(settled_by))>0
  AND length(trim(settlement_reference)) BETWEEN 1 AND 128
  AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reference IS NULL AND cancellation_reason IS NULL)
 OR (status='cancelled' AND settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL
  AND cancelled_at IS NOT NULL AND length(trim(cancelled_by))>0
  AND length(trim(cancellation_reference)) BETWEEN 1 AND 128
  AND length(trim(cancellation_reason)) BETWEEN 1 AND 1000),false));
CREATE UNIQUE INDEX one_active_profit_period ON sajada.profit_report(tenant_id,member_id,period) WHERE status<>'cancelled';
CREATE OR REPLACE FUNCTION sajada.guard_profit_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('settled','cancelled') THEN
  RAISE EXCEPTION 'Final profit report is immutable' USING ERRCODE='55000';
 END IF;
 IF (NEW.tenant_id,NEW.id,NEW.member_id,NEW.period,NEW.revenue,NEW.cost,NEW.request_key,NEW.request_hash,NEW.result,NEW.created_by,NEW.created_at,NEW.replaces_report_id)
 IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.member_id,OLD.period,OLD.revenue,OLD.cost,OLD.request_key,OLD.request_hash,OLD.result,OLD.created_by,OLD.created_at,OLD.replaces_report_id)
 THEN RAISE EXCEPTION 'Draft calculation is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
-- Check correction lineage at the database boundary as well as in the service.
CREATE FUNCTION sajada.check_profit_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source sajada.profit_report;
BEGIN
 IF NEW.replaces_report_id IS NOT NULL THEN
  SELECT * INTO source FROM sajada.profit_report WHERE tenant_id=NEW.tenant_id AND id=NEW.replaces_report_id;
  IF NOT FOUND OR source.status<>'cancelled' OR source.member_id<>NEW.member_id OR source.period<>NEW.period THEN
   RAISE EXCEPTION 'Replacement must reference cancelled report for same tenant member and period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profit_replacement_guard BEFORE INSERT ON sajada.profit_report FOR EACH ROW EXECUTE FUNCTION sajada.check_profit_replacement();
COMMIT;
