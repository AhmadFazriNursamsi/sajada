-- Migration 014 after suppliers.sql. Do not infer lead time for legacy POs.
BEGIN;
ALTER TABLE sajada.purchase_order ADD CONSTRAINT po_delivery_schedule CHECK (
 (NOT (data ? 'leadDays') AND NOT (data ? 'expectedOn')) OR
 (data ?& ARRAY['leadDays','createdAt'] AND jsonb_typeof(data->'createdAt')='string' AND jsonb_typeof(data->'leadDays')='number' AND (data->>'leadDays')::integer BETWEEN 0 AND 365 AND
  ((data->>'status' IN ('draft','cancelled') AND NOT (data ? 'expectedOn')) OR
   (data->>'status' IN ('approved','closed') AND data ? 'expectedOn' AND jsonb_typeof(data->'expectedOn')='string'
    AND jsonb_typeof(data->'approvedAt')='string' AND (data->>'approvedAt')::timestamptz >= (data->>'createdAt')::timestamptz
    AND data->>'expectedOn'=to_char(((data->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Jakarta') + make_interval(days => (data->>'leadDays')::integer),'YYYY-MM-DD'))))
);
CREATE OR REPLACE FUNCTION sajada.guard_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PO history cannot be deleted'; END IF;
 IF OLD.data->>'status' IN ('closed','cancelled') THEN RAISE EXCEPTION 'Final PO is immutable'; END IF;
 IF (NEW.tenant_id,NEW.id,NEW.location_id,NEW.product_id) IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.location_id,OLD.product_id)
 OR (NEW.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason','expectedOn']) IS DISTINCT FROM (OLD.data - ARRAY['status','received','approvedAt','approvedBy','cancelledAt','cancelledBy','cancelReason','expectedOn']) THEN RAISE EXCEPTION 'PO snapshot is immutable'; END IF;
 IF (NEW.data->>'received')::bigint < (OLD.data->>'received')::bigint OR (NEW.data->>'received')::bigint > (NEW.data->>'quantity')::bigint THEN RAISE EXCEPTION 'PO receipt out of bounds'; END IF;
 IF OLD.data->>'status'='draft' AND NEW.data->>'status' NOT IN ('approved','cancelled') OR OLD.data->>'status'='approved' AND NEW.data->>'status' NOT IN ('approved','closed') THEN RAISE EXCEPTION 'Invalid PO transition'; END IF;
 IF OLD.data->>'status'='approved' AND (NEW.data->>'approvedAt',NEW.data->>'approvedBy',NEW.data->>'expectedOn') IS DISTINCT FROM (OLD.data->>'approvedAt',OLD.data->>'approvedBy',OLD.data->>'expectedOn') THEN RAISE EXCEPTION 'PO approval immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;
