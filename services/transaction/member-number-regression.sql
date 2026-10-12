-- Run with psql -v ON_ERROR_STOP=1 -f member-number-regression.sql on a disposable *_test database.
-- Requires migrations 001–003; fixture writes always rolled back.
BEGIN;
DO $$
DECLARE t uuid:=gen_random_uuid(); member_a uuid:=gen_random_uuid(); member_b uuid:=gen_random_uuid();
 prefix text:='test-'||gen_random_uuid()::text; code text; a sajada.member_number; b sajada.member_number; count_value integer;
BEGIN
 IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'Use disposable database ending _test'; END IF;
 SELECT lpad(n::text,2,'0') INTO code FROM generate_series(0,99) n
 WHERE NOT EXISTS(SELECT 1 FROM sajada.region WHERE parent_id IS NULL AND local_code=lpad(n::text,2,'0')) LIMIT 1;
 IF code IS NULL THEN RAISE EXCEPTION 'No free test province code'; END IF;
 INSERT INTO sajada.tenant(id,name) VALUES(t,'numbering regression');
 PERFORM set_config('app.tenant_id',t::text,true);
 INSERT INTO sajada.region(id,parent_id,kind,name,local_code) VALUES
 (prefix||'-p',NULL,'province','Test province',code),
 (prefix||'-k',prefix||'-p','regency','Test regency','01'),
 (prefix||'-c',prefix||'-k','district','Test district','02'),
 (prefix||'-v',prefix||'-c','village','Test village',NULL);
 INSERT INTO sajada.member(tenant_id,id,name,region_id,status) VALUES
 (t,member_a,'Member A',prefix||'-v','active'),(t,member_b,'Member B',prefix||'-v','active');
 SELECT * INTO a FROM sajada.issue_member_number(t,member_a,'test-actor');
 SELECT * INTO b FROM sajada.issue_member_number(t,member_a,'test-actor');
 IF a.number<>b.number OR a.sequence_no<>1 THEN RAISE EXCEPTION 'Idempotency failed'; END IF;
 SELECT * INTO b FROM sajada.issue_member_number(t,member_b,'test-actor');
 IF b.sequence_no<>2 OR b.number=a.number THEN RAISE EXCEPTION 'Counter increment failed'; END IF;
 IF a.number<>code||'0102'||right(extract(year FROM a.issued_at AT TIME ZONE 'Asia/Jakarta')::integer::text,2)||'000001' THEN RAISE EXCEPTION 'Number format mismatch'; END IF;
 SELECT count(*) INTO count_value FROM sajada.outbox WHERE tenant_id=t AND event_type='member.number.issued';
 IF count_value<>2 THEN RAISE EXCEPTION 'Duplicate issuance event'; END IF;
 BEGIN
  UPDATE sajada.member_number SET number=number WHERE tenant_id=t AND member_id=member_a;
  RAISE EXCEPTION 'Immutable record unexpectedly updated';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  PERFORM sajada.issue_member_number(gen_random_uuid(),member_a,'test-actor');
  RAISE EXCEPTION 'Wrong tenant unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'Numbering regression checks passed; fixtures will roll back';
END $$;
ROLLBACK;
