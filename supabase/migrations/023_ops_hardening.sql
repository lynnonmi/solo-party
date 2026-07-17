-- 운영 하드닝:
-- 1) SMS 로그 + idempotency
-- 2) soft delete (deleted_at)
-- 3) 다중기기 세션 (applicant_sessions)

-- ═══════════════════════════════════════════════════════════════
-- Soft delete
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applicants_deleted_at
  ON applicants (deleted_at)
  WHERE deleted_at IS NULL;

-- 활성 연락처 유니크: 삭제된 행은 재신청 허용 (중복 있으면 스킵)
DROP INDEX IF EXISTS idx_applicants_active_contact;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT normalize_contact(contact) AS c
      FROM applicants
      WHERE status IN ('pending', 'approved', 'refund_requested')
        AND deleted_at IS NULL
      GROUP BY 1
      HAVING count(*) > 1
    ) d
  ) THEN
    CREATE UNIQUE INDEX idx_applicants_active_contact
      ON applicants (normalize_contact(contact))
      WHERE status IN ('pending', 'approved', 'refund_requested')
        AND deleted_at IS NULL;
  ELSE
    RAISE NOTICE 'skip idx_applicants_active_contact — active duplicate contacts exist';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- Multi-device sessions
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS applicant_sessions (
  token         text        PRIMARY KEY,
  applicant_id  uuid        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicant_sessions_applicant
  ON applicant_sessions (applicant_id);

-- 기존 단일 토큰 이관
INSERT INTO applicant_sessions (token, applicant_id)
SELECT session_token, id
FROM applicants
WHERE session_token IS NOT NULL
  AND deleted_at IS NULL
ON CONFLICT (token) DO NOTHING;

CREATE OR REPLACE FUNCTION clear_applicant_sessions(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM applicant_sessions WHERE applicant_id = p_id;
  UPDATE applicants SET session_token = NULL WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_voter_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id
  FROM applicant_sessions s
  JOIN applicants a ON a.id = s.applicant_id
  WHERE s.token = get_session_token()
    AND s.expires_at > now()
    AND a.status = 'approved'
    AND a.deleted_at IS NULL
  LIMIT 1;
$$;

-- 세션 만료 연장(읽기 시)
CREATE OR REPLACE FUNCTION touch_applicant_session()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE applicant_sessions
  SET last_seen_at = now(),
      expires_at = greatest(expires_at, now() + interval '30 days')
  WHERE token = get_session_token();
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- SMS idempotency logs
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sms_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id        uuid NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('approve', 'reject')),
  idempotency_key     text NOT NULL UNIQUE,
  provider_message_id text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_applicant
  ON sms_logs (applicant_id, created_at DESC);

-- claim: 이미 sent면 already_sent / 없으면 pending insert
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
  IF v_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'sms not allowed';
  END IF;

  SELECT * INTO v_existing
  FROM sms_logs
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status = 'sent' THEN
      RETURN QUERY SELECT 'already_sent'::text, v_existing.id, v_existing.provider_message_id;
      RETURN;
    END IF;
    IF v_existing.status = 'pending' THEN
      -- Provider 전송 성공 후 로그 완료만 실패했을 수 있으므로 자동 재전송 금지.
      RETURN QUERY SELECT 'uncertain'::text, v_existing.id, v_existing.provider_message_id;
      RETURN;
    END IF;
    -- Provider가 명확히 실패한 경우에만 같은 키 재시도 허용.
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
  RETURNING sms_logs.id INTO v_new_id;

  RETURN QUERY SELECT 'claimed'::text, v_new_id, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION admin_finish_sms_send(
  p_idempotency_key text,
  p_success boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_log sms_logs%ROWTYPE;
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM set_config('row_security', 'off', true);

  SELECT * INTO v_log FROM sms_logs WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;

  IF p_success THEN
    UPDATE sms_logs
    SET status = 'sent',
        provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        error_message = NULL,
        updated_at = now()
    WHERE id = v_log.id;

    UPDATE applicants
    SET sms_sent = true
    WHERE id = v_log.applicant_id;
  ELSE
    UPDATE sms_logs
    SET status = 'failed',
        error_message = left(coalesce(p_error_message, 'failed'), 500),
        updated_at = now()
    WHERE id = v_log.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_sms_logs(p_applicant_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  idempotency_key text,
  provider_message_id text,
  status text,
  error_message text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  SELECT l.id, l.kind, l.idempotency_key, l.provider_message_id, l.status, l.error_message, l.created_at
  FROM sms_logs l
  WHERE l.applicant_id = p_applicant_id
  ORDER BY l.created_at DESC
  LIMIT 20;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Soft delete (투표/매칭 정리 + 세션 무효, 행은 유지)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_delete_applicant(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM set_config('row_security', 'off', true);

  UPDATE applicants
  SET deleted_at = now(),
      session_token = NULL
  WHERE id = p_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;

  DELETE FROM applicant_sessions WHERE applicant_id = p_id;
  DELETE FROM vote_votes WHERE voter_id = p_id OR voted_for_id = p_id;
  DELETE FROM vote_submissions WHERE voter_id = p_id;
  DELETE FROM matches WHERE user1_id = p_id OR user2_id = p_id;
END;
$$;

-- 목록에서 삭제분 제외
CREATE OR REPLACE FUNCTION admin_list_applicants()
RETURNS SETOF applicants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  SELECT * FROM applicants
  WHERE deleted_at IS NULL
  ORDER BY submitted_at DESC;
END;
$$;

DROP VIEW IF EXISTS approved_for_voting;
CREATE VIEW approved_for_voting AS
SELECT
  id,
  nickname,
  gender,
  vote_profile_photo
FROM applicants
WHERE status = 'approved'
  AND deleted_at IS NULL;

GRANT SELECT ON approved_for_voting TO anon, authenticated;

-- 거절/환불 시 다중 세션도 정리
CREATE OR REPLACE FUNCTION request_refund()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_deadline timestamptz := timestamptz '2026-08-09 17:00:00+09' - interval '7 days';
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF now() >= v_deadline THEN RAISE EXCEPTION 'refund deadline passed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM applicants WHERE id = v_id AND status = 'approved' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'refund not allowed';
  END IF;

  PERFORM set_config('row_security', 'off', true);
  UPDATE applicants SET status = 'refund_requested', session_token = NULL WHERE id = v_id;
  PERFORM clear_applicant_sessions(v_id);
  DELETE FROM vote_votes WHERE voter_id = v_id OR voted_for_id = v_id;
  DELETE FROM vote_submissions WHERE voter_id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION request_refund_by_identity(p_name text, p_contact text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_deadline timestamptz := timestamptz '2026-08-09 17:00:00+09' - interval '7 days';
BEGIN
  IF now() >= v_deadline THEN RAISE EXCEPTION 'refund deadline passed'; END IF;

  SELECT a.id INTO v_id
  FROM applicants a
  WHERE trim(a.name) = trim(p_name)
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
    AND a.deleted_at IS NULL
  ORDER BY a.submitted_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;

  PERFORM set_config('row_security', 'off', true);
  UPDATE applicants SET status = 'refund_requested', session_token = NULL WHERE id = v_id;
  PERFORM clear_applicant_sessions(v_id);
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

  IF p_status = 'rejected' THEN
    UPDATE applicants
    SET status = 'rejected', session_token = NULL
    WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
    PERFORM clear_applicant_sessions(p_id);
    DELETE FROM vote_votes WHERE voter_id = p_id OR voted_for_id = p_id;
    DELETE FROM vote_submissions WHERE voter_id = p_id;
    DELETE FROM matches WHERE user1_id = p_id OR user2_id = p_id;
    RETURN;
  END IF;

  UPDATE applicants SET status = p_status WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- verify_applicant: 새 세션 추가 (기존 기기 유지)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS verify_applicant(text, text);

CREATE OR REPLACE FUNCTION verify_applicant(p_name text, p_contact text)
RETURNS TABLE (
  id uuid, name text, gender text, age integer, nickname text, mbti text,
  contact text, job text, job_detail text, current_work text, life_goal text,
  alone_time text, instagram text, ideal_type text, charm text, celebrity text,
  photos text[], photo_thumbs text[], vote_profile_photo text,
  refund_bank text, refund_account text,
  status text, submitted_at timestamptz, session_token text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_token text;
  v_count int;
BEGIN
  SELECT count(*)::int INTO v_count
  FROM applicants a
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
    AND a.deleted_at IS NULL;

  IF v_count = 0 THEN RETURN; END IF;
  IF v_count > 1 THEN RAISE EXCEPTION 'ambiguous applicant'; END IF;

  SELECT a.id INTO v_id
  FROM applicants a
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
    AND a.deleted_at IS NULL
  LIMIT 1;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO applicant_sessions (token, applicant_id)
  VALUES (v_token, v_id);

  -- 기기 수 제한: 최근 5개만 유지
  DELETE FROM applicant_sessions
  WHERE applicant_id = v_id
    AND token NOT IN (
      SELECT s.token FROM applicant_sessions s
      WHERE s.applicant_id = v_id
      ORDER BY s.created_at DESC
      LIMIT 5
    );

  -- 하위 호환: 최신 토큰도 applicants에 기록
  UPDATE applicants SET session_token = v_token WHERE applicants.id = v_id;

  RETURN QUERY
  SELECT
    a.id, a.name, a.gender, a.age, a.nickname, a.mbti, a.contact, a.job,
    a.job_detail, a.current_work, a.life_goal, a.alone_time, a.instagram,
    a.ideal_type, a.charm, a.celebrity, a.photos, a.photo_thumbs, a.vote_profile_photo,
    a.refund_bank, a.refund_account, a.status, a.submitted_at, v_token
  FROM applicants a WHERE a.id = v_id;
END;
$$;

-- submit_application: 삭제분 제외한 중복 검사
CREATE OR REPLACE FUNCTION submit_application(
  p_name text,
  p_gender text,
  p_age integer,
  p_nickname text,
  p_mbti text,
  p_contact text,
  p_job text,
  p_job_detail text,
  p_current_work text,
  p_life_goal text,
  p_alone_time text,
  p_instagram text,
  p_ideal_type text,
  p_charm text,
  p_celebrity text,
  p_photos text[],
  p_photo_thumbs text[],
  p_refund_bank text,
  p_refund_account text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact text;
  v_id uuid;
  v_male_open boolean;
  v_female_open boolean;
  v_thumbs text[];
BEGIN
  IF p_gender NOT IN ('남성', '여성') THEN RAISE EXCEPTION 'invalid gender'; END IF;
  IF p_photos IS NULL OR cardinality(p_photos) < 1 THEN RAISE EXCEPTION 'photos required'; END IF;

  v_thumbs := coalesce(p_photo_thumbs, '{}');
  IF cardinality(v_thumbs) > 0 AND cardinality(v_thumbs) <> cardinality(p_photos) THEN
    RAISE EXCEPTION 'photo thumbs mismatch';
  END IF;

  v_contact := normalize_contact(p_contact);
  IF v_contact IS NULL OR length(v_contact) < 10 THEN RAISE EXCEPTION 'invalid contact'; END IF;

  SELECT male_open, female_open INTO v_male_open, v_female_open FROM vote_settings WHERE id = 1;
  IF p_gender = '남성' AND NOT coalesce(v_male_open, false) THEN RAISE EXCEPTION 'male applications closed'; END IF;
  IF p_gender = '여성' AND NOT coalesce(v_female_open, false) THEN RAISE EXCEPTION 'female applications closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM applicants
    WHERE normalize_contact(contact) = v_contact
      AND status IN ('pending', 'approved', 'refund_requested')
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'duplicate contact';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO applicants (
    name, gender, age, nickname, mbti, contact, job, job_detail,
    current_work, life_goal, alone_time, instagram, ideal_type, charm, celebrity,
    photos, photo_thumbs, refund_bank, refund_account, status, fee_confirmed
  ) VALUES (
    trim(p_name), p_gender, p_age, trim(p_nickname), p_mbti, v_contact,
    p_job, NULLIF(trim(coalesce(p_job_detail, '')), ''),
    trim(p_current_work), trim(p_life_goal), trim(p_alone_time), trim(p_instagram),
    trim(p_ideal_type), trim(p_charm), trim(p_celebrity),
    p_photos, v_thumbs, trim(p_refund_bank), trim(p_refund_account),
    'pending', false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION clear_applicant_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_claim_sms_send(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_finish_sms_send(text, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_sms_logs(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_applicant(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_applicants() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_refund() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_refund_by_identity(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_status(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_application(
  text, text, integer, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text, text
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_get_applicant_for_sms(p_id uuid)
RETURNS TABLE (id uuid, contact text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT a.id, a.contact::text, a.status::text
  FROM applicants a
  WHERE a.id = p_id
    AND a.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_applicant_for_sms(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_my_application()
RETURNS SETOF applicants
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM touch_applicant_session();
  RETURN QUERY SELECT * FROM applicants WHERE id = get_voter_id();
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_application() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION touch_applicant_session() TO anon, authenticated;
