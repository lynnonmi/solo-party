-- 케이스1: 승인 후 본인 환불 요청만 허용
-- 케이스2: 거절 시 투표·세션 정리 (거절 = 전액 환불 처리)

CREATE OR REPLACE FUNCTION request_refund()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- 승인된 참가자만 이후 환불 요청 가능
  IF NOT EXISTS (
    SELECT 1 FROM applicants
    WHERE id = v_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'refund not allowed';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  UPDATE applicants
  SET status = 'refund_requested',
      session_token = NULL
  WHERE id = v_id;

  DELETE FROM vote_votes WHERE voter_id = v_id OR voted_for_id = v_id;
  DELETE FROM vote_submissions WHERE voter_id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION request_refund_by_identity(p_name text, p_contact text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
  FROM applicants a
  WHERE trim(a.name) = trim(p_name)
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
  ORDER BY a.submitted_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'not found';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  UPDATE applicants
  SET status = 'refund_requested',
      session_token = NULL
  WHERE id = v_id;

  DELETE FROM vote_votes WHERE voter_id = v_id OR voted_for_id = v_id;
  DELETE FROM vote_submissions WHERE voter_id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_update_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'refund_requested', 'refunded') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  -- 거절 = 전액 환불 처리: 상태 rejected 유지 + 세션/투표 정리
  IF p_status = 'rejected' THEN
    UPDATE applicants
    SET status = 'rejected',
        session_token = NULL
    WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not found';
    END IF;
    DELETE FROM vote_votes WHERE voter_id = p_id OR voted_for_id = p_id;
    DELETE FROM vote_submissions WHERE voter_id = p_id;
    RETURN;
  END IF;

  UPDATE applicants SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;
