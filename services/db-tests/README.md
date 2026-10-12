# Embedded PostgreSQL regression tests — Sajada v0.16

Run from this folder:

    npm ci
    npm test

PGlite 0.5.8 is pinned in package-lock.json. Tests run a fresh in-memory PostgreSQL engine, load pgcrypto and execute all three application migrations unchanged. They do not connect to production or read credentials.

Verified in authoring environment: 15 SQL subtests passed (Node reports 16 including parent test), with 100 sequential distinct member issuances.

Coverage:
- Migrations parse and execute, including constraints, triggers, functions and RLS.
- Issuance under a non-owner NOSUPERUSER NOBYPASSRLS role using minimum grants.
- Format, actor and outbox insertion; retry idempotency; independent tenant counters.
- RLS hides foreign tenant records, explicit tenant mismatch and foreign member rejected.
- Missing region consumes no counter; transaction rollback restores row/counter/event.
- Issued number immutable, counter cannot move backward, limit 999999 enforced.
- 100 distinct members receive unique contiguous numbers, sequentially.
- Balanced journal can post, posted line mutation is rejected, unbalanced posting rejected.

Limitations: one embedded process/session, not parallel native PostgreSQL clients. This is not evidence of native concurrency, native PostgreSQL 16 compatibility across all features, OIDC HTTP integration, browser QA or deployment readiness. Native installation attempt was blocked by OS identity/group permissions, so no restrictions were weakened; embedded testing used an isolated npm dependency instead.

Still required before production: independent native PostgreSQL connections, competing same/different member issuance, crash/retry tests, OIDC service integration, backup/restore against deployed database and existing-number migration reconciliation.

## v0.17 HTTP/JWT integration
Install both dependency sets before tests:

    cd services/transaction && npm ci
    cd ../db-tests && npm ci && npm test

Added http.test.mjs: 13 HTTP cases pass using real loopback HTTP servers, RSA-signed JWTs, a local JWKS endpoint, the actual createApi handler and an embedded PostgreSQL adapter running under the non-owner role. Missing/Bearer-less/tampered/expired/wrong-audience token rejected; tenant header and staff/admin rights enforced; GET before issuance returns 404; POST/read/list/retry and foreign-member isolation checked.

The test pool serializes the single embedded session. It does not simulate parallel native clients. Signing keys are generated per test process and never saved. Tests do not connect to an external identity provider. Authorization-code login, refresh tokens, key rotation, deployed provider configuration, TLS/reverse proxy and production OIDC remain untested.

server.mjs now exports createApi for integration testing; normal `npm start` still creates a real pg.Pool and requires the same environment variables. No authentication bypass or test endpoint is added to production code. Bearer scheme is now strictly required.

## v0.18 capital and profit entitlements

`npm test` now runs numbering.test.mjs, http-orders.test.mjs and profit.test.mjs. The expanded HTTP suite includes the prior 13 JWT/numbering cases, six order/payment cases and six capital/profit cases (25 total). profit.test.mjs contains 13 database service cases: funding validation, immutable snapshots, draft balances, retries, rollback, settlement, tiers, investor allocations and RLS. Both new suites execute migration 004 unchanged. PGlite tests serialize connections and do not demonstrate native concurrency.

## v0.19 draft corrections

24 capital/profit database subtests and 33 HTTP subtests passed (57 scenarios; Node counts 59 including two parents). Coverage adds cancellation role checks, required reason, atomic rollback, unchanged balances, immutable cancelled reports, safe retries, correction lineage, same-period replacement, branch prevention and settlement of corrected profit. Migrations 001–005 execute on a fresh PGlite instance; native parallel connections and production database upgrade remain untested.

## v0.20 independent approval

32 capital/profit database cases, 38 HTTP cases and 2 upgrade cases passed (72 scenarios, excluding three parent tests). Includes self approval rejection, role enforcement, immutable approval audit, safe retries, rollback, database settlement gating and cancellation of approved drafts. The upgrade test loads 001–005, seeds old settled/open reports, then applies 006 and verifies history is preserved without invented approval. Native concurrency and live identity-provider deployment remain untested.


## v0.21 Inventori
`inventory.test.mjs` menguji 17 skenario pada role non-owner: lokasi, aktivasi satu kali, reservasi, transfer, pengiriman, retur, retry, rollback, RLS, audit dan constraint saldo. Suite HTTP menambahkan 8 skenario inventori termasuk checkout lokasi dan otorisasi. Domain inventori memiliki 13 skenario; backup 8 skenario lama dan 1 skenario inventori lulus.


## v0.29 HTTP AP additions

`node --test http-orders.test.mjs` now applies migrations through 012 and tests PO-receipt invoice posting, payments, trial balance, non-owner RLS, stable UUID retries, exact matching and atomic rollback after simulated outbox privilege failure. Adapter runs one embedded session; this is not a concurrent native PostgreSQL test. Domain parity is maintained by `node ../transaction/build-inventory-domain.mjs` from this directory (run the helper from repo root with its full path if desired).
