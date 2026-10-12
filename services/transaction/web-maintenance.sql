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
