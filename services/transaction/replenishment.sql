-- Migration 011 after order-receipt.sql
BEGIN;
CREATE TABLE sajada.reorder_policy(tenant_id uuid NOT NULL,location_id uuid NOT NULL,product_id uuid NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,location_id,product_id),FOREIGN KEY(tenant_id,location_id) REFERENCES sajada.inventory_location(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id));
CREATE TABLE sajada.purchase_order(tenant_id uuid NOT NULL,id uuid NOT NULL,location_id uuid NOT NULL,product_id uuid NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,location_id) REFERENCES sajada.inventory_location(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id));
CREATE TABLE sajada.purchase_receipt(tenant_id uuid NOT NULL,id uuid NOT NULL,order_id uuid NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.purchase_order(tenant_id,id),FOREIGN KEY(tenant_id,id) REFERENCES sajada.inventory_document(tenant_id,id));
ALTER TABLE sajada.reorder_policy ADD CONSTRAINT policy_identity CHECK (data->>'locationId'=location_id::text AND data->>'productId'=product_id::text AND data ?& ARRAY['locationId','productId','safety','target','enabled']), ADD CONSTRAINT policy_levels CHECK ((data->>'safety')::bigint>=0 AND (data->>'target')::bigint>(data->>'safety')::bigint);
ALTER TABLE sajada.purchase_order ADD CONSTRAINT po_identity CHECK (data ?& ARRAY['id','locationId','productId','number','quantity','received','status','unitCost','currency'] AND data->>'id'=id::text AND data->>'locationId'=location_id::text AND data->>'productId'=product_id::text AND data->>'number'='PO-'||id::text), ADD CONSTRAINT po_amount CHECK ((data->>'quantity')::bigint BETWEEN 1 AND 1000000000 AND (data->>'received')::bigint BETWEEN 0 AND (data->>'quantity')::bigint AND (data->>'unitCost')::numeric>0 AND (data->>'unitCost')::numeric*(data->>'quantity')::numeric<=1000000000000 AND data->>'currency'='IDR'), ADD CONSTRAINT po_status CHECK ((data->>'status' IN ('draft','cancelled') AND (data->>'received')::bigint=0) OR (data->>'status'='approved' AND (data->>'received')::bigint<(data->>'quantity')::bigint AND data ?& ARRAY['approvedAt','approvedBy']) OR (data->>'status'='closed' AND (data->>'received')::bigint=(data->>'quantity')::bigint AND data ?& ARRAY['approvedAt','approvedBy']));
ALTER TABLE sajada.purchase_receipt ADD CONSTRAINT receipt_identity CHECK (data ?& ARRAY['id','orderId','quantity','actor','at'] AND data->>'id'=id::text AND data->>'orderId'=order_id::text AND (data->>'quantity')::bigint BETWEEN 1 AND 1000000000);
CREATE INDEX purchase_order_location ON sajada.purchase_order(tenant_id,location_id,product_id);
CREATE FUNCTION sajada.guard_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PO history cannot be deleted'; END IF;
 IF OLD.data->>'status' IN ('closed','cancelled') THEN RAISE EXCEPTION 'Final PO is immutable'; END IF;
 IF (NEW.tenant_id,NEW.id,NEW.location_id,NEW.product_id) IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.location_id,OLD.product_id)
 OR (NEW.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason']) IS DISTINCT FROM (OLD.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason']) THEN RAISE EXCEPTION 'PO snapshot is immutable'; END IF;
 IF (NEW.data->>'received')::bigint < (OLD.data->>'received')::bigint OR (NEW.data->>'received')::bigint > (NEW.data->>'quantity')::bigint THEN RAISE EXCEPTION 'PO receipt out of bounds'; END IF;
 IF OLD.data->>'status'='draft' AND NEW.data->>'status' NOT IN ('approved','cancelled') OR OLD.data->>'status'='approved' AND NEW.data->>'status' NOT IN ('approved','closed') THEN RAISE EXCEPTION 'Invalid PO transition'; END IF;
 IF OLD.data->>'status'='approved' AND (NEW.data->>'approvedAt',NEW.data->>'approvedBy') IS DISTINCT FROM (OLD.data->>'approvedAt',OLD.data->>'approvedBy') THEN RAISE EXCEPTION 'PO approval immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER po_guard BEFORE UPDATE OR DELETE ON sajada.purchase_order FOR EACH ROW EXECUTE FUNCTION sajada.guard_purchase_order();
CREATE TRIGGER purchase_receipt_guard BEFORE UPDATE OR DELETE ON sajada.purchase_receipt FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['reorder_policy','purchase_order','purchase_receipt'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true)::uuid)',t);END LOOP;END $$;
COMMIT;
