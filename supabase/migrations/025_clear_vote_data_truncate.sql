-- 투표·쪽지 전체 초기화: TRUNCATE로 확실히 비우고 삭제 건수 반환
-- 반환 타입 변경(void → jsonb)이라 DROP 후 재생성
DROP FUNCTION IF EXISTS admin_clear_vote_data(text);

CREATE OR REPLACE FUNCTION admin_clear_vote_data(p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_votes int;
  v_subs int;
  v_matches int;
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_confirm IS DISTINCT FROM 'DELETE_ALL_VOTES' THEN
    RAISE EXCEPTION 'confirmation required';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT count(*)::int INTO v_votes FROM vote_votes;
  SELECT count(*)::int INTO v_subs FROM vote_submissions;
  SELECT count(*)::int INTO v_matches FROM matches;

  -- DELETE 누락/RLS 이슈를 피하기 위해 TRUNCATE 사용
  TRUNCATE TABLE vote_votes, vote_submissions, matches RESTART IDENTITY;

  IF EXISTS (SELECT 1 FROM vote_votes LIMIT 1)
     OR EXISTS (SELECT 1 FROM vote_submissions LIMIT 1)
     OR EXISTS (SELECT 1 FROM matches LIMIT 1) THEN
    RAISE EXCEPTION 'clear failed: residual rows remain';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_votes', v_votes,
    'deleted_submissions', v_subs,
    'deleted_matches', v_matches
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_clear_vote_data(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
