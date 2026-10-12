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
