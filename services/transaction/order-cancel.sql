-- Migration 008 after inventory.sql
BEGIN;
ALTER TABLE sajada.sales_order ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by text, ADD COLUMN cancel_reason text;
ALTER TABLE sajada.sales_order ADD CONSTRAINT order_cancel_audit CHECK (
 (status='cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND length(trim(cancelled_by)) BETWEEN 1 AND 200 AND length(trim(cancel_reason)) BETWEEN 1 AND 200)
 OR (status<>'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL));
CREATE FUNCTION sajada.guard_cancelled_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='cancelled' THEN RAISE EXCEPTION 'Cancelled orders are immutable'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER cancelled_order_guard BEFORE UPDATE OR DELETE ON sajada.sales_order
 FOR EACH ROW WHEN (OLD.status='cancelled') EXECUTE FUNCTION sajada.guard_cancelled_order();
COMMIT;
