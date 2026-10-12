# Sajada v0.2 backend foundation

## Status
Source code not connected to hosted browser demo. Current v0.20 adds independent approval before profit settlement, alongside audited draft cancellation and linked corrections on top of investor registration, IDR12.5m capital snapshots, tiered profit drafts and atomic entitlement settlement. See transaction/PROFIT-SHARING.md for migrations 004–006, grants, API and explicit accounting/payout limits. Embedded PostgreSQL/JWT tests have passed; native PostgreSQL, Docker, ClickHouse runtime and production OIDC deployment remain untested.

## Local database setup
1. Install Docker with Compose. Export POSTGRES_PASSWORD and CLICKHOUSE_PASSWORD using your secure local environment.
2. From services/: `docker compose up -d`. Initialization files run only for a fresh volume. Never delete a volume containing needed records.
3. As the database owner create a LOGIN role with NOSUPERUSER NOBYPASSRLS and a unique secret. Grant CONNECT on sajada, USAGE on schema sajada and only required table privileges. Transaction role needs SELECT on tenant/member/product/order tables, INSERT/UPDATE on order and product, INSERT/SELECT/UPDATE on journal and lines, INSERT on outbox. Analytics role needs SELECT/UPDATE on outbox only. Do not run either service as sajada_owner.
4. Seed tenant, active member, and IDR-priced products using the database owner. Copy UUIDs to test requests and OIDC tenant membership claim. Multi-currency write workflow is deliberately not active yet.
5. Configure OIDC issuer/JWKS/audience. Access token must contain signed `tenant_ids: [uuid]` and `roles: [tenant_admin or accountant]`. No development authentication bypass is provided. Staff-only ordering is intentional for this first slice; member self-service authorization is pending.

## Transaction API
From transaction/: npm install; set DATABASE_URL (application role), OIDC_JWKS_URL, OIDC_ISSUER, OIDC_AUDIENCE, optional PORT=8080; npm start.
Use Authorization: Bearer <OIDC access token>, X-Tenant-Id: <authorized UUID>.
- GET /healthz (no DB readiness check)
- GET /v1/products
- GET /v1/orders (staff)
- POST /v1/orders, Idempotency-Key required. JSON: {"member_id":"UUID","items":[{"product_id":"UUID","quantity":1}]}.
- POST /v1/orders/{id}/payments, Idempotency-Key required. Staff records full receipt; repeated payment cannot create another journal for same order.

Prices are read from PostgreSQL, sorted row locks prevent stock races, order request fingerprint rejects mismatched retries, RLS scopes tenant access. Stock is deducted at order creation; expiration/cancellation release is NOT implemented. No fractional quantities in this API slice. Pending orders do not create revenue. Payment journal: Dr cash / Cr customer advance; fulfillment revenue and COGS still pending. The hosted browser demo retains its simplified sales/AR illustration and does not invoke this API.

## Analytics
From analytics/: npm install; configure DATABASE_URL (analytics role), CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, TENANT_IDS (comma-separated allowed UUIDs); npm start.
Worker copies committed outbox events into ClickHouse. Failed inserts roll back acknowledgments. Crash after insert can replay a batch; ReplacingMergeTree plus FINAL prevents duplicate read results. All rows are immutable version 1. Tenant filtering is required on every query. There is no public analytics API yet. Use TLS when outside trusted local development. No Redis/Kafka dependency is claimed in this vertical slice.

## Remaining implementation
AP supplier bills, complete AR lifecycle, fulfillment/revenue, refunds, stock release, actual MLM tree and approved commission payouts, tenant-scoped RBAC beyond staff roles, chart of accounts/period closing, FX snapshots/revaluation, audit actor and IP, migrations/versioning, readiness probes, lockfiles/dependency review, integration/concurrency tests, live metrics, retry backoff/dead letter handling, PostgreSQL/ClickHouse deployment, backup restore verification. SQL is for a new development database and not an upgrade over arbitrary existing data.


## v0.21 Persediaan lokasi
Depot provinsi, kabupaten, kecamatan dan tempat anggota kini memiliki saldo fisik, reservasi, transfer dua tahap, pengiriman, retur terbatas dan opname. Migrasi 007, API serta aktivasi saldo lama dijelaskan pada [INVENTORY.md](transaction/INVENTORY.md). Backend belum dipasang produksi atau terhubung ke web demo.
