# Sajada v0.1 — prototype and production design

## Implemented
React web application with Next-compatible routing on Vinext. Responsive dashboard, product catalog/filter/cart, local demo orders, AR collection and balanced sales/payment GL, member registration, illustrative MLM tree and income, region drilldown, currency display. Browser storage is for demonstration only. No live money movement, authentication, inventory locking, supplier settlement or real commissions. Member and network examples are shared demo fixtures; tenant selection is not a security boundary. Dates and reporting KPIs are illustrative.

## Production target
- Web: Next.js App Router, TanStack Query for server cache. Do not add React Router on top of Next routing.
- Mobile: separate React Native/Expo app, React Navigation, shared TypeScript contracts and TanStack Query. Not yet implemented.
- Gateway: HTTPS, OIDC authentication, derive tenant membership from verified claims. Never trust client tenant_id alone.
- Services: identity/tenant; member/region; catalog/inventory; order/payment; MLM/commission; accounting/AP/AR/GL; reporting.
- PostgreSQL: schema/database owned by each domain, UUID identifiers, numeric monetary fields, transaction currency + frozen exchange rate + base currency amount. Row level security with non-owner service roles, tenant-aware composite foreign keys.
- ClickHouse: analytical read model only, event_id deduplication and reconciliation; never authoritative for balances or payouts. Consume PostgreSQL outbox through Kafka/Redpanda or Debezium CDC.
- Redis: rate limits, ephemeral cache, idempotency acceleration (durable idempotency retained in PostgreSQL).
- S3-compatible object store: product images and private documents with signed access.
- Kubernetes/container deployment, secret manager, OpenTelemetry, backup/PITR and restore drills.

## Key workflow
Order draft -> inventory reservation -> payment pending -> verified payment webhook -> fulfilled -> commission eligibility -> commission approval -> disbursement. Refunds generate reversal events and clawbacks. Events use event_id, tenant_id, aggregate_id, version, occurred_at, trace_id, schema_version. Consumers use inbox deduplication and outbox retries. No distributed transaction is assumed.

Demo deliberately creates AR at checkout to show the accounting flow. Production revenue recognition must follow the approved fulfillment/accounting policy. Inventory/COGS, taxes, FX revaluation, refunds, period closing, cash reconciliation and SHU distribution remain to be implemented.

## MLM policy to configure
Illustrative unilevel rates: personal 5%, level 1 3%, level 2 2%, level 3 1%. Basis is eligible net product sales, not recruitment. Snapshot sponsor tree at transaction time; reject cycles; unique sponsor within tenant; effective-dated policy versions; cancel/refund adjustment; approval and audit trail. Personal and group sales must not double count. Commission is separate from cooperative SHU. Policy requires stakeholder validation before activation.

## API boundaries (planned)
All protected routes require verified tenant scope; mutating requests require Idempotency-Key.
GET/POST /v1/members; GET /v1/members/:id/network
GET /v1/regions?parent_id=; GET/POST /v1/products
POST /v1/orders; GET /v1/orders/:id; POST /v1/orders/:id/cancel
POST /v1/payments/webhooks/:provider (signature verification, no session auth)
GET /v1/commissions; POST /v1/commission-runs; POST /v1/commission-runs/:id/approve
GET /v1/accounting/ar; GET /v1/accounting/ap; POST /v1/accounting/payments
GET /v1/accounting/journals; POST /v1/accounting/journals/:id/post
GET /v1/analytics/sales; GET /v1/analytics/network

## Deployment status
Hosted prototype uses browser-local demo data. PostgreSQL, ClickHouse, independent microservices and native mobile binaries are not deployed. SQL files are design starting points, not validated production migrations.

## v0.2 update
See services/README.md for the implemented backend foundation and mobile/README.md for the separate React Native starter. Neither is deployed. Hosted web now keeps separate demo state per tenant. Database integration and device tests remain pending.
