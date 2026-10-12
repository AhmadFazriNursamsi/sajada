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
