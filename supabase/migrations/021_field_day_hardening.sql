-- 현장 배포 하드닝:
-- 1) 투표 마감/제출 race 직렬화
-- 2) 4표 제한 race 방지
-- 3) 환불 7일 cutoff 서버 강제
-- 4) 신청 중복 연락처 방지 + submit_application RPC
-- 5) verify_applicant 중복 승인 모호성 차단

-- ── 활성 신청 연락처 유니크 (중복 없으면 생성) ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT normalize_contact(contact) AS c
      FROM applicants
      WHERE status IN ('pending', 'approved', 'refund_requested')
      GROUP BY 1
      HAVING count(*) > 1
    ) d
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applicants_active_contact
      ON applicants (normalize_contact(contact))
      WHERE status IN ('pending', 'approved', 'refund_requested');
  END IF;
END $$;

-- ── 투표 제출: settings row lock + voter advisory lock ────────────────
CREATE OR REPLACE FUNCTION submit_single_vote(p_voted_for_id uuid, p_message text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_count int;
  v_open boolean;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- 마감/오픈과 직렬화
  PERFORM 1 FROM vote_settings WHERE id = 1 FOR UPDATE;
  SELECT (is_open AND NOT is_closed) INTO v_open FROM vote_settings WHERE id = 1;
  IF NOT coalesce(v_open, false) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

  -- 동일 참가자 동시 제출 직렬화 (4표 race 방지)
  PERFORM pg_advisory_xact_lock(872001, hashtext(v_id::text));

  IF p_voted_for_id IS NULL OR p_voted_for_id = v_id THEN
    RAISE EXCEPTION 'invalid target';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM applicants v
    JOIN applicants t ON t.id = p_voted_for_id
    WHERE v.id = v_id AND t.status = 'approved' AND v.gender <> t.gender
  ) THEN
    RAISE EXCEPTION 'invalid target';
  END IF;

  IF char_length(trim(coalesce(p_message, ''))) = 0 THEN
    RAISE EXCEPTION 'message required';
  END IF;

  IF char_length(p_message) > 200 THEN
    RAISE EXCEPTION 'message too long';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM vote_votes WHERE voter_id = v_id;

  IF v_count >= 4 AND NOT EXISTS (
    SELECT 1 FROM vote_votes WHERE voter_id = v_id AND voted_for_id = p_voted_for_id
  ) THEN
    RAISE EXCEPTION 'max 4 votes';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO vote_votes (voter_id, voted_for_id, message)
  VALUES (v_id, p_voted_for_id, trim(p_message))
  ON CONFLICT (voter_id, voted_for_id) DO UPDATE
  SET message = EXCLUDED.message,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION remove_single_vote(p_voted_for_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_open boolean;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  PERFORM 1 FROM vote_settings WHERE id = 1 FOR UPDATE;
  SELECT (is_open AND NOT is_closed) INTO v_open FROM vote_settings WHERE id = 1;
  IF NOT coalesce(v_open, false) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

  PERFORM pg_advisory_xact_lock(872001, hashtext(v_id::text));
  PERFORM set_config('row_security', 'off', true);

  DELETE FROM vote_votes
  WHERE voter_id = v_id AND voted_for_id = p_voted_for_id;
END;
$$;

-- ── 마감: 먼저 close 잠금 → 그다음 매칭 계산 ──────────────────────────
CREATE OR REPLACE FUNCTION admin_toggle_vote_closed(p_closed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  -- submit_single_vote 와 동일 row lock 으로 직렬화
  PERFORM 1 FROM vote_settings WHERE id = 1 FOR UPDATE;

  IF p_closed THEN
    -- 먼저 마감 표시 → 대기 중인 submit 은 lock 해제 후 실패
    UPDATE vote_settings
    SET is_open = false, is_closed = true, closed_at = now()
    WHERE id = 1;

    DELETE FROM matches WHERE true;

    INSERT INTO matches (user1_id, user2_id)
    SELECT DISTINCT
      CASE WHEN v1.voter_id < v1.voted_for_id THEN v1.voter_id ELSE v1.voted_for_id END,
      CASE WHEN v1.voter_id < v1.voted_for_id THEN v1.voted_for_id ELSE v1.voter_id END
    FROM vote_votes v1
    INNER JOIN vote_votes v2
      ON v1.voter_id = v2.voted_for_id
      AND v1.voted_for_id = v2.voter_id
    WHERE v1.voter_id <> v1.voted_for_id
    ON CONFLICT (user1_id, user2_id) DO NOTHING;
  ELSE
    -- 마감 취소: 투표 데이터는 유지
    DELETE FROM matches WHERE true;
    UPDATE vote_settings
    SET is_closed = false, closed_at = NULL
    WHERE id = 1;
  END IF;
END;
$$;

-- ── 환불: 행사 7일 전까지만 (EVENT 2026-08-09 17:00 KST) ─────────────
CREATE OR REPLACE FUNCTION request_refund()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_deadline timestamptz := timestamptz '2026-08-09 17:00:00+09' - interval '7 days';
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF now() >= v_deadline THEN
    RAISE EXCEPTION 'refund deadline passed';
  END IF;

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
  v_deadline timestamptz := timestamptz '2026-08-09 17:00:00+09' - interval '7 days';
BEGIN
  IF now() >= v_deadline THEN
    RAISE EXCEPTION 'refund deadline passed';
  END IF;

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

-- ── 신청 제출 RPC (연락처 중복 + 성별 마감 서버 검사) ─────────────────
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
BEGIN
  IF p_gender NOT IN ('남성', '여성') THEN
    RAISE EXCEPTION 'invalid gender';
  END IF;

  IF p_photos IS NULL OR cardinality(p_photos) < 1 THEN
    RAISE EXCEPTION 'photos required';
  END IF;

  v_contact := normalize_contact(p_contact);
  IF v_contact IS NULL OR length(v_contact) < 10 THEN
    RAISE EXCEPTION 'invalid contact';
  END IF;

  SELECT male_open, female_open INTO v_male_open, v_female_open
  FROM vote_settings WHERE id = 1;

  IF p_gender = '남성' AND NOT coalesce(v_male_open, false) THEN
    RAISE EXCEPTION 'male applications closed';
  END IF;
  IF p_gender = '여성' AND NOT coalesce(v_female_open, false) THEN
    RAISE EXCEPTION 'female applications closed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM applicants
    WHERE normalize_contact(contact) = v_contact
      AND status IN ('pending', 'approved', 'refund_requested')
  ) THEN
    RAISE EXCEPTION 'duplicate contact';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO applicants (
    name, gender, age, nickname, mbti, contact, job, job_detail,
    current_work, life_goal, alone_time, instagram, ideal_type, charm, celebrity,
    photos, refund_bank, refund_account, status, fee_confirmed
  ) VALUES (
    trim(p_name), p_gender, p_age, trim(p_nickname), p_mbti, v_contact,
    p_job, NULLIF(trim(coalesce(p_job_detail, '')), ''),
    trim(p_current_work), trim(p_life_goal), trim(p_alone_time), trim(p_instagram),
    trim(p_ideal_type), trim(p_charm), trim(p_celebrity),
    p_photos, trim(p_refund_bank), trim(p_refund_account),
    'pending', false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_application(
  text, text, integer, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text, text
) TO anon, authenticated;

-- ── 로그인: 동일 이름+연락처 승인 중복 시 모호성 에러 ─────────────────
CREATE OR REPLACE FUNCTION verify_applicant(p_name text, p_contact text)
RETURNS TABLE (
  id uuid, name text, gender text, age integer, nickname text, mbti text,
  contact text, job text, job_detail text, current_work text, life_goal text,
  alone_time text, instagram text, ideal_type text, charm text, celebrity text,
  photos text[], vote_profile_photo text, refund_bank text, refund_account text,
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
    AND a.status = 'approved';

  IF v_count = 0 THEN
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'ambiguous applicant';
  END IF;

  SELECT a.id INTO v_id
  FROM applicants a
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
  LIMIT 1;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE applicants SET session_token = v_token WHERE applicants.id = v_id;

  RETURN QUERY
  SELECT
    a.id, a.name, a.gender, a.age, a.nickname, a.mbti, a.contact, a.job,
    a.job_detail, a.current_work, a.life_goal, a.alone_time, a.instagram,
    a.ideal_type, a.charm, a.celebrity, a.photos, a.vote_profile_photo,
    a.refund_bank, a.refund_account, a.status, a.submitted_at, v_token
  FROM applicants a WHERE a.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_single_vote(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_single_vote(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_vote_closed(boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_refund() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION request_refund_by_identity(text, text) TO anon, authenticated;
