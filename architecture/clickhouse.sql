-- Analytical design, not wired to prototype. Ingest approved sales/refund events.
CREATE DATABASE IF NOT EXISTS sajada_analytics;
CREATE TABLE sajada_analytics.sales_event (
 tenant_id UUID, event_id UUID, order_id UUID, member_id UUID,
 occurred_at DateTime64(3,'UTC'), currency LowCardinality(String), amount Decimal(20,4),
 base_currency LowCardinality(String), amount_base Decimal(20,4),
 province_code String, regency_code String, event_type LowCardinality(String), version UInt64
) ENGINE=ReplacingMergeTree(version)
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id,event_id);
-- Tenant context must be enforced in analytics API; never expose raw ClickHouse credentials to clients.
-- FINAL below deduplicates replayed events; benchmark and maintain reconciled aggregates at scale.
-- Refund amount_base is signed negative. Do not ingest draft orders as recognized revenue.
-- SELECT toDate(occurred_at) day, sum(amount_base) revenue
-- FROM sajada_analytics.sales_event FINAL
-- WHERE tenant_id={tenant:UUID} AND occurred_at >= {start:DateTime} AND occurred_at < {end:DateTime}
-- GROUP BY day ORDER BY day;
