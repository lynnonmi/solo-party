-- 나에게 투표한 사람 + 쪽지 (투표 마감 후 결과 탭용)

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
  ORDER BY vv.created_at;
$$;

GRANT EXECUTE ON FUNCTION get_votes_for_me() TO anon, authenticated;
