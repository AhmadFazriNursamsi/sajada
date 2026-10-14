-- Member self-registration and member contact/family details.
-- Idempotent: db-setup applies it on every start after web-auth.sql (docker/db.Dockerfile builds
-- /sajada/app-role.sql from web-auth.sql, this file and services/local-dev-role.sql).
SET client_min_messages = warning;

-- Contact and family status (Bab 2: J Janda, D Duda, B Bapak, I Ibu, L anak laki-laki,
-- P anak perempuan). Members registered before this stay empty until they are updated.
ALTER TABLE sajada.member ADD COLUMN IF NOT EXISTS phone text CHECK (phone ~ '^\+?[0-9]{8,15}$');
ALTER TABLE sajada.member ADD COLUMN IF NOT EXISTS email text CHECK (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
ALTER TABLE sajada.member ADD COLUMN IF NOT EXISTS family_status char(1) CHECK (family_status IN ('J','D','B','I','L','P'));

-- A prospective member's request from the public sign-up page. It becomes a member and a member
-- (portal) account only when a member officer or admin of that koperasi approves it.
CREATE TABLE IF NOT EXISTS sajada.member_registration (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES sajada.tenant,
 full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 3 AND 100),
 phone text NOT NULL CHECK (phone ~ '^\+?[0-9]{8,15}$'),
 email text CHECK (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 family_status char(1) NOT NULL CHECK (family_status IN ('J','D','B','I','L','P')),
 -- A kelurahan/desa from the koperasi's Struktur daerah, or a typed area when it has none.
 region_id text,
 area text NOT NULL CHECK (length(trim(area)) BETWEEN 2 AND 100),
 sponsor_note text CHECK (length(sponsor_note) <= 100),
 username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
 password_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 client_ip text,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid REFERENCES sajada.app_user,
 decision_note text CHECK (length(decision_note) <= 300),
 member_id uuid,
 CHECK ((status = 'pending') = (decided_at IS NULL)),
 CHECK ((status = 'approved') = (member_id IS NOT NULL))
);
-- One open request per username and per phone number.
CREATE UNIQUE INDEX IF NOT EXISTS member_registration_pending_username ON sajada.member_registration (username) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS member_registration_pending_phone ON sajada.member_registration (tenant_id, phone) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS member_registration_tenant ON sajada.member_registration (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS member_registration_ip ON sajada.member_registration (client_ip, created_at);
