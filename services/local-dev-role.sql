-- LOCAL DEVELOPMENT ONLY. Creates/updates the application role the Next.js app connects as.
-- Run as the database owner: psql -v ON_ERROR_STOP=1 -v pw=<password> -f local-dev-role.sql
-- Production grants should be the per-module minimum from the guides (INVENTORY.md, ...), and
-- must not include web_clear_workspace, which bypasses the append-only history guards.
SELECT format('CREATE ROLE sajada_api LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sajada_api') \gexec
SELECT format('ALTER ROLE sajada_api PASSWORD %L', :'pw') \gexec
GRANT CONNECT ON DATABASE sajada TO sajada_api;
GRANT USAGE ON SCHEMA sajada TO sajada_api;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sajada TO sajada_api;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sajada TO sajada_api;
-- Web-only section tables are rewritten as a whole on save.
DO $$DECLARE t text;BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sajada' AND tablename LIKE 'web\_%' AND tablename<>'web_order_payment' LOOP
 EXECUTE format('GRANT DELETE ON sajada.%I TO sajada_api',t);END LOOP;END$$;
-- Demo reset and backup restore in the web app.
GRANT EXECUTE ON FUNCTION sajada.web_clear_workspace(uuid,text) TO sajada_api;
-- Web sign-in (web-auth.sql, applied before this file): sign-out deletes sessions, account
-- edits replace koperasi access, and the audit trail is append-only.
GRANT DELETE ON sajada.app_session, sajada.app_user_tenant TO sajada_api;
REVOKE UPDATE ON sajada.app_user_audit FROM sajada_api;
