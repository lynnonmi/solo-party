-- 023 운영 하드닝 후속 안전 수정
-- 1) SMS pending 상태는 전송 결과 불명으로 보고 자동 재전송 차단
-- 2) 내부 세션 삭제 함수 외부 실행 차단
-- 3) 세션 touch가 가능한 VOLATILE get_my_application
-- 4) 24시간 이상 된 Storage orphan 후보 조회

CREATE OR REPLACE FUNCTION admin_claim_sms_send(
  p_applicant_id uuid,
  p_kind text,
  p_idempotency_key text
)
RETURNS TABLE (
  result text,
  log_id uuid,
  provider_message_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing sms_logs%ROWTYPE;
  v_status text;
  v_new_id uuid;
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_kind NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'invalid kind'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT status INTO v_status
  FROM applicants
  WHERE id = p_applicant_id AND deleted_at IS NULL;

  IF v_status IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF v_status NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'sms not allowed'; END IF;

  SELECT * INTO v_existing
  FROM sms_logs
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'sent' THEN
      RETURN QUERY SELECT 'already_sent'::text, v_existing.id, v_existing.provider_message_id;
      RETURN;
    END IF;
    IF v_existing.status = 'pending' THEN
      RETURN QUERY SELECT 'uncertain'::text, v_existing.id, v_existing.provider_message_id;
      RETURN;
    END IF;

    UPDATE sms_logs
    SET status = 'pending',
        error_message = NULL,
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN QUERY SELECT 'claimed'::text, v_existing.id, v_existing.provider_message_id;
    RETURN;
  END IF;

  INSERT INTO sms_logs (applicant_id, kind, idempotency_key, status)
  VALUES (p_applicant_id, p_kind, p_idempotency_key, 'pending')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    SELECT * INTO v_existing
    FROM sms_logs
    WHERE idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT
      CASE
        WHEN v_existing.status = 'sent' THEN 'already_sent'::text
        ELSE 'uncertain'::text
      END,
      v_existing.id,
      v_existing.provider_message_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'claimed'::text, v_new_id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION clear_applicant_sessions(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION get_my_application()
RETURNS SETOF applicants
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE applicant_sessions
  SET last_seen_at = now(),
      expires_at = greatest(expires_at, now() + interval '30 days')
  WHERE token = get_session_token()
    AND applicant_id = v_id;

  RETURN QUERY
  SELECT * FROM applicants
  WHERE id = v_id AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_orphan_storage_objects(
  p_older_than interval DEFAULT interval '24 hours'
)
RETURNS TABLE (object_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  RETURN QUERY
  SELECT o.name::text
  FROM storage.objects o
  WHERE o.bucket_id = 'applicants'
    AND o.created_at < now() - greatest(p_older_than, interval '1 hour')
    AND NOT EXISTS (
      SELECT 1
      FROM applicants a
      WHERE EXISTS (
        SELECT 1
        FROM unnest(coalesce(a.photos, '{}') || coalesce(a.photo_thumbs, '{}')) AS u(url)
        WHERE u.url LIKE '%/' || o.name
      )
    )
  ORDER BY o.created_at
  LIMIT 500;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_claim_sms_send(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_my_application() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_orphan_storage_objects(interval) TO anon, authenticated;
