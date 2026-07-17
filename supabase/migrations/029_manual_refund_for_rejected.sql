-- 거절 건도 관리자가 직접 「환불 완료」를 눌러야 환불완료 처리
CREATE OR REPLACE FUNCTION admin_mark_refund_completed(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  UPDATE applicants
  SET status = 'refunded'
  WHERE id = p_id
    AND deleted_at IS NULL
    AND status IN ('rejected', 'refund_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_mark_refund_completed(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
