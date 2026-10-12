-- Migration 018: correction ledger, never delete the original allocation.
BEGIN;
CREATE TABLE sajada.purchase_replacement_reversal(
 tenant_id uuid NOT NULL,id uuid NOT NULL,replacement_id uuid NOT NULL,data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,replacement_id),
 FOREIGN KEY(tenant_id,replacement_id) REFERENCES sajada.purchase_replacement(tenant_id,id),
 CHECK(data ?& ARRAY['id','replacementId','reason','actor','at'] AND NOT jsonb_path_exists(data,'$.* ? (@ == null)')
 AND data->>'id'=id::text AND data->>'replacementId'=replacement_id::text
 AND jsonb_typeof(data->'reason')='string' AND length(trim(data->>'reason')) BETWEEN 1 AND 1000
 AND jsonb_typeof(data->'actor')='string' AND length(trim(data->>'actor')) BETWEEN 1 AND 200
 AND jsonb_typeof(data->'at')='string' AND (data->>'at')::timestamptz IS NOT NULL));
ALTER TABLE sajada.purchase_replacement_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sajada.purchase_replacement_reversal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.purchase_replacement_reversal USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION sajada.guard_po_replacement_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':inventory',0));
 SELECT data INTO original FROM sajada.purchase_replacement WHERE tenant_id=NEW.tenant_id AND id=NEW.replacement_id;
 IF original IS NULL OR (NEW.data->>'at')::timestamptz < (original->>'at')::timestamptz THEN RAISE EXCEPTION 'Reversal must follow original allocation'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER reversal_insert_guard BEFORE INSERT ON sajada.purchase_replacement_reversal FOR EACH ROW EXECUTE FUNCTION sajada.guard_po_replacement_reversal();
CREATE TRIGGER reversal_history_guard BEFORE UPDATE OR DELETE ON sajada.purchase_replacement_reversal FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE OR REPLACE FUNCTION sajada.guard_po_replacement() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE q jsonb; r jsonb; case_used bigint; receipt_used bigint; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':inventory',0));
 SELECT data INTO q FROM sajada.purchase_inspection WHERE tenant_id=NEW.tenant_id AND id=NEW.inspection_id;
 SELECT data INTO r FROM sajada.purchase_receipt WHERE tenant_id=NEW.tenant_id AND id=NEW.receipt_id;
 IF q IS NULL OR r IS NULL OR (q->>'rejected')::bigint<1 OR q->>'orderId' IS DISTINCT FROM r->>'orderId' OR q->>'receiptId'=NEW.receipt_id::text
 OR (r->>'at')::timestamptz <= (q->>'at')::timestamptz OR (NEW.data->>'at')::timestamptz < (r->>'at')::timestamptz THEN RAISE EXCEPTION 'Replacement must use later accepted receipt of same PO'; END IF;
 SELECT coalesce(sum(quantity),0) INTO case_used FROM sajada.purchase_replacement p WHERE p.tenant_id=NEW.tenant_id AND p.inspection_id=NEW.inspection_id AND NOT EXISTS(SELECT 1 FROM sajada.purchase_replacement_reversal v WHERE v.tenant_id=p.tenant_id AND v.replacement_id=p.id);
 SELECT coalesce(sum(quantity),0) INTO receipt_used FROM sajada.purchase_replacement p WHERE p.tenant_id=NEW.tenant_id AND p.receipt_id=NEW.receipt_id AND NOT EXISTS(SELECT 1 FROM sajada.purchase_replacement_reversal v WHERE v.tenant_id=p.tenant_id AND v.replacement_id=p.id);
 IF case_used+NEW.quantity>(q->>'rejected')::bigint OR receipt_used+NEW.quantity>(r->>'quantity')::bigint THEN RAISE EXCEPTION 'Replacement exceeds rejection or receipt allocation capacity'; END IF;
 IF EXISTS(SELECT 1 FROM sajada.purchase_replacement_reversal WHERE tenant_id=NEW.tenant_id AND (data->>'at')::timestamptz>(NEW.data->>'at')::timestamptz) THEN RAISE EXCEPTION 'Allocation cannot predate latest reversal'; END IF;
 RETURN NEW; END $$;
COMMIT;
