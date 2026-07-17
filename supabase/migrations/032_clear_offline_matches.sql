-- 투표 전체 초기화에 현장 수기 오프라인 투표도 포함
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
  v_offline_matches int;
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
  SELECT count(*)::int INTO v_offline_matches FROM offline_matches;

  TRUNCATE TABLE vote_votes, vote_submissions, matches, offline_matches RESTART IDENTITY;

  IF EXISTS (SELECT 1 FROM vote_votes LIMIT 1)
     OR EXISTS (SELECT 1 FROM vote_submissions LIMIT 1)
     OR EXISTS (SELECT 1 FROM matches LIMIT 1)
     OR EXISTS (SELECT 1 FROM offline_matches LIMIT 1) THEN
    RAISE EXCEPTION 'clear failed: residual rows remain';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_votes', v_votes,
    'deleted_submissions', v_subs,
    'deleted_matches', v_matches,
    'deleted_offline_matches', v_offline_matches
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_clear_vote_data(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
