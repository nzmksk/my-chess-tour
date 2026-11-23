-- =============================================
-- #708: the stuck-refunds list names the payer, not the participant.
--
-- A refund goes back to whoever paid, so that is who the admin has to reach
-- about one that is stuck. list_stuck_refunds read the name and address from
-- registrations.user_id, the participant; it now reads them from the payer on
-- the registration's current payment (payments.user_id), and the columns are
-- renamed payer_name / payer_email to say so. The payer is joined without the
-- paid filter that gates original_chip_purchase_id, so a refund whose payment
-- is missing its purchase still shows who it belongs to.
--
-- A changed return type can't be replaced in place, so the function is dropped
-- and recreated, and its privileges granted again.
-- =============================================

DROP FUNCTION list_stuck_refunds(interval);

-- =============================================
-- LIST STUCK REFUNDS (#497)
-- Every refund, across all tournaments, that is still owed and is due a re-fire
-- (refund_fire_due): never fired, fired p_min_age ago with no answer, or failed
-- since it was fired. What the admin "Stuck refunds" page lists and the admin
-- dashboard counts. Oldest request first.
--
-- A never-fired refund counts only once it was queued p_min_age ago. The refund
-- sweep (#496), not the approval, sends a new cancellation's refunds, so every
-- refund starts out unfired; listing them straight away would raise the
-- dashboard's stuck banner on every approval. One still unfired after
-- p_min_age is one the sweep didn't get to, and that is worth a look. The list
-- stays a subset of what claim_refund_fire accepts, so a Retry on it still works.
--
-- original_chip_purchase_id is NULL when the registration payment has no CHIP
-- purchase: claim_refund_fire refuses those ('no_purchase'), so the page shows
-- them as needing a hand rather than offering a retry.
-- =============================================
CREATE FUNCTION list_stuck_refunds(p_min_age interval)
RETURNS TABLE (
  refund_id                 uuid,
  registration_id           uuid,
  tournament_id             uuid,
  tournament_name           varchar(255),
  payer_name                text,
  payer_email               varchar(255),
  amount_cents              integer,
  requested_at              timestamptz,
  last_fired_at             timestamptz,
  failed_at                 timestamptz,
  original_chip_purchase_id varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rf.id, rf.registration_id, t.id, t.name,
         NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
         u.email,
         rf.refund_amount_cents, rf.requested_at, rf.last_fired_at, rf.failed_at,
         p.chip_transaction_id
  FROM refunds rf
  JOIN registrations r ON r.id = rf.registration_id
  JOIN tournaments t   ON t.id = r.tournament_id
  LEFT JOIN payments p ON p.id = r.current_payment_id
   AND p.type = 'registration'
   AND p.status = 'paid'
  LEFT JOIN payments cp ON cp.id = r.current_payment_id
  LEFT JOIN users u     ON u.id = cp.user_id
  WHERE rf.status = 'pending'
    AND rf.processed_at IS NULL
    AND rf.chip_refund_id IS NULL
    AND refund_fire_due(rf.last_fired_at, p_min_age)
    AND (rf.last_fired_at IS NOT NULL OR rf.requested_at <= now() - p_min_age)
  ORDER BY rf.requested_at, rf.id;
$$;

REVOKE EXECUTE ON FUNCTION list_stuck_refunds FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_stuck_refunds TO service_role;
