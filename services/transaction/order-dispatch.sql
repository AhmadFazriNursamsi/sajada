-- Migration 009 after order-cancel.sql
BEGIN;
ALTER TABLE sajada.sales_order ADD COLUMN dispatched_at timestamptz,
 ADD COLUMN dispatched_by text, ADD COLUMN dispatch_reference text;
ALTER TABLE sajada.sales_order ADD CONSTRAINT dispatch_audit CHECK (
 (dispatched_at IS NULL AND dispatched_by IS NULL AND dispatch_reference IS NULL)
 OR (dispatched_at IS NOT NULL AND dispatched_by IS NOT NULL AND dispatch_reference IS NOT NULL
 AND length(trim(dispatched_by)) BETWEEN 1 AND 200 AND length(trim(dispatch_reference)) BETWEEN 1 AND 100
 AND inventory_location_id IS NOT NULL AND status='paid'));
CREATE UNIQUE INDEX dispatch_reference_unique ON sajada.sales_order(tenant_id,dispatch_reference) WHERE dispatched_at IS NOT NULL;
CREATE FUNCTION sajada.guard_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dispatched orders cannot be deleted'; END IF;
 IF (NEW.dispatched_at,NEW.dispatched_by,NEW.dispatch_reference,NEW.inventory_location_id,NEW.member_id,NEW.total,NEW.total_base)
 IS DISTINCT FROM (OLD.dispatched_at,OLD.dispatched_by,OLD.dispatch_reference,OLD.inventory_location_id,OLD.member_id,OLD.total,OLD.total_base)
 THEN RAISE EXCEPTION 'Dispatch audit and order snapshot are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_audit_guard BEFORE UPDATE OR DELETE ON sajada.sales_order
 FOR EACH ROW WHEN (OLD.dispatched_at IS NOT NULL) EXECUTE FUNCTION sajada.guard_dispatch_audit();
COMMIT;
