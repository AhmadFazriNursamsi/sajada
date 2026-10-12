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
