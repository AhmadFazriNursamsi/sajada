# PostgreSQL member numbering — v0.15

Status v0.16: source and migrations tested in embedded PostgreSQL; NOT deployed or tested with native parallel connections. Hosted frontend still uses browser demo numbering. No credentials or server endpoints were supplied. Do not switch live numbering until the migration and concurrency test pass.

## Database installation
Apply architecture/postgresql.sql, transaction/hardening.sql and transaction/member-number.sql in that order to a fresh development database. Existing databases need a reviewed migration process; these scripts are not blindly repeatable. Docker Compose adds migration 003 only for newly initialized volumes. Do not erase existing volumes to upgrade.

`member_number` has one number per tenant/member and unique tenant/number and tenant/year/sequence. Immutable rows preserve issuing codes/time/actor. Counter advancement is exactly +1 with maximum 999999. Function is SECURITY INVOKER with explicit tenant-context check and row locking, not a privileged bypass of RLS.

Counter/issued record/event are committed together by the API transaction. An aborted call rolls them all back. Member row locking serializes retries for the same member; ON CONFLICT UPDATE serializes different members on the tenant/year counter. The stored number is returned on retry regardless of later region/status changes. New numbers require active members and a full village->district->regency->province chain with two-digit local codes.

The backend's existing region table is a shared authoritative master, read-only to the API. Frontend demo region data is tenant-local; migration must reconcile it into the authoritative master before integration. No region code dataset has been imported or verified.

## Minimum service-role privileges
Use a dedicated NOSUPERUSER NOBYPASSRLS non-owner role. In addition to existing API grants:
- SELECT on sajada.region (no master writes).
- SELECT/UPDATE on sajada.member (UPDATE permission needed by row lock).
- SELECT/INSERT on sajada.member_number.
- SELECT/INSERT/UPDATE on sajada.member_number_counter.
- INSERT on sajada.outbox.
- EXECUTE on sajada.issue_member_number(uuid,uuid,text).
- USAGE on sajada and CONNECT on database.
No DELETE/TRUNCATE, schema CREATE, owner or superuser rights. Credentials remain server-side. Issuance function EXECUTE is revoked from PUBLIC.

## API
All routes require signed OIDC access token and X-Tenant-Id included in verified tenant_ids claim. Staff roles can read; tenant_admin can issue. Actor comes from token sub, never request body.
- GET /v1/members: first 100 members with current number. Pagination still pending.
- GET /v1/members/{member_uuid}/number: issued number or 404.
- POST /v1/members/{member_uuid}/number: issue or return existing number (200). No request body/caller date/caller counter accepted. Member identity is the idempotency key.
- Audit: member.number.issued outbox event once per new issuance, actor and timestamp included.

Example response fields: tenant_id, member_id, number, issue_year, sequence_no, province_code, regency_code, district_code, issued_at, issued_by.

## Verification to run before deployment
1. On an isolated database ending _test, run psql -v ON_ERROR_STOP=1 -f member-number-regression.sql. It rolls fixtures back. Tests format, retries, counter, outbox, immutable row and explicit tenant-context guard. It does not prove RLS if run as superuser.
2. Run service under non-owner role and test two tenants: direct row access and API reads cannot see other tenant numbers; forged tenant header denied.
3. Create 100 active test members, issue concurrently from at least 10 connections, assert 100 unique numbers and counter=100. Repeat same-member calls concurrently, assert one issued row/event and unchanged counter.
4. Verify transaction rollback, counter exhaustion, missing codes and API privilege mapping. Compare browser-generated existing numbers before migration; never renumber live members silently.

Update v0.16: all three migrations executed unchanged in PGlite 0.5.8, with 15 SQL subtests passing (including non-owner RLS, retry/rollback, sequential batch and journal constraints). See ../db-tests/README.md. The psql regression file and native PostgreSQL concurrency have not been executed. Update v0.17: 13 HTTP/JWT cases pass with real local HTTP/JWKS servers and embedded PostgreSQL. Actual identity-provider login/deployment and native concurrency are still untested.
