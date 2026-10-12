-- Sajada v0.42 complete PostgreSQL schema. NEW EMPTY DATABASE ONLY.
-- Execute with psql -v ON_ERROR_STOP=1. No live data or passwords.

-- === 001 architecture/postgresql.sql ===
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


-- === 002 services/transaction/hardening.sql ===
-- Apply after architecture/postgresql.sql using database owner.
ALTER TABLE sajada.sales_order ADD COLUMN request_hash text;
CREATE OR REPLACE FUNCTION sajada.guard_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='journal' THEN
  IF OLD.status='posted' THEN RAISE EXCEPTION 'Posted journals are immutable; use reversal journal'; END IF;
 ELSE
  PERFORM 1 FROM sajada.journal WHERE tenant_id=OLD.tenant_id AND id=OLD.journal_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM sajada.journal WHERE tenant_id=OLD.tenant_id AND id=OLD.journal_id AND status='posted') THEN RAISE EXCEPTION 'Posted journal lines are immutable'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='journal_line' THEN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.journal_id<>OLD.journal_id THEN RAISE EXCEPTION 'Cannot reparent journal lines'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_journal BEFORE UPDATE OR DELETE ON sajada.journal FOR EACH ROW EXECUTE FUNCTION sajada.guard_posted();
CREATE TRIGGER guard_lines BEFORE UPDATE OR DELETE ON sajada.journal_line FOR EACH ROW EXECUTE FUNCTION sajada.guard_posted();
CREATE OR REPLACE FUNCTION sajada.check_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; delta numeric;
BEGIN
 SELECT count(*), coalesce(sum(debit_base-credit_base),0) INTO n,delta FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.id;
 IF NEW.status='posted' AND (n<2 OR delta<>0) THEN RAISE EXCEPTION 'Journal must have at least two balanced lines'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_journal_posting BEFORE INSERT OR UPDATE ON sajada.journal FOR EACH ROW EXECUTE FUNCTION sajada.check_posting();
CREATE OR REPLACE FUNCTION sajada.guard_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id AND status='posted') THEN RAISE EXCEPTION 'Cannot add lines to posted journal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_insert BEFORE INSERT ON sajada.journal_line FOR EACH ROW EXECUTE FUNCTION sajada.guard_line_insert();


-- === 003 services/transaction/member-number.sql ===
-- Migration 003. Apply once after architecture/postgresql.sql and hardening.sql.
BEGIN;
ALTER TABLE sajada.region ADD COLUMN local_code varchar(2)
 CHECK(local_code IS NULL OR local_code ~ '^[0-9]{2}$');
CREATE UNIQUE INDEX region_local_child_code ON sajada.region(parent_id,local_code) WHERE parent_id IS NOT NULL AND local_code IS NOT NULL;
CREATE UNIQUE INDEX region_local_root_code ON sajada.region(local_code) WHERE parent_id IS NULL AND local_code IS NOT NULL;
CREATE TABLE sajada.member_number_counter (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant,
 issue_year integer NOT NULL CHECK(issue_year BETWEEN 2000 AND 2099),
 last_value integer NOT NULL CHECK(last_value BETWEEN 1 AND 999999),
 PRIMARY KEY(tenant_id,issue_year)
);
CREATE TABLE sajada.member_number (
 tenant_id uuid NOT NULL, member_id uuid NOT NULL,
 number varchar(14) NOT NULL CHECK(number ~ '^[0-9]{14}$'),
 issue_year integer NOT NULL CHECK(issue_year BETWEEN 2000 AND 2099),
 sequence_no integer NOT NULL CHECK(sequence_no BETWEEN 1 AND 999999),
 province_code varchar(2) NOT NULL CHECK(province_code ~ '^[0-9]{2}$'),
 regency_code varchar(2) NOT NULL CHECK(regency_code ~ '^[0-9]{2}$'),
 district_code varchar(2) NOT NULL CHECK(district_code ~ '^[0-9]{2}$'),
 issued_at timestamptz NOT NULL, issued_by text NOT NULL,
 PRIMARY KEY(tenant_id,member_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 UNIQUE(tenant_id,number), UNIQUE(tenant_id,issue_year,sequence_no),
 CHECK(number=province_code||regency_code||district_code||right(issue_year::text,2)||lpad(sequence_no::text,6,'0')),
 CHECK(issue_year=extract(year FROM issued_at AT TIME ZONE 'Asia/Jakarta')::integer)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['member_number_counter','member_number'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE FUNCTION sajada.guard_member_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Issued member number is immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER member_number_immutable BEFORE UPDATE OR DELETE ON sajada.member_number FOR EACH ROW EXECUTE FUNCTION sajada.guard_member_number();
CREATE FUNCTION sajada.guard_member_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Member number counter cannot be deleted'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.issue_year<>OLD.issue_year OR NEW.last_value<>OLD.last_value+1 THEN
 RAISE EXCEPTION 'Member counter must advance exactly one'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER member_counter_monotonic BEFORE UPDATE OR DELETE ON sajada.member_number_counter FOR EACH ROW EXECUTE FUNCTION sajada.guard_member_counter();
CREATE FUNCTION sajada.issue_member_number(p_tenant uuid,p_member uuid,p_actor text)
RETURNS sajada.member_number LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,sajada AS $$
DECLARE
 m sajada.member; existing sajada.member_number; codes record;
 stamp timestamptz; issue_year_value integer; seq_value integer; result sajada.member_number;
BEGIN
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Tenant context mismatch' USING ERRCODE='42501';
 END IF;
 IF p_actor IS NULL OR length(trim(p_actor))=0 THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='22023'; END IF;
 -- Serialize all requests for this member. Same-member retries return the existing row.
 SELECT * INTO m FROM sajada.member WHERE tenant_id=p_tenant AND id=p_member FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO existing FROM sajada.member_number WHERE tenant_id=p_tenant AND member_id=p_member;
 IF FOUND THEN RETURN existing; END IF;
 IF m.status<>'active' THEN RAISE EXCEPTION 'Member must be active' USING ERRCODE='22023'; END IF;
 -- Authoritative region master is read-only for the API role; codes are snapshotted.
 SELECT p.local_code AS pp,k.local_code AS kk,c.local_code AS cc INTO codes
 FROM sajada.region v
 JOIN sajada.region c ON c.id=v.parent_id AND c.kind='district'
 JOIN sajada.region k ON k.id=c.parent_id AND k.kind='regency'
 JOIN sajada.region p ON p.id=k.parent_id AND p.kind='province' AND p.parent_id IS NULL
 WHERE v.id=m.region_id AND v.kind='village';
 IF NOT FOUND THEN RAISE EXCEPTION 'Complete member region required' USING ERRCODE='22023'; END IF;
 IF codes.pp IS NULL OR codes.kk IS NULL OR codes.cc IS NULL THEN RAISE EXCEPTION 'Local region codes required' USING ERRCODE='22023'; END IF;
 stamp:=clock_timestamp();issue_year_value:=extract(year FROM stamp AT TIME ZONE 'Asia/Jakarta')::integer;
 -- ON CONFLICT locks the tenant/year row. Failure rolls back the increment.
 INSERT INTO sajada.member_number_counter(tenant_id,issue_year,last_value) VALUES(p_tenant,issue_year_value,1)
 ON CONFLICT(tenant_id,issue_year) DO UPDATE SET last_value=sajada.member_number_counter.last_value+1
 RETURNING last_value INTO seq_value;
 INSERT INTO sajada.member_number(tenant_id,member_id,number,issue_year,sequence_no,province_code,regency_code,district_code,issued_at,issued_by)
 VALUES(p_tenant,p_member,codes.pp||codes.kk||codes.cc||right(issue_year_value::text,2)||lpad(seq_value::text,6,'0'),issue_year_value,seq_value,codes.pp,codes.kk,codes.cc,stamp,p_actor)
 RETURNING * INTO result;
 INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload)
 VALUES(p_tenant,p_member,'member.number.issued',1,jsonb_build_object('member_id',p_member,'number',result.number,'issued_by',p_actor,'issued_at',stamp));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION sajada.issue_member_number(uuid,uuid,text) FROM PUBLIC;
COMMIT;
-- Grant EXECUTE explicitly to the non-owner API role. With SECURITY INVOKER it also
-- needs SELECT/UPDATE member (row lock), SELECT region, SELECT/INSERT member_number,
-- SELECT/INSERT/UPDATE member_number_counter and INSERT outbox; never DELETE/TRUNCATE.


-- === 004 services/transaction/profit-sharing.sql ===
-- Migration 004: apply once after migrations 001-003.
BEGIN;
CREATE TABLE sajada.investor (
 tenant_id uuid NOT NULL REFERENCES sajada.tenant, id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE sajada.capital_account (
 tenant_id uuid NOT NULL, member_id uuid NOT NULL,
 currency char(3) NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 initial_principal bigint NOT NULL DEFAULT 12500000 CHECK(initial_principal=12500000),
 remaining_principal bigint NOT NULL DEFAULT 12500000 CHECK(remaining_principal BETWEEN 0 AND 12500000),
 post_recovery_profit bigint NOT NULL DEFAULT 0 CHECK(post_recovery_profit BETWEEN 0 AND 1000000000000),
 funding jsonb NOT NULL CHECK(jsonb_typeof(funding)='array' AND jsonb_array_length(funding)>0),
 funding_reference text NOT NULL CHECK(length(trim(funding_reference)) BETWEEN 1 AND 128),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 last_period varchar(7), PRIMARY KEY(tenant_id,member_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 CHECK(remaining_principal=0 OR post_recovery_profit=0)
);
CREATE TABLE sajada.profit_report (
 tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), member_id uuid NOT NULL,
 period varchar(7) NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revenue bigint NOT NULL CHECK(revenue BETWEEN 0 AND 1000000000000),
 cost bigint NOT NULL CHECK(cost BETWEEN 0 AND revenue),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','settled')),
 request_key text NOT NULL CHECK(length(trim(request_key)) BETWEEN 1 AND 128),
 request_hash text NOT NULL, result jsonb NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 settled_by text, settled_at timestamptz, settlement_reference text,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_key), UNIQUE(tenant_id,member_id,period),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.capital_account(tenant_id,member_id),
 CHECK((status='draft' AND settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL)
 OR (status='settled' AND settled_at IS NOT NULL AND length(trim(settled_by))>0 AND length(trim(settlement_reference)) BETWEEN 1 AND 128))
);
CREATE UNIQUE INDEX one_profit_draft ON sajada.profit_report(tenant_id,member_id) WHERE status='draft';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['investor','capital_account','profit_report'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE FUNCTION sajada.guard_capital_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Capital account cannot be deleted' USING ERRCODE='55000'; END IF;
 IF (NEW.tenant_id,NEW.member_id,NEW.currency,NEW.initial_principal,NEW.funding,NEW.funding_reference,NEW.created_by,NEW.created_at)
 IS DISTINCT FROM (OLD.tenant_id,OLD.member_id,OLD.currency,OLD.initial_principal,OLD.funding,OLD.funding_reference,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Funding snapshot is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capital_snapshot_guard BEFORE UPDATE OR DELETE ON sajada.capital_account FOR EACH ROW EXECUTE FUNCTION sajada.guard_capital_snapshot();
CREATE FUNCTION sajada.guard_profit_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='settled' THEN RAISE EXCEPTION 'Profit report is immutable' USING ERRCODE='55000'; END IF;
 IF (NEW.tenant_id,NEW.id,NEW.member_id,NEW.period,NEW.revenue,NEW.cost,NEW.request_key,NEW.request_hash,NEW.result,NEW.created_by,NEW.created_at)
 IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.member_id,OLD.period,OLD.revenue,OLD.cost,OLD.request_key,OLD.request_hash,OLD.result,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Draft calculation is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profit_report_guard BEFORE UPDATE OR DELETE ON sajada.profit_report FOR EACH ROW EXECUTE FUNCTION sajada.guard_profit_report();
COMMIT;


-- === 005 services/transaction/profit-corrections.sql ===
-- Migration 005. Apply once after migration 004. Keeps all prior reports.
BEGIN;
ALTER TABLE sajada.profit_report
 ADD COLUMN cancelled_by text,
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancellation_reference text,
 ADD COLUMN cancellation_reason text,
 ADD COLUMN replaces_report_id uuid,
 ADD CONSTRAINT profit_replacement_fk FOREIGN KEY(tenant_id,replaces_report_id) REFERENCES sajada.profit_report(tenant_id,id),
 ADD CONSTRAINT profit_no_self_replacement CHECK(replaces_report_id IS DISTINCT FROM id),
 ADD CONSTRAINT profit_one_replacement UNIQUE(tenant_id,replaces_report_id);
ALTER TABLE sajada.profit_report DROP CONSTRAINT profit_report_tenant_id_member_id_period_key;
-- Replace only the two old checks that mention lifecycle status. Other checks stay.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint
 WHERE conrelid='sajada.profit_report'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
 EXECUTE format('ALTER TABLE sajada.profit_report DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE sajada.profit_report
 ADD CONSTRAINT profit_status_values CHECK(status IN ('draft','settled','cancelled')),
 ADD CONSTRAINT profit_lifecycle_fields CHECK(COALESCE(
 (status='draft' AND settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL
  AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reference IS NULL AND cancellation_reason IS NULL)
 OR (status='settled' AND settled_at IS NOT NULL AND length(trim(settled_by))>0
  AND length(trim(settlement_reference)) BETWEEN 1 AND 128
  AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reference IS NULL AND cancellation_reason IS NULL)
 OR (status='cancelled' AND settled_at IS NULL AND settled_by IS NULL AND settlement_reference IS NULL
  AND cancelled_at IS NOT NULL AND length(trim(cancelled_by))>0
  AND length(trim(cancellation_reference)) BETWEEN 1 AND 128
  AND length(trim(cancellation_reason)) BETWEEN 1 AND 1000),false));
CREATE UNIQUE INDEX one_active_profit_period ON sajada.profit_report(tenant_id,member_id,period) WHERE status<>'cancelled';
CREATE OR REPLACE FUNCTION sajada.guard_profit_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('settled','cancelled') THEN
  RAISE EXCEPTION 'Final profit report is immutable' USING ERRCODE='55000';
 END IF;
 IF (NEW.tenant_id,NEW.id,NEW.member_id,NEW.period,NEW.revenue,NEW.cost,NEW.request_key,NEW.request_hash,NEW.result,NEW.created_by,NEW.created_at,NEW.replaces_report_id)
 IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.member_id,OLD.period,OLD.revenue,OLD.cost,OLD.request_key,OLD.request_hash,OLD.result,OLD.created_by,OLD.created_at,OLD.replaces_report_id)
 THEN RAISE EXCEPTION 'Draft calculation is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
-- Check correction lineage at the database boundary as well as in the service.
CREATE FUNCTION sajada.check_profit_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source sajada.profit_report;
BEGIN
 IF NEW.replaces_report_id IS NOT NULL THEN
  SELECT * INTO source FROM sajada.profit_report WHERE tenant_id=NEW.tenant_id AND id=NEW.replaces_report_id;
  IF NOT FOUND OR source.status<>'cancelled' OR source.member_id<>NEW.member_id OR source.period<>NEW.period THEN
   RAISE EXCEPTION 'Replacement must reference cancelled report for same tenant member and period' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profit_replacement_guard BEFORE INSERT ON sajada.profit_report FOR EACH ROW EXECUTE FUNCTION sajada.check_profit_replacement();
COMMIT;


-- === 006 services/transaction/profit-approval.sql ===
-- Migration 006. Apply once after 005. Historic settled rows are preserved.
BEGIN;
ALTER TABLE sajada.profit_report
 ADD COLUMN approved_by text,
 ADD COLUMN approved_at timestamptz,
 ADD COLUMN approval_reference text,
 ADD CONSTRAINT profit_approval_complete CHECK(COALESCE(
 (approved_by IS NULL AND approved_at IS NULL AND approval_reference IS NULL)
 OR (length(trim(approved_by))>0 AND approved_at IS NOT NULL
  AND length(trim(approval_reference)) BETWEEN 1 AND 128 AND approved_by<>created_by),false));
CREATE FUNCTION sajada.guard_profit_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_reference IS NOT NULL THEN
   RAISE EXCEPTION 'New reports must start as unapproved drafts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.approved_by IS NOT NULL AND
 (NEW.approved_by,NEW.approved_at,NEW.approval_reference) IS DISTINCT FROM
 (OLD.approved_by,OLD.approved_at,OLD.approval_reference) THEN
  RAISE EXCEPTION 'Approval is immutable' USING ERRCODE='55000';
 END IF;
 IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL AND
 (OLD.status<>'draft' OR NEW.status<>'draft') THEN
  RAISE EXCEPTION 'Approval must be recorded before settlement' USING ERRCODE='23514';
 END IF;
 IF OLD.status='draft' AND NEW.status='settled' AND OLD.approved_by IS NULL THEN
  RAISE EXCEPTION 'Independent approval required before settlement' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profit_approval_guard BEFORE INSERT OR UPDATE ON sajada.profit_report
 FOR EACH ROW EXECUTE FUNCTION sajada.guard_profit_approval();
COMMIT;


-- === 007 services/transaction/inventory.sql ===
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


-- === 008 services/transaction/order-cancel.sql ===
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


-- === 009 services/transaction/order-dispatch.sql ===
-- Migration 009 after order-cancel.sql
BEGIN;
ALTER TABLE sajada.sales_order ADD COLUMN dispatched_at timestamptz,
 ADD COLUMN dispatched_by text, ADD COLUMN dispatch_reference text;
ALTER TABLE sajada.sales_order ADD CONSTRAINT dispatch_audit CHECK (
 (dispatched_at IS NULL AND dispatched_by IS NULL AND dispatch_reference IS NULL)
 OR (dispatched_at IS NOT NULL AND dispatched_by IS NOT NULL AND dispatch_reference IS NOT NULL
 AND length(trim(dispatched_by)) BETWEEN 1 AND 200 AND length(trim(dispatch_reference)) BETWEEN 1 AND 100
 AND inventory_location_id IS NOT NULL AND status='paid'));
CREATE UNIQUE INDEX dispatch_reference_unique ON sajada.sales_order(tenant_id,dispatch_reference) WHERE dispatched_at IS NOT NULL;
CREATE FUNCTION sajada.guard_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dispatched orders cannot be deleted'; END IF;
 IF (NEW.dispatched_at,NEW.dispatched_by,NEW.dispatch_reference,NEW.inventory_location_id,NEW.member_id,NEW.total,NEW.total_base)
 IS DISTINCT FROM (OLD.dispatched_at,OLD.dispatched_by,OLD.dispatch_reference,OLD.inventory_location_id,OLD.member_id,OLD.total,OLD.total_base)
 THEN RAISE EXCEPTION 'Dispatch audit and order snapshot are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dispatch_audit_guard BEFORE UPDATE OR DELETE ON sajada.sales_order
 FOR EACH ROW WHEN (OLD.dispatched_at IS NOT NULL) EXECUTE FUNCTION sajada.guard_dispatch_audit();
COMMIT;


-- === 010 services/transaction/order-receipt.sql ===
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


-- === 011 services/transaction/replenishment.sql ===
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


-- === 012 services/transaction/payables.sql ===
-- Migration 012 after replenishment.sql. Apply as schema owner.
BEGIN;
CREATE TABLE sajada.purchase_invoice (
 tenant_id uuid NOT NULL,id uuid NOT NULL,receipt_id uuid NOT NULL,po_id uuid NOT NULL,journal_id uuid NOT NULL,data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,receipt_id),UNIQUE(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES sajada.purchase_receipt(tenant_id,id),
 FOREIGN KEY(tenant_id,po_id) REFERENCES sajada.purchase_order(tenant_id,id),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id),
 CHECK(data ?& ARRAY['id','receiptId','poId','supplier','reference','amount','base','currency','rate','account','quantity','unitCost','date','due','createdAt','createdBy']),
 CHECK(data->>'id'=id::text AND data->>'receiptId'=receipt_id::text AND data->>'poId'=po_id::text),
 CHECK(data->>'currency'='IDR' AND data->>'account'='1300' AND (data->>'rate')::numeric=1),
 CHECK((data->>'amount')::numeric BETWEEN 1 AND 1000000000000 AND (data->>'amount')::numeric=trunc((data->>'amount')::numeric) AND (data->>'base')::numeric=(data->>'amount')::numeric),
 CHECK(length(btrim(data->>'supplier')) BETWEEN 1 AND 200 AND length(btrim(data->>'reference')) BETWEEN 1 AND 60 AND length(btrim(data->>'createdBy')) BETWEEN 1 AND 200),
 CHECK((data->>'due')::date >= (data->>'date')::date)
);
CREATE UNIQUE INDEX purchase_invoice_reference ON sajada.purchase_invoice(tenant_id,lower(btrim(data->>'supplier')),lower(btrim(data->>'reference')));
CREATE TABLE sajada.purchase_payment (
 tenant_id uuid NOT NULL,id uuid NOT NULL,invoice_id uuid NOT NULL,journal_id uuid NOT NULL,data jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES sajada.purchase_invoice(tenant_id,id),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id),
 CHECK(data ?& ARRAY['id','billId','amount','date','reference','actor','at']),
 CHECK(data->>'id'=id::text AND data->>'billId'=invoice_id::text),
 CHECK((data->>'amount')::numeric BETWEEN 1 AND 1000000000000 AND (data->>'amount')::numeric=trunc((data->>'amount')::numeric)),
 CHECK(length(btrim(data->>'reference')) BETWEEN 1 AND 100 AND length(btrim(data->>'actor')) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX purchase_payment_reference ON sajada.purchase_payment(tenant_id,lower(btrim(data->>'reference')));
CREATE INDEX purchase_payment_invoice ON sajada.purchase_payment(tenant_id,invoice_id);
CREATE FUNCTION sajada.guard_purchase_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb;po jsonb;invoice jsonb;paid numeric;amount numeric;dr text;cr text;jref text;jdate date;jstatus text;n int;d numeric;c numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_each(NEW.data) WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'Null fields are not valid payable data'; END IF;
 amount=(NEW.data->>'amount')::numeric;
 IF TG_TABLE_NAME='purchase_invoice' THEN
  SELECT data INTO receipt FROM sajada.purchase_receipt WHERE tenant_id=NEW.tenant_id AND id=NEW.receipt_id;
  SELECT data INTO po FROM sajada.purchase_order WHERE tenant_id=NEW.tenant_id AND id=NEW.po_id;
  IF receipt->>'orderId' IS DISTINCT FROM NEW.po_id::text OR po->>'status' NOT IN ('approved','closed')
   OR NEW.data->>'supplier' IS DISTINCT FROM po->>'supplier' OR (NEW.data->>'quantity')::numeric IS DISTINCT FROM (receipt->>'quantity')::numeric
   OR (NEW.data->>'unitCost')::numeric IS DISTINCT FROM (po->>'unitCost')::numeric OR amount IS DISTINCT FROM (receipt->>'quantity')::numeric*(po->>'unitCost')::numeric THEN RAISE EXCEPTION 'Invoice does not match PO receipt'; END IF;
  IF (NEW.data->>'createdAt')::timestamptz < (receipt->>'at')::timestamptz OR (NEW.data->>'date')::date < ((receipt->>'at')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date OR (NEW.data->>'date')::date > ((NEW.data->>'createdAt')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Invoice date audit invalid'; END IF;
  dr='1300';cr='2100';jref='AP-'||NEW.id::text;
 ELSE
  SELECT data INTO invoice FROM sajada.purchase_invoice WHERE tenant_id=NEW.tenant_id AND id=NEW.invoice_id FOR UPDATE;
  SELECT coalesce(sum((data->>'amount')::numeric),0) INTO paid FROM sajada.purchase_payment WHERE tenant_id=NEW.tenant_id AND invoice_id=NEW.invoice_id;
  IF amount+paid>(invoice->>'base')::numeric THEN RAISE EXCEPTION 'Payment exceeds remaining payable'; END IF;
  IF (NEW.data->>'date')::date < (invoice->>'date')::date OR (NEW.data->>'date')::date IS DISTINCT FROM ((NEW.data->>'at')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Payment date audit invalid'; END IF;
  dr='2100';cr='1100';jref='APPAY-'||NEW.id::text;
 END IF;
 SELECT reference,effective_date,status INTO jref,jdate,jstatus FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id AND reference=jref;
 IF jstatus IS DISTINCT FROM 'posted' OR jdate IS DISTINCT FROM (NEW.data->>'date')::date THEN RAISE EXCEPTION 'Posted journal required for payable'; END IF;
 SELECT count(*),coalesce(sum(debit_base) FILTER(WHERE account_code=dr),0),coalesce(sum(credit_base) FILTER(WHERE account_code=cr),0) INTO n,d,c FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id;
 IF n<>2 OR d IS DISTINCT FROM amount OR c IS DISTINCT FROM amount THEN RAISE EXCEPTION 'Payable journal amount/accounts mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_posting BEFORE INSERT ON sajada.purchase_invoice FOR EACH ROW EXECUTE FUNCTION sajada.guard_purchase_posting();
CREATE TRIGGER payment_posting BEFORE INSERT ON sajada.purchase_payment FOR EACH ROW EXECUTE FUNCTION sajada.guard_purchase_posting();
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON sajada.purchase_invoice FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON sajada.purchase_payment FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['purchase_invoice','purchase_payment'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING (tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true)::uuid)',t);END LOOP;END $$;
COMMIT;


-- === 013 services/transaction/suppliers.sql ===
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


-- === 014 services/transaction/po-delivery.sql ===
-- Migration 014 after suppliers.sql. Do not infer lead time for legacy POs.
BEGIN;
ALTER TABLE sajada.purchase_order ADD CONSTRAINT po_delivery_schedule CHECK (
 (NOT (data ? 'leadDays') AND NOT (data ? 'expectedOn')) OR
 (data ?& ARRAY['leadDays','createdAt'] AND jsonb_typeof(data->'createdAt')='string' AND jsonb_typeof(data->'leadDays')='number' AND (data->>'leadDays')::integer BETWEEN 0 AND 365 AND
  ((data->>'status' IN ('draft','cancelled') AND NOT (data ? 'expectedOn')) OR
   (data->>'status' IN ('approved','closed') AND data ? 'expectedOn' AND jsonb_typeof(data->'expectedOn')='string'
    AND jsonb_typeof(data->'approvedAt')='string' AND (data->>'approvedAt')::timestamptz >= (data->>'createdAt')::timestamptz
    AND data->>'expectedOn'=to_char(((data->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Jakarta') + make_interval(days => (data->>'leadDays')::integer),'YYYY-MM-DD'))))
);
CREATE OR REPLACE FUNCTION sajada.guard_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PO history cannot be deleted'; END IF;
 IF OLD.data->>'status' IN ('closed','cancelled') THEN RAISE EXCEPTION 'Final PO is immutable'; END IF;
 IF (NEW.tenant_id,NEW.id,NEW.location_id,NEW.product_id) IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.location_id,OLD.product_id)
 OR (NEW.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason','expectedOn']) IS DISTINCT FROM (OLD.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason','expectedOn']) THEN RAISE EXCEPTION 'PO snapshot is immutable'; END IF;
 IF (NEW.data->>'received')::bigint < (OLD.data->>'received')::bigint OR (NEW.data->>'received')::bigint > (NEW.data->>'quantity')::bigint THEN RAISE EXCEPTION 'PO receipt out of bounds'; END IF;
 IF OLD.data->>'status'='draft' AND NEW.data->>'status' NOT IN ('approved','cancelled') OR OLD.data->>'status'='approved' AND NEW.data->>'status' NOT IN ('approved','closed') THEN RAISE EXCEPTION 'Invalid PO transition'; END IF;
 IF OLD.data->>'status'='approved' AND (NEW.data->>'approvedAt',NEW.data->>'approvedBy',NEW.data->>'expectedOn') IS DISTINCT FROM (OLD.data->>'approvedAt',OLD.data->>'approvedBy',OLD.data->>'expectedOn') THEN RAISE EXCEPTION 'PO approval immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;


-- === 015 services/transaction/po-confirmation.sql ===
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


-- === 016 services/transaction/po-inspection.sql ===
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


-- === 017 services/transaction/po-replacement.sql ===
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


-- === 018 services/transaction/po-replacement-reversal.sql ===
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


-- === 019 services/transaction/capital-wallet.sql ===
-- Migration 019 after 018. Capital-wallet ledger is separate from customer advances.
BEGIN;
CREATE TABLE sajada.capital_wallet_activation(
 tenant_id uuid NOT NULL,id uuid NOT NULL,member_id uuid NOT NULL,
 amount bigint NOT NULL DEFAULT 10000000 CHECK(amount=10000000),fee_amount bigint NOT NULL DEFAULT 2500000 CHECK(fee_amount=2500000),
 fees jsonb NOT NULL,reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 100),
 actor text NOT NULL CHECK(length(btrim(actor)) BETWEEN 1 AND 200),at timestamptz NOT NULL DEFAULT now(),journal_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,member_id),UNIQUE(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.capital_account(tenant_id,member_id),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id),
 CHECK(jsonb_typeof(fees)='object' AND fees ?& ARRAY['memberDues','adminFee','other','note'] AND (fees-ARRAY['memberDues','adminFee','other','note'])='{}'::jsonb AND NOT jsonb_path_exists(fees,'$.* ? (@ == null)')
 AND jsonb_typeof(fees->'memberDues')='number' AND jsonb_typeof(fees->'adminFee')='number' AND jsonb_typeof(fees->'other')='number'
 AND (fees->>'memberDues')::numeric BETWEEN 0 AND 2500000 AND (fees->>'adminFee')::numeric BETWEEN 0 AND 2500000 AND (fees->>'other')::numeric BETWEEN 0 AND 2500000
 AND (fees->>'memberDues')::numeric=trunc((fees->>'memberDues')::numeric) AND (fees->>'adminFee')::numeric=trunc((fees->>'adminFee')::numeric) AND (fees->>'other')::numeric=trunc((fees->>'other')::numeric)
 AND (fees->>'memberDues')::numeric+(fees->>'adminFee')::numeric+(fees->>'other')::numeric=2500000
 AND jsonb_typeof(fees->'note')='string' AND length(btrim(fees->>'note')) BETWEEN 1 AND 1000));
CREATE UNIQUE INDEX wallet_activation_reference ON sajada.capital_wallet_activation(tenant_id,lower(btrim(reference)));
CREATE TABLE sajada.capital_wallet_payment(
 tenant_id uuid NOT NULL,id uuid NOT NULL,member_id uuid NOT NULL,order_id uuid NOT NULL,activation_id uuid NOT NULL,journal_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 10000000),reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 100),
 actor text NOT NULL CHECK(length(btrim(actor)) BETWEEN 1 AND 200),at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.capital_account(tenant_id,member_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.sales_order(tenant_id,id),
 FOREIGN KEY(tenant_id,activation_id) REFERENCES sajada.capital_wallet_activation(tenant_id,id),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id));
CREATE UNIQUE INDEX wallet_payment_reference ON sajada.capital_wallet_payment(tenant_id,lower(btrim(reference)));
CREATE INDEX wallet_payment_member ON sajada.capital_wallet_payment(tenant_id,member_id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['capital_wallet_activation','capital_wallet_payment'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING(tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true)::uuid)',t);
 EXECUTE format('CREATE TRIGGER wallet_history_guard BEFORE UPDATE OR DELETE ON sajada.%I FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only()',t);
 END LOOP;END $$;
CREATE FUNCTION sajada.guard_capital_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a sajada.capital_wallet_activation%ROWTYPE;o sajada.sales_order%ROWTYPE;used bigint;j sajada.journal%ROWTYPE;n int;valid int;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':wallet:'||NEW.member_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM sajada.member WHERE tenant_id=NEW.tenant_id AND id=NEW.member_id AND status='active') THEN RAISE EXCEPTION 'Active wallet member required'; END IF;
 SELECT * INTO j FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id;
 IF j.id IS NULL OR j.status<>'posted' OR j.effective_date<>(NEW.at AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Wallet requires matching posted journal date'; END IF;
 SELECT count(*) INTO n FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id;
 IF TG_TABLE_NAME='capital_wallet_activation' THEN
  IF NOT EXISTS(SELECT 1 FROM sajada.capital_account WHERE tenant_id=NEW.tenant_id AND member_id=NEW.member_id AND initial_principal=12500000 AND currency='IDR') THEN RAISE EXCEPTION 'Funded capital account required'; END IF;
  SELECT count(*) INTO valid FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id AND ((account_code='1190' AND debit_base=12500000 AND credit_base=0) OR (account_code='2210' AND debit_base=0 AND credit_base=10000000) OR (account_code='2310' AND debit_base=0 AND credit_base=2500000));
  IF n<>3 OR valid<>3 OR j.reference<>'WACT-'||NEW.id::text THEN RAISE EXCEPTION 'Activation journal must match capital breakdown'; END IF;
 ELSE
  SELECT * INTO a FROM sajada.capital_wallet_activation WHERE tenant_id=NEW.tenant_id AND id=NEW.activation_id AND member_id=NEW.member_id;
  SELECT * INTO o FROM sajada.sales_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id FOR UPDATE;
  IF a.id IS NULL OR NEW.at<a.at OR o.id IS NULL OR o.status<>'pending' OR o.currency<>'IDR' OR o.base_currency<>'IDR' OR o.fx_rate<>1 OR o.total<>NEW.amount OR o.total_base<>NEW.amount OR o.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'Wallet payment requires pending IDR cooperative order and matching activation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sajada.order_item WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id) OR (SELECT sum(quantity*unit_price) FROM sajada.order_item WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id) IS DISTINCT FROM o.total THEN RAISE EXCEPTION 'Wallet order item total mismatch'; END IF;
  SELECT coalesce(sum(amount),0) INTO used FROM sajada.capital_wallet_payment WHERE tenant_id=NEW.tenant_id AND member_id=NEW.member_id;
  IF used+NEW.amount>a.amount THEN RAISE EXCEPTION 'Insufficient capital wallet balance'; END IF;
  SELECT count(*) INTO valid FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id AND ((account_code='2210' AND debit_base=NEW.amount AND credit_base=0) OR (account_code='2200' AND debit_base=0 AND credit_base=NEW.amount));
  IF n<>2 OR valid<>2 OR j.reference<>'WPAY-'||NEW.id::text THEN RAISE EXCEPTION 'Wallet payment journal mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER activation_insert_guard BEFORE INSERT ON sajada.capital_wallet_activation FOR EACH ROW EXECUTE FUNCTION sajada.guard_capital_wallet();
CREATE TRIGGER wallet_payment_insert_guard BEFORE INSERT ON sajada.capital_wallet_payment FOR EACH ROW EXECUTE FUNCTION sajada.guard_capital_wallet();
-- A wallet payment must end its transaction with a paid, unchanged order.
CREATE FUNCTION sajada.check_wallet_order_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM sajada.sales_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id AND status='paid' AND total=NEW.amount AND total_base=NEW.amount AND currency='IDR' AND base_currency='IDR' AND fx_rate=1) THEN RAISE EXCEPTION 'Wallet payment must settle order atomically'; END IF;RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER wallet_order_final AFTER INSERT ON sajada.capital_wallet_payment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sajada.check_wallet_order_final();
CREATE FUNCTION sajada.guard_wallet_paid_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM sajada.capital_wallet_payment WHERE tenant_id=OLD.tenant_id AND order_id=OLD.id) THEN
  IF TG_OP='DELETE' OR NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.member_id<>OLD.member_id OR NEW.status<>'paid' OR NEW.currency<>OLD.currency OR NEW.base_currency<>OLD.base_currency OR NEW.fx_rate<>OLD.fx_rate OR NEW.total<>OLD.total OR NEW.total_base<>OLD.total_base OR NEW.inventory_location_id IS DISTINCT FROM OLD.inventory_location_id THEN RAISE EXCEPTION 'Wallet funded order payment facts are immutable'; END IF;
 END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE TRIGGER wallet_paid_order_guard BEFORE UPDATE OR DELETE ON sajada.sales_order FOR EACH ROW EXECUTE FUNCTION sajada.guard_wallet_paid_order();
CREATE FUNCTION sajada.guard_wallet_order_items() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM sajada.capital_wallet_payment WHERE tenant_id=OLD.tenant_id AND order_id=OLD.order_id) THEN RAISE EXCEPTION 'Wallet paid order items are immutable'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM sajada.capital_wallet_payment WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id) THEN RAISE EXCEPTION 'Wallet paid order items are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE TRIGGER wallet_order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON sajada.order_item FOR EACH ROW EXECUTE FUNCTION sajada.guard_wallet_order_items();
COMMIT;


-- === 020 services/transaction/capital-wallet-refund.sql ===
-- Migration 020 after capital-wallet.sql. Full refund before dispatch, to original payer only.
BEGIN;
CREATE TABLE sajada.capital_wallet_refund(
 tenant_id uuid NOT NULL,id uuid NOT NULL,payment_id uuid NOT NULL,order_id uuid NOT NULL,member_id uuid NOT NULL,journal_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 10000000),reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 100),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),actor text NOT NULL CHECK(length(btrim(actor)) BETWEEN 1 AND 200),at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,payment_id),UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,payment_id) REFERENCES sajada.capital_wallet_payment(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.sales_order(tenant_id,id),FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.capital_account(tenant_id,member_id),FOREIGN KEY(tenant_id,journal_id) REFERENCES sajada.journal(tenant_id,id));
CREATE UNIQUE INDEX wallet_refund_reference ON sajada.capital_wallet_refund(tenant_id,lower(btrim(reference)));
ALTER TABLE sajada.capital_wallet_refund ENABLE ROW LEVEL SECURITY;ALTER TABLE sajada.capital_wallet_refund FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sajada.capital_wallet_refund USING(tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE TRIGGER refund_history_guard BEFORE UPDATE OR DELETE ON sajada.capital_wallet_refund FOR EACH ROW EXECUTE FUNCTION sajada.inventory_append_only();
CREATE FUNCTION sajada.guard_wallet_refund() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p sajada.capital_wallet_payment%ROWTYPE;o sajada.sales_order%ROWTYPE;j sajada.journal%ROWTYPE;n int;valid int;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':wallet:'||NEW.member_id::text,0));
 SELECT * INTO p FROM sajada.capital_wallet_payment WHERE tenant_id=NEW.tenant_id AND id=NEW.payment_id;
 SELECT * INTO o FROM sajada.sales_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id FOR UPDATE;
 IF p.id IS NULL OR p.member_id<>NEW.member_id OR p.order_id<>NEW.order_id OR p.amount<>NEW.amount OR NEW.at<p.at OR o.id IS NULL OR o.status<>'paid' OR o.dispatched_at IS NOT NULL OR o.received_at IS NOT NULL OR o.inventory_location_id IS NULL THEN RAISE EXCEPTION 'Refund requires full original payment before dispatch with location inventory'; END IF;
 SELECT * INTO j FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id;
 SELECT count(*),count(*) FILTER(WHERE (account_code='2200' AND debit_base=NEW.amount AND credit_base=0) OR (account_code='2210' AND debit_base=0 AND credit_base=NEW.amount)) INTO n,valid FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id;
 IF j.id IS NULL OR j.status<>'posted' OR j.reference<>'WREF-'||NEW.id::text OR j.effective_date<>(NEW.at AT TIME ZONE 'Asia/Jakarta')::date OR n<>2 OR valid<>2 THEN RAISE EXCEPTION 'Refund journal mismatch'; END IF;
 RETURN NEW;END $$;
CREATE TRIGGER refund_insert_guard BEFORE INSERT ON sajada.capital_wallet_refund FOR EACH ROW EXECUTE FUNCTION sajada.guard_wallet_refund();
CREATE FUNCTION sajada.check_wallet_refund_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM sajada.sales_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id AND status='cancelled' AND dispatched_at IS NULL AND received_at IS NULL AND cancelled_at=NEW.at AND cancelled_by=NEW.actor AND cancel_reason=NEW.reason) THEN RAISE EXCEPTION 'Refund must cancel order atomically'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sajada.inventory_document WHERE tenant_id=NEW.tenant_id AND data->>'kind'='reserve' AND data->>'reference'=NEW.order_id::text) OR EXISTS(SELECT 1 FROM sajada.inventory_document WHERE tenant_id=NEW.tenant_id AND data->>'kind'='reserve' AND data->>'reference'=NEW.order_id::text AND data->>'status'<>'cancelled') THEN RAISE EXCEPTION 'Refund must release reservations atomically'; END IF;
 IF EXISTS(WITH expected AS(SELECT product_id,sum(quantity) qty FROM sajada.order_item WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id GROUP BY product_id),actual AS(SELECT product_id,sum((data->>'quantity')::numeric) qty FROM sajada.inventory_document WHERE tenant_id=NEW.tenant_id AND data->>'kind'='reserve' AND data->>'reference'=NEW.order_id::text GROUP BY product_id) SELECT 1 FROM expected e FULL JOIN actual a USING(product_id) WHERE e.qty IS DISTINCT FROM a.qty) OR EXISTS(SELECT 1 FROM sajada.inventory_document d JOIN sajada.sales_order o ON o.tenant_id=d.tenant_id AND o.id=NEW.order_id WHERE d.tenant_id=NEW.tenant_id AND d.data->>'kind'='reserve' AND d.data->>'reference'=NEW.order_id::text AND d.location_id<>o.inventory_location_id) THEN RAISE EXCEPTION 'Refund reservation item history mismatch'; END IF;
 RETURN NEW;END $$;
CREATE CONSTRAINT TRIGGER wallet_refund_final AFTER INSERT ON sajada.capital_wallet_refund DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sajada.check_wallet_refund_final();
CREATE OR REPLACE FUNCTION sajada.guard_wallet_paid_order() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r sajada.capital_wallet_refund%ROWTYPE;BEGIN
 IF EXISTS(SELECT 1 FROM sajada.capital_wallet_payment WHERE tenant_id=OLD.tenant_id AND order_id=OLD.id) THEN
  SELECT * INTO r FROM sajada.capital_wallet_refund WHERE tenant_id=OLD.tenant_id AND order_id=OLD.id;
  IF TG_OP='DELETE' OR NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.member_id<>OLD.member_id OR NEW.currency<>OLD.currency OR NEW.base_currency<>OLD.base_currency OR NEW.fx_rate<>OLD.fx_rate OR NEW.total<>OLD.total OR NEW.total_base<>OLD.total_base OR NEW.inventory_location_id IS DISTINCT FROM OLD.inventory_location_id THEN RAISE EXCEPTION 'Wallet funded order payment facts are immutable'; END IF;
  IF r.id IS NULL AND NEW.status<>'paid' THEN RAISE EXCEPTION 'Wallet paid order is immutable without a refund before cancellation'; END IF;
  IF r.id IS NOT NULL AND (NEW.status<>'cancelled' OR NEW.cancelled_at IS DISTINCT FROM r.at OR NEW.cancelled_by IS DISTINCT FROM r.actor OR NEW.cancel_reason IS DISTINCT FROM r.reason OR NEW.dispatched_at IS NOT NULL OR NEW.received_at IS NOT NULL) THEN RAISE EXCEPTION 'Refunded order must match refund audit'; END IF;
 END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION sajada.guard_capital_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a sajada.capital_wallet_activation%ROWTYPE;o sajada.sales_order%ROWTYPE;used bigint;j sajada.journal%ROWTYPE;n int;valid int;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':wallet:'||NEW.member_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM sajada.member WHERE tenant_id=NEW.tenant_id AND id=NEW.member_id AND status='active') THEN RAISE EXCEPTION 'Active wallet member required'; END IF;
 SELECT * INTO j FROM sajada.journal WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id;
 IF j.id IS NULL OR j.status<>'posted' OR j.effective_date<>(NEW.at AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Wallet requires matching posted journal date'; END IF;
 SELECT count(*) INTO n FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id;
 IF TG_TABLE_NAME='capital_wallet_activation' THEN
  IF NOT EXISTS(SELECT 1 FROM sajada.capital_account WHERE tenant_id=NEW.tenant_id AND member_id=NEW.member_id AND initial_principal=12500000 AND currency='IDR') THEN RAISE EXCEPTION 'Funded capital account required'; END IF;
  SELECT count(*) INTO valid FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id AND ((account_code='1190' AND debit_base=12500000 AND credit_base=0) OR (account_code='2210' AND debit_base=0 AND credit_base=10000000) OR (account_code='2310' AND debit_base=0 AND credit_base=2500000));
  IF n<>3 OR valid<>3 OR j.reference<>'WACT-'||NEW.id::text THEN RAISE EXCEPTION 'Activation journal must match capital breakdown'; END IF;
 ELSE
  SELECT * INTO a FROM sajada.capital_wallet_activation WHERE tenant_id=NEW.tenant_id AND id=NEW.activation_id AND member_id=NEW.member_id;
  SELECT * INTO o FROM sajada.sales_order WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id FOR UPDATE;
  IF a.id IS NULL OR NEW.at<a.at OR o.id IS NULL OR o.status<>'pending' OR o.currency<>'IDR' OR o.base_currency<>'IDR' OR o.fx_rate<>1 OR o.total<>NEW.amount OR o.total_base<>NEW.amount OR o.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'Wallet payment requires pending IDR cooperative order and matching activation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sajada.order_item WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id) OR (SELECT sum(quantity*unit_price) FROM sajada.order_item WHERE tenant_id=NEW.tenant_id AND order_id=NEW.order_id) IS DISTINCT FROM o.total THEN RAISE EXCEPTION 'Wallet order item total mismatch'; END IF;
  SELECT coalesce(sum(amount),0) INTO used FROM sajada.capital_wallet_payment WHERE tenant_id=NEW.tenant_id AND member_id=NEW.member_id;
  used=used-(SELECT coalesce(sum(amount),0) FROM sajada.capital_wallet_refund WHERE tenant_id=NEW.tenant_id AND member_id=NEW.member_id);
  IF used+NEW.amount>a.amount THEN RAISE EXCEPTION 'Insufficient capital wallet balance'; END IF;
  SELECT count(*) INTO valid FROM sajada.journal_line WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id AND ((account_code='2210' AND debit_base=NEW.amount AND credit_base=0) OR (account_code='2200' AND debit_base=0 AND credit_base=NEW.amount));
  IF n<>2 OR valid<>2 OR j.reference<>'WPAY-'||NEW.id::text THEN RAISE EXCEPTION 'Wallet payment journal mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;


-- === 021 services/transaction/web-workspace.sql ===
-- Migration 021 after capital-wallet-refund.sql. Web workspace storage on the domain tables.
-- Adds the display fields the web app keeps per record, insertion-order columns (seq) so
-- lists come back in the order the web app wrote them, and two tenant tables for web-only data.
BEGIN;

-- Members: the web identifies members by name (unique per tenant, case-insensitive).
ALTER TABLE sajada.member
 ADD COLUMN initials text NOT NULL DEFAULT '' CHECK(length(initials)<=500),
 ADD COLUMN area text NOT NULL DEFAULT '' CHECK(length(area)<=500),
 ADD COLUMN level text NOT NULL DEFAULT 'Bronze' CHECK(length(level)<=500),
 ADD COLUMN reported_sales bigint NOT NULL DEFAULT 0 CHECK(reported_sales BETWEEN 0 AND 1000000000000),
 ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE UNIQUE INDEX member_tenant_name ON sajada.member(tenant_id,lower(name));

-- Products: catalog presentation fields.
ALTER TABLE sajada.product
 ADD COLUMN category text NOT NULL DEFAULT '' CHECK(length(category)<=500),
 ADD COLUMN emoji text NOT NULL DEFAULT '' CHECK(length(emoji)<=500),
 ADD COLUMN bg text NOT NULL DEFAULT '' CHECK(length(bg)<=500),
 ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;

-- Sales orders: the web order number (SJ-...), its calendar date and snapshot fields.
ALTER TABLE sajada.sales_order
 ADD COLUMN reference text CHECK(length(btrim(reference)) BETWEEN 1 AND 150),
 ADD COLUMN order_date text CHECK(length(order_date)<=40),
 ADD COLUMN paid_date text CHECK(length(paid_date)<=40),
 ADD COLUMN web jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(web)='object'),
 ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE UNIQUE INDEX sales_order_reference ON sajada.sales_order(tenant_id,reference) WHERE reference IS NOT NULL;
ALTER TABLE sajada.order_item ADD COLUMN name text CHECK(length(name)<=150);

-- Locations created from the web carry a free-text region label instead of a region row.
ALTER TABLE sajada.inventory_location
 ALTER COLUMN region_id DROP NOT NULL,
 ADD COLUMN region_label text CHECK(length(btrim(region_label)) BETWEEN 1 AND 200),
 ADD CONSTRAINT inventory_location_region_present CHECK(region_id IS NOT NULL OR region_label IS NOT NULL),
 ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;

-- Insertion order for histories and lists.
ALTER TABLE sajada.inventory_balance ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.inventory_document ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.inventory_movement ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.reorder_policy ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_order ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_receipt ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_supplier ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_confirmation ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_inspection ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_replacement ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sajada.purchase_replacement_reversal ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;

-- Orders marked paid in the web workspace (cash receipt or capital wallet).
CREATE TABLE sajada.web_order_payment(
 tenant_id uuid NOT NULL,order_id uuid NOT NULL,seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,order_id),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.sales_order(tenant_id,id));

-- Catalog stock adjustments shown on the product page.
CREATE TABLE sajada.product_stock_move(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),product_id uuid NOT NULL,
 product_name text NOT NULL CHECK(length(product_name)<=500),delta bigint NOT NULL,after bigint NOT NULL CHECK(after>=0),
 reference text NOT NULL CHECK(length(reference)<=500),date text NOT NULL CHECK(length(date)<=40),
 seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES sajada.product(tenant_id,id));

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['web_order_payment','product_stock_move'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
END LOOP;END$$;
COMMIT;


-- === 022 services/transaction/web-sections.sql ===
-- Migration 022 after web-workspace.sql. Tables for the web workspace sections whose demo rules
-- differ from the accounting modules (wallet journals, profit approval, PO-linked payables), plus
-- investor codes and MLM sponsor order on the domain tables. Values the web app keeps as text
-- (display dates, timestamps) are stored as text so they come back exactly as written.
BEGIN;

-- Investors: the web registry gives each investor a unique code.
ALTER TABLE sajada.investor
 ADD COLUMN code text CHECK(length(btrim(code)) BETWEEN 1 AND 150),
 ADD COLUMN seq bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE UNIQUE INDEX investor_tenant_code ON sajada.investor(tenant_id,code) WHERE code IS NOT NULL;

-- MLM network: sponsor_id already exists on member; network_seq marks members placed in the
-- network (NULL = not placed) and keeps their order.
ALTER TABLE sajada.member ADD COLUMN network_seq bigint;

CREATE TABLE sajada.web_capital_fee_plan(
 tenant_id uuid PRIMARY KEY REFERENCES sajada.tenant(id),
 member_dues bigint NOT NULL CHECK(member_dues>=0),admin_fee bigint NOT NULL CHECK(admin_fee>=0),other bigint NOT NULL CHECK(other>=0),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 1000),
 CHECK(member_dues+admin_fee+other=2500000));

CREATE TABLE sajada.web_member_capital(
 tenant_id uuid NOT NULL,member_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('allocated','disbursed')),
 disbursed_on text CHECK(length(disbursed_on)<=40),reference text CHECK(length(reference)<=500),
 wallet bigint CHECK(wallet=10000000),fee_member_dues bigint,fee_admin bigint,fee_other bigint,fee_note text CHECK(length(fee_note)<=1000),
 activated_at text CHECK(length(activated_at)<=40),activated_by text CHECK(length(activated_by)<=200),
 seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,member_id),FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 CHECK((wallet IS NULL)=(activated_at IS NULL)),CHECK(wallet IS NULL OR status='disbursed'));

CREATE TABLE sajada.web_funding_allocation(
 tenant_id uuid NOT NULL,member_id uuid NOT NULL,position int NOT NULL CHECK(position>=0),
 investor_id uuid NOT NULL,investor_name text NOT NULL CHECK(length(investor_name)<=150),amount bigint NOT NULL CHECK(amount>0),
 seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,member_id,position),FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 FOREIGN KEY(tenant_id,investor_id) REFERENCES sajada.investor(tenant_id,id));

-- Tiered profit-sharing reports (policy sajada-tiered-v1) with their segments and funding snapshot.
CREATE TABLE sajada.web_profit_report(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),member_id uuid NOT NULL,
 period text NOT NULL CHECK(period ~ '^\d{4}-(0[1-9]|1[0-2])$'),reference text NOT NULL CHECK(length(reference)<=500),
 revenue bigint NOT NULL CHECK(revenue>=0),cost bigint NOT NULL CHECK(cost>=0),status text NOT NULL CHECK(status IN ('pending','settled')),
 settlement_ref text CHECK(length(settlement_ref)<=500),policy text NOT NULL,profit bigint NOT NULL,
 member_share bigint NOT NULL,investor_share bigint NOT NULL,capital_returned bigint NOT NULL,investor_profit_share bigint NOT NULL,
 before_remaining bigint NOT NULL,before_post_recovery bigint NOT NULL,after_remaining bigint NOT NULL,after_post_recovery bigint NOT NULL,
 has_funding boolean NOT NULL DEFAULT false,
 seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,member_id,period),FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id));
CREATE TABLE sajada.web_profit_segment(
 tenant_id uuid NOT NULL,report_id text NOT NULL,position int NOT NULL,label text NOT NULL CHECK(length(label)<=500),profit bigint NOT NULL,
 member_percent numeric NOT NULL,investor_percent numeric NOT NULL,member_share bigint NOT NULL,investor_share bigint NOT NULL,capital_returned bigint NOT NULL,
 PRIMARY KEY(tenant_id,report_id,position),FOREIGN KEY(tenant_id,report_id) REFERENCES sajada.web_profit_report(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE sajada.web_profit_report_funding(
 tenant_id uuid NOT NULL,report_id text NOT NULL,position int NOT NULL,investor_id text NOT NULL CHECK(length(investor_id)<=150),
 investor_name text NOT NULL CHECK(length(investor_name)<=150),amount bigint NOT NULL CHECK(amount>0),
 PRIMARY KEY(tenant_id,report_id,position),FOREIGN KEY(tenant_id,report_id) REFERENCES sajada.web_profit_report(tenant_id,id) ON DELETE CASCADE);

-- Earlier flat profit-sharing records, kept for display.
CREATE TABLE sajada.web_legacy_profit_share(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),member_name text NOT NULL CHECK(length(member_name)<=150),
 period text NOT NULL,reference text NOT NULL,revenue bigint NOT NULL,cost bigint NOT NULL,profit bigint NOT NULL,distributable bigint NOT NULL,
 member_percent numeric NOT NULL,investor_percent numeric NOT NULL,member_share bigint NOT NULL,investor_share bigint NOT NULL,at text NOT NULL,
 seq bigint GENERATED BY DEFAULT AS IDENTITY,PRIMARY KEY(tenant_id,id));

-- MLM commission review.
CREATE TABLE sajada.web_commission_delivered(
 tenant_id uuid NOT NULL,order_id uuid NOT NULL,seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,order_id),FOREIGN KEY(tenant_id,order_id) REFERENCES sajada.sales_order(tenant_id,id));
CREATE TABLE sajada.web_commission_status(
 tenant_id uuid NOT NULL,commission_id text NOT NULL CHECK(length(commission_id) BETWEEN 1 AND 500),
 status text NOT NULL CHECK(status IN ('pending','approved','paid')),seq bigint GENERATED BY DEFAULT AS IDENTITY,PRIMARY KEY(tenant_id,commission_id));
CREATE TABLE sajada.web_commission_correction(
 tenant_id uuid NOT NULL,correction_id text NOT NULL CHECK(length(correction_id) BETWEEN 1 AND 500),
 seq bigint GENERATED BY DEFAULT AS IDENTITY,PRIMARY KEY(tenant_id,correction_id));
CREATE TABLE sajada.web_commission_audit(
 tenant_id uuid NOT NULL,seq bigint GENERATED BY DEFAULT AS IDENTITY,at text NOT NULL CHECK(length(at)<=40),
 action text NOT NULL CHECK(length(action)<=500),reference text NOT NULL CHECK(length(reference)<=500),actor text NOT NULL CHECK(length(actor)<=500),
 PRIMARY KEY(tenant_id,seq));
-- Distinguishes "review state saved with no corrections" from "corrections not tracked yet".
CREATE TABLE sajada.web_commission_review(
 tenant_id uuid PRIMARY KEY REFERENCES sajada.tenant(id),has_corrections boolean NOT NULL);

-- Tenant region tree used for member placement and member numbers.
CREATE TABLE sajada.web_region(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150),
 level text NOT NULL CHECK(level IN ('province','regency','district','village')),parent_id text,code text CHECK(code ~ '^[0-9]{2}$'),
 seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,parent_id) REFERENCES sajada.web_region(tenant_id,id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE sajada.web_region_assignment(
 tenant_id uuid NOT NULL,member_id uuid NOT NULL,region_id text NOT NULL,seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,member_id),FOREIGN KEY(tenant_id,member_id) REFERENCES sajada.member(tenant_id,id),
 FOREIGN KEY(tenant_id,region_id) REFERENCES sajada.web_region(tenant_id,id) DEFERRABLE INITIALLY DEFERRED);

-- Supplier bills, their payments and capital deposits from the web ledger.
CREATE TABLE sajada.web_supplier_bill(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 200),
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 150),date text NOT NULL,due text NOT NULL,currency text NOT NULL CHECK(currency IN ('IDR','USD','SGD')),
 amount numeric NOT NULL CHECK(amount>0),rate numeric NOT NULL CHECK(rate>0),base bigint NOT NULL CHECK(base>0),account text NOT NULL CHECK(account IN ('1300','5100')),
 receipt_id text,po_id text,quantity bigint,unit_cost bigint,created_at text,created_by text,
 seq bigint GENERATED BY DEFAULT AS IDENTITY,PRIMARY KEY(tenant_id,id));
CREATE TABLE sajada.web_supplier_bill_payment(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),bill_id text NOT NULL,amount bigint NOT NULL CHECK(amount>0),
 date text NOT NULL,reference text,actor text,at text,seq bigint GENERATED BY DEFAULT AS IDENTITY,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,bill_id) REFERENCES sajada.web_supplier_bill(tenant_id,id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE sajada.web_capital_deposit(
 tenant_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 150),amount bigint NOT NULL CHECK(amount>0),
 date text NOT NULL,note text NOT NULL CHECK(length(note)<=500),seq bigint GENERATED BY DEFAULT AS IDENTITY,PRIMARY KEY(tenant_id,id));
-- Marks that the ledger section exists for the tenant (an empty ledger is still a saved ledger).
CREATE TABLE sajada.web_section_presence(
 tenant_id uuid NOT NULL REFERENCES sajada.tenant(id),section text NOT NULL CHECK(length(section) BETWEEN 1 AND 100),PRIMARY KEY(tenant_id,section));

-- Optimistic concurrency for the web workspace: every save names the revision it started from.
CREATE TABLE sajada.web_workspace_revision(
 tenant_id uuid PRIMARY KEY REFERENCES sajada.tenant(id),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0));

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['web_workspace_revision','web_capital_fee_plan','web_member_capital','web_funding_allocation','web_profit_report','web_profit_segment','web_profit_report_funding','web_legacy_profit_share','web_commission_delivered','web_commission_status','web_commission_correction','web_commission_audit','web_commission_review','web_region','web_region_assignment','web_supplier_bill','web_supplier_bill_payment','web_capital_deposit','web_section_presence'] LOOP
 EXECUTE format('ALTER TABLE sajada.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sajada.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON sajada.%I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
END LOOP;END$$;
COMMIT;


-- === 023 services/transaction/web-maintenance.sql ===
-- Migration 023 after web-sections.sql. Demo reset and backup restore for the web workspace.
-- Removing workspace history bypasses the append-only guards, so this function is not granted to
-- anyone: grant EXECUTE only to the application role of a local/demo database, never production.
-- It acts on the tenant in app.tenant_id and refuses when accounting records from the /v1 API
-- (journals, wallet, capital, profit reports, supplier invoices) exist for that tenant.
BEGIN;
CREATE FUNCTION sajada.web_clear_workspace(target uuid,scope text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=sajada,pg_temp AS $$
DECLARE t text;
 guarded text[]:=ARRAY['sales_order','order_item','inventory_location','inventory_document','inventory_movement','purchase_order','purchase_receipt',
  'purchase_supplier','purchase_confirmation','purchase_inspection','purchase_replacement','purchase_replacement_reversal','member_number','member_number_counter'];
BEGIN
 IF target IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Tenant scope mismatch' USING ERRCODE='42501'; END IF;
 IF scope NOT IN ('transactions','everything') THEN RAISE EXCEPTION 'Unknown clear scope %',scope; END IF;
 IF EXISTS(SELECT 1 FROM journal WHERE tenant_id=target) OR EXISTS(SELECT 1 FROM capital_account WHERE tenant_id=target)
  OR EXISTS(SELECT 1 FROM capital_wallet_activation WHERE tenant_id=target) OR EXISTS(SELECT 1 FROM profit_report WHERE tenant_id=target)
  OR EXISTS(SELECT 1 FROM purchase_invoice WHERE tenant_id=target) OR EXISTS(SELECT 1 FROM purchase_payment WHERE tenant_id=target) THEN
  RAISE EXCEPTION 'Koperasi ini sudah mempunyai catatan akuntansi dari API; reset/pemulihan demo tidak tersedia.' USING ERRCODE='55000';
 END IF;
 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE sajada.%I DISABLE TRIGGER USER',t); END LOOP;
 -- Sales, stock and purchasing (both scopes).
 DELETE FROM web_commission_delivered WHERE tenant_id=target;
 DELETE FROM web_order_payment WHERE tenant_id=target;
 DELETE FROM order_item WHERE tenant_id=target;
 DELETE FROM sales_order WHERE tenant_id=target;
 DELETE FROM product_stock_move WHERE tenant_id=target;
 DELETE FROM purchase_replacement_reversal WHERE tenant_id=target;
 DELETE FROM purchase_replacement WHERE tenant_id=target;
 DELETE FROM purchase_inspection WHERE tenant_id=target;
 DELETE FROM purchase_confirmation WHERE tenant_id=target;
 DELETE FROM purchase_receipt WHERE tenant_id=target;
 DELETE FROM purchase_order WHERE tenant_id=target;
 DELETE FROM reorder_policy WHERE tenant_id=target;
 DELETE FROM purchase_supplier WHERE tenant_id=target;
 DELETE FROM inventory_movement WHERE tenant_id=target;
 DELETE FROM inventory_document WHERE tenant_id=target;
 DELETE FROM inventory_balance WHERE tenant_id=target;
 DELETE FROM inventory_config WHERE tenant_id=target;
 DELETE FROM inventory_location WHERE tenant_id=target;
 DELETE FROM product WHERE tenant_id=target;
 IF scope='everything' THEN
  -- Members, their numbers, investors and every web section (backup restore).
  DELETE FROM web_member_capital WHERE tenant_id=target;
  DELETE FROM web_funding_allocation WHERE tenant_id=target;
  DELETE FROM web_profit_report WHERE tenant_id=target;
  DELETE FROM web_region_assignment WHERE tenant_id=target;
  DELETE FROM member_number WHERE tenant_id=target;
  DELETE FROM member_number_counter WHERE tenant_id=target;
  UPDATE member SET sponsor_id=NULL WHERE tenant_id=target AND sponsor_id IS NOT NULL;
  DELETE FROM member WHERE tenant_id=target;
  DELETE FROM investor WHERE tenant_id=target AND code IS NOT NULL;
 END IF;
 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE sajada.%I ENABLE TRIGGER USER',t); END LOOP;
END $$;
REVOKE ALL ON FUNCTION sajada.web_clear_workspace(uuid,text) FROM PUBLIC;
COMMIT;

