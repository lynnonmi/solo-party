-- 세션 없이 get_my_votes / get_votes_for_me 가 빈 배열을 "성공"으로 돌려
-- 클라이언트에서 기존 투표를 지워버리던 문제를 막습니다.

CREATE OR REPLACE FUNCTION get_my_votes()
RETURNS TABLE (voted_for_id uuid, message text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT vv.voted_for_id, vv.message, vv.created_at
  FROM vote_votes vv
  WHERE vv.voter_id = v_id
  ORDER BY vv.created_at;
END;
$$;

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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vote_settings WHERE id = 1 AND is_closed
  ) THEN
    RAISE EXCEPTION 'vote not closed';
  END IF;

  RETURN QUERY
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
  WHERE vv.voted_for_id = v_id
    AND a.status = 'approved'
    AND a.deleted_at IS NULL
  ORDER BY vv.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_votes() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_votes_for_me() TO anon, authenticated;
