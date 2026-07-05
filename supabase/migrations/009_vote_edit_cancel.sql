-- 투표 마감 전 수정·취소 허용

CREATE OR REPLACE FUNCTION submit_vote(p_voted_for_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vote_settings WHERE id = 1 AND is_open AND NOT is_closed
  ) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

  IF coalesce(array_length(p_voted_for_ids, 1), 0) > 4 THEN
    RAISE EXCEPTION 'max 4 votes';
  END IF;

  INSERT INTO vote_submissions (voter_id, voted_for_ids)
  VALUES (v_id, coalesce(p_voted_for_ids, '{}'))
  ON CONFLICT (voter_id) DO UPDATE
  SET voted_for_ids = EXCLUDED.voted_for_ids,
      submitted_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION cancel_vote()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vote_settings WHERE id = 1 AND is_open AND NOT is_closed
  ) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

  DELETE FROM vote_submissions WHERE voter_id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_vote(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_vote() TO anon, authenticated;
