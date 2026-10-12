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
