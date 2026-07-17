-- 상태 변경 시 문자 발송 여부 초기화 (승인↔거절 전환 시 새 문자 유도)
CREATE OR REPLACE FUNCTION admin_update_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'refund_requested', 'refunded') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT status INTO v_prev FROM applicants WHERE id = p_id AND deleted_at IS NULL;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'not found'; END IF;

  IF p_status = 'rejected' THEN
    UPDATE applicants
    SET status = 'rejected',
        session_token = NULL,
        sms_sent = CASE WHEN v_prev IS DISTINCT FROM 'rejected' THEN false ELSE sms_sent END
    WHERE id = p_id AND deleted_at IS NULL;
    PERFORM clear_applicant_sessions(p_id);
    DELETE FROM vote_votes WHERE voter_id = p_id OR voted_for_id = p_id;
    DELETE FROM vote_submissions WHERE voter_id = p_id;
    DELETE FROM matches WHERE user1_id = p_id OR user2_id = p_id;
    RETURN;
  END IF;

  UPDATE applicants
  SET status = p_status,
      sms_sent = CASE WHEN v_prev IS DISTINCT FROM p_status THEN false ELSE sms_sent END
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_status(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
