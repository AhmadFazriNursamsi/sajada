-- Web app sign-in: user accounts, their roles and koperasi (tenant) access, and sessions.
-- Idempotent: db-setup applies it on every start (docker/db.Dockerfile builds /sajada/app-role.sql
-- from this file and services/local-dev-role.sql), so existing databases get it too.
-- Accounts are not tenant rows: one staff account may work in several koperasi.
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS sajada.app_user (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
 display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
 -- Staff: admin, accountant, member_officer, depot_officer, viewer. Self-service: member, investor.
 role text NOT NULL CHECK (role IN ('admin','accountant','member_officer','depot_officer','viewer','member','investor')),
 password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true,
 -- A member or investor account sees only that person's data in one koperasi.
 tenant_id uuid REFERENCES sajada.tenant,
 member_id uuid,
 investor_id uuid,
 failed_logins integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
 locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, member_id) REFERENCES sajada.member (tenant_id, id),
 FOREIGN KEY (tenant_id, investor_id) REFERENCES sajada.investor (tenant_id, id),
 CHECK ((role = 'member') = (member_id IS NOT NULL)),
 CHECK ((role = 'investor') = (investor_id IS NOT NULL)),
 CHECK ((role IN ('member','investor')) = (tenant_id IS NOT NULL))
);

-- Koperasi a staff account may open (member/investor accounts use app_user.tenant_id instead).
CREATE TABLE IF NOT EXISTS sajada.app_user_tenant (
 user_id uuid NOT NULL REFERENCES sajada.app_user ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES sajada.tenant,
 PRIMARY KEY (user_id, tenant_id)
);

-- Only a SHA-256 of the session token is stored; the token itself lives in the browser cookie.
CREATE TABLE IF NOT EXISTS sajada.app_session (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES sajada.app_user ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_session_user ON sajada.app_session (user_id);

-- Sign-ins and account changes, append-only for the application role.
CREATE TABLE IF NOT EXISTS sajada.app_user_audit (
 id bigserial PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid REFERENCES sajada.app_user,
 user_id uuid REFERENCES sajada.app_user,
 action text NOT NULL CHECK (action IN ('login','login_failed','logout','create','update','password_reset','password_change')),
 detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS app_user_audit_user ON sajada.app_user_audit (user_id, at DESC);
