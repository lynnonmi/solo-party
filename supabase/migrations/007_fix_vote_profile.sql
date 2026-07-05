-- 프로필 사진 1회만 설정 + 베타 재테스트 시 투표 기록 초기화

CREATE OR REPLACE FUNCTION update_vote_profile_photo(p_photo_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM vote_settings WHERE id = 1 AND is_closed) THEN
    RAISE EXCEPTION 'vote closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM applicants
    WHERE id = v_id AND vote_profile_photo IS NOT NULL AND vote_profile_photo <> ''
  ) THEN
    RAISE EXCEPTION 'profile already set';
  END IF;
  UPDATE applicants SET vote_profile_photo = p_photo_url WHERE id = v_id;
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

GRANT EXECUTE ON FUNCTION update_vote_profile_photo(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_vote_closed(boolean) TO anon, authenticated;
