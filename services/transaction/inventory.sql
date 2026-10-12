-- Migration 007. Apply after 001 through 006, once in development/staging first.
BEGIN;
CREATE TABLE sajada.inventory_location (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('province','regency','district','member')),
 parent_id uuid, region_id text NOT NULL REFERENCES sajada.region, member_id uuid,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,parent_id) REFERENCES sajada.inventory_location(tenant_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 CHECK((kind='province' AND parent_id IS NULL) OR (kind<>'province' AND parent_id IS NOT NULL)),
 CHECK((kind='member' AND member_id IS NOT NULL) OR (kind<>'member' AND member_id IS NULL)),
 CHECK(parent_id IS DISTINCT FROM id), UNIQUE(tenant_id,member_id)
);
CREATE UNIQUE INDEX inventory_location_name ON sajada.inventory_location(tenant_id,lower(name));
CREATE TABLE sajada.inventory_config (
 tenant_id uuid PRIMARY KEY REFERENCES sajada.tenant, opening_location_id uuid NOT NULL,
 activated_by text NOT NULL, activated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,opening_location_id) REFERENCES sajada.inventory_location(tenant_id,id)
);
CREATE TABLE sajada.inventory_balance (
 tenant_id uuid NOT NULL, location_id uuid NOT NULL, product_id uuid NOT NULL,
 on_hand bigint NOT NULL DEFAULT 0 CHECK(on_hand BETWEEN 0 AND 1000000000),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND on_hand),
 minimum bigint NOT NULL DEFAULT 5 CHECK(minimum BETWEEN 0 AND 1000000000),
 PRIMARY KEY(tenant_id,location_id,product_id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES sajada.inventory_location(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id)
);
CREATE TABLE sajada.inventory_document (
 tenant_id uuid NOT NULL, id uuid NOT NULL, location_id uuid NOT NULL, product_id uuid NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), request_payload text NOT NULL,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,location_id) REFERENCES sajada.inventory_location(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id)
);
CREATE TABLE sajada.inventory_movement (
 tenant_id uuid NOT NULL, id text NOT NULL, document_id uuid NOT NULL, location_id uuid NOT NULL, product_id uuid NOT NULL,
 physical_delta bigint NOT NULL, reserved_delta bigint NOT NULL,
 after_physical bigint NOT NULL CHECK(after_physical BETWEEN 0 AND 1000000000),
 after_reserved bigint NOT NULL CHECK(after_reserved BETWEEN 0 AND after_physical),
 actor text NOT NULL, occurred_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES sajada.inventory_document(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id,product_id) REFERENCES sajada.inventory_balance(tenant_id,location_id,product_id)
);
ALTER TABLE sajada.sales_order ADD COLUMN inventory_location_id uuid,
 ADD CONSTRAINT order_inventory_location_fk FOREIGN KEY(tenant_id,inventory_location_id) REFERENCES sajada.inventory_location(tenant_id,id);
CREATE INDEX inventory_document_location ON sajada.inventory_document(tenant_id,location_id);
CREATE INDEX inventory_movement_card ON sajada.inventory_movement(tenant_id,location_id,product_id,occurred_at);
CREATE FUNCTION sajada.inventory_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Inventory history is append only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER immutable_inventory_movement BEFORE UPDATE OR DELETE ON sajada.inventory_movement FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE TRIGGER immutable_inventory_location BEFORE UPDATE OR DELETE ON sajada.inventory_location FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE TRIGGER immutable_inventory_config BEFORE UPDATE OR DELETE ON sajada.inventory_config FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE FUNCTION sajada.guard_inventory_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Inventory document cannot be deleted' USING ERRCODE='55000'; END IF;
 IF (NEW.tenant_id,NEW.id,NEW.location_id,NEW.product_id,NEW.request_payload) IS DISTINCT FROM
    (OLD.tenant_id,OLD.id,OLD.location_id,OLD.product_id,OLD.request_payload)
 OR (NEW.data-'status'-'returned') IS DISTINCT FROM (OLD.data-'status'-'returned') THEN
 RAISE EXCEPTION 'Inventory document snapshot is immutable' USING ERRCODE='55000'; END IF;
 IF (NEW.data->>'returned')::bigint<(OLD.data->>'returned')::bigint OR (NEW.data->>'returned')::bigint>(NEW.data->>'quantity')::bigint THEN
 RAISE EXCEPTION 'Invalid returned quantity' USING ERRCODE='23514'; END IF;
 IF NEW.data->>'status' IS DISTINCT FROM OLD.data->>'status' AND NOT
 ((OLD.data->>'kind'='transfer' AND OLD.data->>'status'='transit' AND NEW.data->>'status'='received') OR
 (OLD.data->>'kind'='reserve' AND OLD.data->>'status'='reserved' AND NEW.data->>'status' IN ('shipped','cancelled'))) THEN
 RAISE EXCEPTION 'Invalid inventory lifecycle' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER inventory_document_guard BEFORE UPDATE OR DELETE ON sajada.inventory_document FOR EACH ROW EXECUTE FUNCTION sajada.guard_inventory_document();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['inventory_location','inventory_config','inventory_balance','inventory_document','inventory_movement'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP; END $$;
COMMIT;
