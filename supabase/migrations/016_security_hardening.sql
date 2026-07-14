-- 보안 하드닝: vote_votes RLS, 죽은 RPC 회수, 투표 삭제 분리, 결과 게이트, 뷰/스토리지/신청 정책

-- ── C1: vote_votes 직접 REST 접근 차단 ─────────────────────────────────
ALTER TABLE vote_votes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE vote_votes FROM anon, authenticated;
REVOKE ALL ON TABLE vote_votes FROM PUBLIC;

-- 정책 없이도 SECURITY DEFINER RPC는 테이블 소유자로 동작
DROP POLICY IF EXISTS vote_votes_deny_all ON vote_votes;

-- _app_migrations 가 있으면 경우 anon 접근 차단
DO $$
BEGIN
  IF to_regclass('public._app_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE _app_migrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE _app_migrations FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON TABLE _app_migrations FROM PUBLIC';
  END IF;
END $$;

-- ── 죽은 RPC 권한 회수 (009 submit_vote / cancel_vote) ─────────────────
DO $$
BEGIN
  REVOKE ALL ON FUNCTION submit_vote(uuid[]) FROM anon, authenticated, PUBLIC;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION cancel_vote() FROM anon, authenticated, PUBLIC;
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

-- ── C3: 토글에서 투표 삭제 제거 + 별도 초기화 RPC ───────────────────────
CREATE OR REPLACE FUNCTION admin_toggle_vote_open(p_open boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_open THEN
    IF EXISTS (SELECT 1 FROM vote_settings WHERE id = 1 AND is_closed) THEN
      RAISE EXCEPTION 'vote already closed';
    END IF;
    UPDATE vote_settings SET is_open = true WHERE id = 1;
  ELSE
    UPDATE vote_settings SET is_open = false WHERE id = 1;
  END IF;
END;
$$;

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

  IF p_closed THEN
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

    UPDATE vote_settings
    SET is_open = false, is_closed = true, closed_at = now()
    WHERE id = 1;
  ELSE
    -- 마감 취소: 투표 데이터는 유지 (삭제는 admin_clear_vote_data)
    DELETE FROM matches WHERE true;
    UPDATE vote_settings
    SET is_closed = false, closed_at = NULL
    WHERE id = 1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_clear_vote_data(p_confirm text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_confirm IS DISTINCT FROM 'DELETE_ALL_VOTES' THEN
    RAISE EXCEPTION 'confirmation required';
  END IF;

  PERFORM set_config('row_security', 'off', true);
  DELETE FROM vote_votes WHERE true;
  DELETE FROM vote_submissions WHERE true;
  DELETE FROM matches WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_clear_vote_data(text) TO anon, authenticated;

-- ── H1: 마감 후에만 받은 투표/쪽지 조회 ────────────────────────────────
CREATE OR REPLACE FUNCTION get_votes_for_me()
RETURNS TABLE (
  voter_id uuid,
  nickname text,
  gender text,
  age integer,
  mbti text,
  job text,
  job_detail text,
  current_work text,
  life_goal text,
  alone_time text,
  instagram text,
  ideal_type text,
  charm text,
  celebrity text,
  vote_profile_photo text,
  photos text[],
  message text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id,
    a.nickname,
    a.gender,
    a.age,
    a.mbti,
    a.job,
    a.job_detail,
    a.current_work,
    a.life_goal,
    a.alone_time,
    a.instagram,
    a.ideal_type,
    a.charm,
    a.celebrity,
    a.vote_profile_photo,
    a.photos,
    vv.message,
    vv.created_at
  FROM vote_votes vv
  JOIN applicants a ON a.id = vv.voter_id
  WHERE vv.voted_for_id = get_voter_id()
    AND get_voter_id() IS NOT NULL
    AND a.status = 'approved'
    AND EXISTS (SELECT 1 FROM vote_settings WHERE id = 1 AND is_closed)
  ORDER BY vv.created_at;
$$;

-- ── H2: 투표 후보 뷰에서 신청 사진 전체 제거 ───────────────────────────
-- CREATE OR REPLACE VIEW는 컬럼을 줄일 수 없음 → DROP 후 재생성
DROP VIEW IF EXISTS approved_for_voting;
CREATE VIEW approved_for_voting AS
SELECT
  id,
  nickname,
  gender,
  vote_profile_photo
FROM applicants
WHERE status = 'approved';

GRANT SELECT ON approved_for_voting TO anon, authenticated;

-- ── H3: Storage 업로드 제한 (5MB, 이미지 MIME) ─────────────────────────
UPDATE storage.buckets
SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'applicants';

DROP POLICY IF EXISTS applicants_storage_insert ON storage.objects;
CREATE POLICY applicants_storage_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'applicants'
    AND coalesce(storage.extension(name), '') IN ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif')
  );

-- ── 신청 INSERT: 성별 모집 마감 시 서버에서 거부 ───────────────────────
DROP POLICY IF EXISTS applicants_insert_anon ON applicants;
CREATE POLICY applicants_insert_anon ON applicants
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vote_settings vs
      WHERE vs.id = 1
        AND (
          (gender = '남성' AND vs.male_open)
          OR (gender = '여성' AND vs.female_open)
        )
    )
  );
