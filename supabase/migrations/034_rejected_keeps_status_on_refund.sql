-- 거절 후 환불 완료는 status=rejected 유지 + refund_completed=true
-- (승인 후 본인 환불요청 → 완료는 기존처럼 status=refunded)

ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS refund_completed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION admin_mark_refund_completed(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT status INTO v_status
  FROM applicants
  WHERE id = p_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'not found';
  END IF;

  IF v_status = 'rejected' THEN
    UPDATE applicants
    SET refund_completed = true
    WHERE id = p_id;
  ELSIF v_status = 'refund_requested' THEN
    UPDATE applicants
    SET status = 'refunded',
        refund_completed = true
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_mark_refund_completed(uuid) TO anon, authenticated;

-- 기존: 거절 SMS가 있는 refunded → 거절 + 환불완료로 복원
UPDATE applicants a
SET status = 'rejected',
    refund_completed = true
WHERE a.deleted_at IS NULL
  AND a.status = 'refunded'
  AND EXISTS (
    SELECT 1
    FROM sms_logs s
    WHERE s.applicant_id = a.id
      AND s.kind = 'reject'
  );

-- 나머지 refunded(본인 환불요청 완료)는 플래그만 맞춤
UPDATE applicants
SET refund_completed = true
WHERE deleted_at IS NULL
  AND status = 'refunded'
  AND refund_completed = false;

NOTIFY pgrst, 'reload schema';
