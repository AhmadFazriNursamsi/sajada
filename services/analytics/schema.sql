CREATE DATABASE IF NOT EXISTS sajada_analytics;
CREATE TABLE IF NOT EXISTS sajada_analytics.domain_event (
 tenant_id UUID, event_id UUID, aggregate_id UUID, event_type LowCardinality(String),
 payload String, occurred_at DateTime64(3,'UTC'), version UInt64
) ENGINE=ReplacingMergeTree(version)
PARTITION BY toYYYYMM(occurred_at) ORDER BY (tenant_id,event_id);
-- SELECT event_type,count() FROM sajada_analytics.domain_event FINAL
-- WHERE tenant_id={tenant:UUID} GROUP BY event_type;
-- payment.recorded is cash received, not recognized revenue.
