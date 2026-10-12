-- Migration 016 after po-confirmation.sql. Only accepted units link to inventory/AP source.
BEGIN;
CREATE TABLE sajada.purchase_inspection(
 tenant_id uuid NOT NULL,id uuid NOT NULL,order_id uuid NOT NULL,receipt_id uuid,data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,receipt_id),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.purchase_order(tenant_id,id),FOREIGN KEY(tenant_id,receipt_id) REFERENCES sajada.purchase_receipt(tenant_id,id),
 CONSTRAINT inspection_data CHECK(data ?& ARRAY['id','orderId','accepted','rejected','remainingBefore','reason','actor','at'] AND NOT jsonb_path_exists(data,'$.* ? (@ == null)')
 AND data->>'id'=id::text AND data->>'orderId'=order_id::text
 AND jsonb_typeof(data->'accepted')='number' AND jsonb_typeof(data->'rejected')='number' AND jsonb_typeof(data->'remainingBefore')='number'
 AND (data->>'accepted')::bigint BETWEEN 0 AND 1000000000 AND (data->>'rejected')::bigint BETWEEN 0 AND 1000000000
 AND (data->>'remainingBefore')::bigint BETWEEN 1 AND 1000000000
 AND (data->>'accepted')::bigint+(data->>'rejected')::bigint BETWEEN 1 AND (data->>'remainingBefore')::bigint
 AND jsonb_typeof(data->'reason')='string' AND length(data->>'reason')<=1000 AND ((data->>'rejected')::bigint=0 OR length(trim(data->>'reason'))>0)
 AND jsonb_typeof(data->'actor')='string' AND length(trim(data->>'actor')) BETWEEN 1 AND 200 AND jsonb_typeof(data->'at')='string' AND (data->>'at')::timestamptz IS NOT NULL
 AND (((data->>'accepted')::bigint=0 AND receipt_id IS NULL AND NOT(data ? 'receiptId')) OR ((data->>'accepted')::bigint>0 AND receipt_id IS NOT NULL AND receipt_id=id AND data ? 'receiptId' AND jsonb_typeof(data->'receiptId')='string' AND data->>'receiptId'=receipt_id::text))));
ALTER TABLE sajada.purchase_inspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE sajada.purchase_inspection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.purchase_inspection USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION sajada.guard_po_inspection() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p jsonb; r jsonb; accepted bigint; BEGIN
 SELECT data INTO p FROM sajada.purchase_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id FOR UPDATE;
 accepted=(NEW.data->>'accepted')::bigint;
 IF p IS NULL OR p->>'status' NOT IN ('approved','closed') OR (NEW.data->>'at')::timestamptz<(p->>'approvedAt')::timestamptz THEN RAISE EXCEPTION 'Approved PO and valid inspection time required'; END IF;
 IF (NEW.data->>'remainingBefore')::bigint<>(p->>'quantity')::bigint-(p->>'received')::bigint+accepted THEN RAISE EXCEPTION 'Inspection snapshot must match remaining PO before acceptance'; END IF;
 IF accepted>0 THEN
 SELECT data INTO r FROM sajada.purchase_receipt WHERE tenant_id=NEW.tenant_id AND id=NEW.receipt_id;
 IF r IS NULL OR r->>'orderId'<>NEW.order_id::text OR (r->>'quantity')::bigint<>accepted OR r->>'actor' IS DISTINCT FROM NEW.data->>'actor' OR r->>'at' IS DISTINCT FROM NEW.data->>'at' THEN RAISE EXCEPTION 'Accepted inspection must match exact receipt audit'; END IF;
 ELSIF p->>'status'<>'approved' OR (p->>'received')::bigint>=(p->>'quantity')::bigint THEN RAISE EXCEPTION 'Rejection only requires open approved PO'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER inspection_insert_guard BEFORE INSERT ON sajada.purchase_inspection FOR EACH ROW EXECUTE FUNCTION sajada.guard_po_inspection();
CREATE TRIGGER inspection_history_guard BEFORE UPDATE OR DELETE ON sajada.purchase_inspection FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
COMMIT;
