-- Migration 017 after po-inspection.sql. Allocation records never move stock again.
BEGIN;
CREATE TABLE sajada.purchase_replacement(
 tenant_id uuid NOT NULL,id uuid NOT NULL,inspection_id uuid NOT NULL,receipt_id uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,inspection_id) REFERENCES sajada.purchase_inspection(tenant_id,id),FOREIGN KEY(tenant_id,receipt_id) REFERENCES sajada.purchase_receipt(tenant_id,id),
 CONSTRAINT replacement_data CHECK(data ?& ARRAY['id','inspectionId','receiptId','quantity','reference','note','actor','at'] AND NOT jsonb_path_exists(data,'$.* ? (@ == null)')
 AND data->>'id'=id::text AND data->>'inspectionId'=inspection_id::text AND data->>'receiptId'=receipt_id::text AND jsonb_typeof(data->'quantity')='number' AND (data->>'quantity')::bigint=quantity
 AND jsonb_typeof(data->'reference')='string' AND length(trim(data->>'reference')) BETWEEN 1 AND 100
 AND jsonb_typeof(data->'note')='string' AND length(trim(data->>'note')) BETWEEN 1 AND 1000
 AND jsonb_typeof(data->'actor')='string' AND length(trim(data->>'actor')) BETWEEN 1 AND 200
 AND jsonb_typeof(data->'at')='string' AND (data->>'at')::timestamptz IS NOT NULL));
CREATE UNIQUE INDEX replacement_reference_unique ON sajada.purchase_replacement(tenant_id,inspection_id,lower(trim(data->>'reference')));
ALTER TABLE sajada.purchase_replacement ENABLE ROW LEVEL SECURITY;
ALTER TABLE sajada.purchase_replacement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.purchase_replacement USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION sajada.guard_po_replacement() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE q jsonb; r jsonb; case_used bigint; receipt_used bigint; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':inventory',0));
 SELECT data INTO q FROM sajada.purchase_inspection WHERE tenant_id=NEW.tenant_id AND id=NEW.inspection_id;
 SELECT data INTO r FROM sajada.purchase_receipt WHERE tenant_id=NEW.tenant_id AND id=NEW.receipt_id;
 IF q IS NULL OR r IS NULL OR (q->>'rejected')::bigint<1 OR q->>'orderId' IS DISTINCT FROM r->>'orderId' OR q->>'receiptId'=NEW.receipt_id::text
 OR (r->>'at')::timestamptz <= (q->>'at')::timestamptz OR (NEW.data->>'at')::timestamptz < (r->>'at')::timestamptz THEN RAISE EXCEPTION 'Replacement must use later accepted receipt of same PO'; END IF;
 SELECT coalesce(sum(quantity),0) INTO case_used FROM sajada.purchase_replacement WHERE tenant_id=NEW.tenant_id AND inspection_id=NEW.inspection_id;
 SELECT coalesce(sum(quantity),0) INTO receipt_used FROM sajada.purchase_replacement WHERE tenant_id=NEW.tenant_id AND receipt_id=NEW.receipt_id;
 IF case_used+NEW.quantity>(q->>'rejected')::bigint OR receipt_used+NEW.quantity>(r->>'quantity')::bigint THEN RAISE EXCEPTION 'Replacement exceeds rejection or receipt allocation capacity'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER replacement_insert_guard BEFORE INSERT ON sajada.purchase_replacement FOR EACH ROW EXECUTE FUNCTION sajada.guard_po_replacement();
CREATE TRIGGER replacement_history_guard BEFORE UPDATE OR DELETE ON sajada.purchase_replacement FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
COMMIT;
