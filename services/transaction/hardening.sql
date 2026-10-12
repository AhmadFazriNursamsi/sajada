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
