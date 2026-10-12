-- Migration 010 after order-dispatch.sql
BEGIN;
ALTER TABLE sajada.sales_order ADD COLUMN received_at timestamptz,
 ADD COLUMN received_by text, ADD COLUMN receipt_reference text, ADD COLUMN receiver_name text;
ALTER TABLE sajada.sales_order ADD CONSTRAINT receipt_audit CHECK (
 (received_at IS NULL AND received_by IS NULL AND receipt_reference IS NULL AND receiver_name IS NULL)
 OR (received_at IS NOT NULL AND received_by IS NOT NULL AND receipt_reference IS NOT NULL AND receiver_name IS NOT NULL
 AND length(trim(received_by)) BETWEEN 1 AND 200 AND length(trim(receipt_reference)) BETWEEN 1 AND 100
 AND length(trim(receiver_name)) BETWEEN 1 AND 100 AND dispatched_at IS NOT NULL AND received_at>=dispatched_at AND status='paid'));
CREATE UNIQUE INDEX receipt_reference_unique ON sajada.sales_order(tenant_id,receipt_reference) WHERE received_at IS NOT NULL;
CREATE FUNCTION sajada.guard_receipt_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Received orders cannot be deleted'; END IF;
 IF (NEW.received_at,NEW.received_by,NEW.receipt_reference,NEW.receiver_name)
 IS DISTINCT FROM (OLD.received_at,OLD.received_by,OLD.receipt_reference,OLD.receiver_name)
 THEN RAISE EXCEPTION 'Receipt audit is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_audit_guard BEFORE UPDATE OR DELETE ON sajada.sales_order
 FOR EACH ROW WHEN (OLD.received_at IS NOT NULL) EXECUTE FUNCTION sajada.guard_receipt_audit();
COMMIT;
