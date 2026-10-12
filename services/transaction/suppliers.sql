-- Migration 013 after payables.sql. Existing free-text policies and POs remain valid.
BEGIN;
CREATE TABLE sajada.purchase_supplier(
 tenant_id uuid NOT NULL REFERENCES sajada.tenant(id),id uuid NOT NULL,data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),
 CONSTRAINT supplier_data CHECK (
 data ?& ARRAY['id','name','address','contact','phone','email','active','changedAt','changedBy']
 AND NOT jsonb_path_exists(data,'$.* ? (@ == null)')
 AND data->>'id'=id::text AND length(trim(data->>'name')) BETWEEN 1 AND 200
 AND length(trim(data->>'address')) BETWEEN 1 AND 1000
 AND length(data->>'contact')<=200 AND length(data->>'phone')<=80 AND length(data->>'email')<=254
 AND (length(trim(data->>'phone'))>0 OR length(trim(data->>'email'))>0)
 AND jsonb_typeof(data->'active')='boolean' AND length(trim(data->>'changedBy')) BETWEEN 1 AND 200
 AND length(data->>'changedAt')>0
 ));
CREATE UNIQUE INDEX supplier_name_unique ON sajada.purchase_supplier(tenant_id,lower(trim(data->>'name')));
ALTER TABLE sajada.purchase_supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE sajada.purchase_supplier FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.purchase_supplier USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION sajada.guard_supplier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deactivate supplier instead of deleting history'; END IF;
 IF (NEW.tenant_id,NEW.id) IS DISTINCT FROM (OLD.tenant_id,OLD.id) THEN RAISE EXCEPTION 'Supplier identity immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER supplier_guard BEFORE UPDATE OR DELETE ON sajada.purchase_supplier FOR EACH ROW EXECUTE FUNCTION sajada.guard_supplier();
ALTER TABLE sajada.reorder_policy ADD COLUMN supplier_id uuid GENERATED ALWAYS AS ((data->>'supplierId')::uuid) STORED,
 ADD FOREIGN KEY(tenant_id,supplier_id) REFERENCES sajada.purchase_supplier(tenant_id,id);
ALTER TABLE sajada.purchase_order ADD COLUMN supplier_id uuid GENERATED ALWAYS AS ((data->'supplierSnapshot'->>'id')::uuid) STORED,
 ADD FOREIGN KEY(tenant_id,supplier_id) REFERENCES sajada.purchase_supplier(tenant_id,id);
CREATE FUNCTION sajada.guard_supplier_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source jsonb; BEGIN
 IF NEW.data ? 'supplierSnapshot' THEN
 SELECT data INTO source FROM sajada.purchase_supplier WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->'supplierSnapshot'->>'id')::uuid;
 IF source IS NULL OR source->>'active'<>'true' OR NEW.data->'supplierSnapshot' IS DISTINCT FROM source OR NEW.data->>'supplier' IS DISTINCT FROM source->>'name' THEN RAISE EXCEPTION 'PO supplier snapshot must match active tenant supplier'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER supplier_snapshot_guard BEFORE INSERT ON sajada.purchase_order FOR EACH ROW EXECUTE FUNCTION sajada.guard_supplier_snapshot();
COMMIT;
