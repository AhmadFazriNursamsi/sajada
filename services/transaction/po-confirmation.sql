-- Migration 015 after po-delivery.sql. Confirmation records never rewrite original ETA.
BEGIN;
CREATE TABLE sajada.purchase_confirmation(
 tenant_id uuid NOT NULL,id uuid NOT NULL,order_id uuid NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,order_id,revision),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.purchase_order(tenant_id,id),
 CONSTRAINT confirmation_data CHECK(
 data ?& ARRAY['id','orderId','revision','confirmedOn','reference','contact','note','actor','at'] AND NOT jsonb_path_exists(data,'$.* ? (@ == null)')
 AND data->>'id'=id::text AND data->>'orderId'=order_id::text AND (data->>'revision')::integer=revision
 AND jsonb_typeof(data->'revision')='number' AND jsonb_typeof(data->'reference')='string' AND jsonb_typeof(data->'contact')='string' AND jsonb_typeof(data->'note')='string' AND jsonb_typeof(data->'actor')='string'
 AND length(trim(data->>'reference')) BETWEEN 1 AND 100 AND length(trim(data->>'contact')) BETWEEN 1 AND 200
 AND length(trim(data->>'note')) BETWEEN 1 AND 1000 AND length(trim(data->>'actor')) BETWEEN 1 AND 200
 AND jsonb_typeof(data->'confirmedOn')='string' AND data->>'confirmedOn'=to_char((data->>'confirmedOn')::date,'YYYY-MM-DD')
 AND jsonb_typeof(data->'at')='string' AND (data->>'at')::timestamptz IS NOT NULL
 ));
CREATE UNIQUE INDEX confirmation_reference_unique ON sajada.purchase_confirmation(tenant_id,order_id,lower(trim(data->>'reference')));
ALTER TABLE sajada.purchase_confirmation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sajada.purchase_confirmation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.purchase_confirmation USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION sajada.guard_po_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p jsonb; previous_revision integer; previous_at timestamptz; BEGIN
 SELECT data INTO p FROM sajada.purchase_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id FOR UPDATE;
 IF p IS NULL OR p->>'status'<>'approved' OR (p->>'received')::bigint >= (p->>'quantity')::bigint THEN RAISE EXCEPTION 'Open approved PO required for supplier confirmation'; END IF;
 SELECT revision,(data->>'at')::timestamptz INTO previous_revision,previous_at FROM sajada.purchase_confirmation WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>coalesce(previous_revision,0)+1 THEN RAISE EXCEPTION 'Confirmation revision must be sequential'; END IF;
 IF (NEW.data->>'at')::timestamptz < (p->>'approvedAt')::timestamptz OR (NEW.data->>'at')::timestamptz < previous_at
 OR (NEW.data->>'confirmedOn')::date < ((p->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Confirmation date before approval or previous revision'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER confirmation_insert_guard BEFORE INSERT ON sajada.purchase_confirmation FOR EACH ROW EXECUTE FUNCTION sajada.guard_po_confirmation();
CREATE TRIGGER confirmation_history_guard BEFORE UPDATE OR DELETE ON sajada.purchase_confirmation FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
COMMIT;
