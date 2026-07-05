-- 투표 마감/매칭 계산 토글 (베타 테스트용 재오픈 지원)

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

  DELETE FROM matches WHERE true;

  IF p_closed THEN
    INSERT INTO matches (user1_id, user2_id)
    SELECT DISTINCT
      CASE WHEN s1.voter_id < u.voted_id THEN s1.voter_id ELSE u.voted_id END,
      CASE WHEN s1.voter_id < u.voted_id THEN u.voted_id ELSE s1.voter_id END
    FROM vote_submissions s1
    CROSS JOIN LATERAL unnest(s1.voted_for_ids) AS u(voted_id)
    INNER JOIN vote_submissions s2 ON s2.voter_id = u.voted_id
    WHERE s1.voter_id = ANY(s2.voted_for_ids)
      AND s1.voter_id <> u.voted_id
    ON CONFLICT (user1_id, user2_id) DO NOTHING;

    UPDATE vote_settings
    SET is_open = false, is_closed = true, closed_at = now()
    WHERE id = 1;
  ELSE
    DELETE FROM vote_submissions WHERE true;
    UPDATE vote_settings
    SET is_closed = false, closed_at = NULL
    WHERE id = 1;
  END IF;
END;
$$;

-- 기존 close 함수도 토글로 연결
CREATE OR REPLACE FUNCTION admin_close_voting()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM admin_toggle_vote_closed(true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_vote_closed(boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_close_voting() TO anon, authenticated;
