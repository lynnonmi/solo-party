-- 환불 요청 / 환불 완료 상태 (거절과 분리)

ALTER TABLE applicants DROP CONSTRAINT IF EXISTS applicants_status_check;

ALTER TABLE applicants
  ADD CONSTRAINT applicants_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'refund_requested',
    'refunded'
  ));

CREATE OR REPLACE FUNCTION admin_update_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'refund_requested', 'refunded') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  UPDATE applicants SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

-- 로그인된 참가자 환불 요청
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

  IF NOT EXISTS (
    SELECT 1 FROM applicants
    WHERE id = v_id AND status IN ('pending', 'approved')
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

-- 이름+연락처로 환불 요청 (미로그인 pending/approved)
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
    AND a.status IN ('pending', 'approved')
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

CREATE OR REPLACE FUNCTION admin_mark_refund_completed(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE applicants
  SET status = 'refunded'
  WHERE id = p_id AND status = 'refund_requested';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION request_refund() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_refund_by_identity(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_refund_completed(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_status(uuid, text) TO anon, authenticated;
