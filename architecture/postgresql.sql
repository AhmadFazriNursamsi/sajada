-- Design starting point; execute only in a reviewed, isolated development database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS sajada;
CREATE TABLE sajada.tenant (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, base_currency char(3) NOT NULL DEFAULT 'IDR');
CREATE TABLE sajada.region (id text PRIMARY KEY, parent_id text REFERENCES sajada.region, kind text NOT NULL CHECK(kind IN ('province','regency','district','village')), name text NOT NULL);
CREATE TABLE sajada.member (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL,
 region_id text REFERENCES sajada.region, sponsor_id uuid, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,sponsor_id) REFERENCES sajada.member(tenant_id,id), CHECK(sponsor_id IS DISTINCT FROM id)
);
-- Application must also reject multi-hop sponsor cycles under serialized updates.
CREATE TABLE sajada.product (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL DEFAULT gen_random_uuid(), sku text NOT NULL, name text NOT NULL,
 currency char(3) NOT NULL, unit_price numeric(20,4) NOT NULL CHECK(unit_price>=0), stock numeric(18,4) NOT NULL CHECK(stock>=0),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,sku)
);
CREATE TABLE sajada.sales_order (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL DEFAULT gen_random_uuid(), member_id uuid NOT NULL,
 currency char(3) NOT NULL, base_currency char(3) NOT NULL, fx_rate numeric(24,10) NOT NULL CHECK(fx_rate>0),
 total numeric(20,4) NOT NULL CHECK(total>=0), total_base numeric(20,4) NOT NULL, status text NOT NULL,
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,idempotency_key), FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id)
);
CREATE TABLE sajada.order_item (
 tenant_id uuid NOT NULL, order_id uuid NOT NULL, line_no int NOT NULL, product_id uuid NOT NULL, quantity numeric(18,4) NOT NULL CHECK(quantity>0), unit_price numeric(20,4) NOT NULL CHECK(unit_price>=0),
 PRIMARY KEY(tenant_id,order_id,line_no), FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.sales_order(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id)
);
CREATE TABLE sajada.journal (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL DEFAULT gen_random_uuid(), reference text NOT NULL, effective_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','posted','reversed')), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,reference)
);
CREATE TABLE sajada.journal_line (
 tenant_id uuid NOT NULL, journal_id uuid NOT NULL, line_no int NOT NULL, account_code text NOT NULL,
 debit_base numeric(20,4) NOT NULL DEFAULT 0 CHECK(debit_base>=0), credit_base numeric(20,4) NOT NULL DEFAULT 0 CHECK(credit_base>=0),
 PRIMARY KEY(tenant_id,journal_id,line_no), FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id),
 CHECK((debit_base>0 AND credit_base=0) OR (credit_base>0 AND debit_base=0))
);
-- Posting service must lock journal and require sum(debit_base)=sum(credit_base), >=2 lines,
-- open accounting period, valid chart-of-accounts, and append-only posted records.
CREATE TABLE sajada.outbox (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, event_id uuid NOT NULL DEFAULT gen_random_uuid(), aggregate_id uuid NOT NULL,
 event_type text NOT NULL, schema_version int NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 PRIMARY KEY(tenant_id,event_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['member','product','sales_order','order_item','journal','journal_line','outbox'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
-- Services use non-superuser/non-BYPASSRLS roles with minimum grants.
-- At transaction start use set_config('app.tenant_id', verified_tenant_uuid, true).
-- Cross-service tables above are conceptual; split migrations by owning service before deployment.
