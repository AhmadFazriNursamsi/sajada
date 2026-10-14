# PostgreSQL with Sajada's schema and migrations, published as ghcr.io/<owner>/sajada-db.
# A new data volume runs every script below in name order; services/compose.yaml builds the
# same image for local development. Build context: the repository root.
FROM postgres:16-alpine
ENV POSTGRES_DB=sajada POSTGRES_USER=sajada_owner
COPY architecture/postgresql.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY services/transaction/hardening.sql /docker-entrypoint-initdb.d/02-hardening.sql
COPY services/transaction/member-number.sql /docker-entrypoint-initdb.d/03-member-number.sql
COPY services/transaction/profit-sharing.sql /docker-entrypoint-initdb.d/04-profit-sharing.sql
COPY services/transaction/profit-corrections.sql /docker-entrypoint-initdb.d/05-profit-corrections.sql
COPY services/transaction/profit-approval.sql /docker-entrypoint-initdb.d/06-profit-approval.sql
COPY services/transaction/inventory.sql /docker-entrypoint-initdb.d/07-inventory.sql
COPY services/transaction/order-cancel.sql /docker-entrypoint-initdb.d/08-order-cancel.sql
COPY services/transaction/order-dispatch.sql /docker-entrypoint-initdb.d/09-order-dispatch.sql
COPY services/transaction/order-receipt.sql /docker-entrypoint-initdb.d/10-order-receipt.sql
COPY services/transaction/replenishment.sql /docker-entrypoint-initdb.d/11-replenishment.sql
COPY services/transaction/payables.sql /docker-entrypoint-initdb.d/12-payables.sql
COPY services/transaction/suppliers.sql /docker-entrypoint-initdb.d/13-suppliers.sql
COPY services/transaction/po-delivery.sql /docker-entrypoint-initdb.d/14-po-delivery.sql
COPY services/transaction/po-confirmation.sql /docker-entrypoint-initdb.d/15-po-confirmation.sql
COPY services/transaction/po-inspection.sql /docker-entrypoint-initdb.d/16-po-inspection.sql
COPY services/transaction/po-replacement.sql /docker-entrypoint-initdb.d/17-po-replacement.sql
COPY services/transaction/po-replacement-reversal.sql /docker-entrypoint-initdb.d/18-po-replacement-reversal.sql
COPY services/transaction/capital-wallet.sql /docker-entrypoint-initdb.d/19-capital-wallet.sql
COPY services/transaction/capital-wallet-refund.sql /docker-entrypoint-initdb.d/20-capital-wallet-refund.sql
COPY services/transaction/web-workspace.sql /docker-entrypoint-initdb.d/21-web-workspace.sql
COPY services/transaction/web-sections.sql /docker-entrypoint-initdb.d/22-web-sections.sql
COPY services/transaction/web-maintenance.sql /docker-entrypoint-initdb.d/23-web-maintenance.sql
# Applied by the db-setup service on every start (deploy/compose.yaml, services/compose.yaml):
# the idempotent sign-in and registration tables, then the application role and its grants.
COPY services/transaction/web-auth.sql services/transaction/web-registration.sql services/local-dev-role.sql /tmp/role/
RUN mkdir -p /sajada && cat /tmp/role/web-auth.sql /tmp/role/web-registration.sql /tmp/role/local-dev-role.sql > /sajada/app-role.sql && rm -r /tmp/role
