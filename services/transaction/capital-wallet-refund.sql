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
