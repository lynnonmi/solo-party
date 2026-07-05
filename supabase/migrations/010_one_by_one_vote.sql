-- 한 명씩 투표 + 쪽지

CREATE TABLE IF NOT EXISTS vote_votes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id      uuid        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  voted_for_id  uuid        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  message       text        NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voter_id, voted_for_id)
);

INSERT INTO vote_votes (voter_id, voted_for_id, message)
SELECT s.voter_id, uid, ''
FROM vote_submissions s
CROSS JOIN LATERAL unnest(s.voted_for_ids) AS uid
WHERE uid IS NOT NULL
ON CONFLICT (voter_id, voted_for_id) DO NOTHING;

CREATE OR REPLACE FUNCTION get_my_votes()
RETURNS TABLE (voted_for_id uuid, message text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vv.voted_for_id, vv.message, vv.created_at
  FROM vote_votes vv
  WHERE vv.voter_id = get_voter_id()
  ORDER BY vv.created_at;
$$;

CREATE OR REPLACE FUNCTION get_my_submission()
RETURNS TABLE (voted_for_ids uuid[], submitted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    coalesce(array_agg(vv.voted_for_id ORDER BY vv.created_at), '{}'),
    max(vv.created_at)
  FROM vote_votes vv
  WHERE vv.voter_id = get_voter_id();
$$;

CREATE OR REPLACE FUNCTION submit_single_vote(p_voted_for_id uuid, p_message text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_count int;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vote_settings WHERE id = 1 AND is_open AND NOT is_closed
  ) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

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
DECLARE v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vote_settings WHERE id = 1 AND is_open AND NOT is_closed
  ) THEN
    RAISE EXCEPTION 'vote not open';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  DELETE FROM vote_votes
  WHERE voter_id = v_id AND voted_for_id = p_voted_for_id;
END;
$$;

DROP FUNCTION IF EXISTS admin_get_vote_results();

CREATE OR REPLACE FUNCTION admin_get_vote_results()
RETURNS TABLE (voter_id uuid, voted_for_id uuid, message text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vv.voter_id, vv.voted_for_id, vv.message, vv.created_at
  FROM vote_votes vv
  WHERE verify_admin_token()
  ORDER BY vv.created_at DESC;
$$;

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
    PERFORM set_config('row_security', 'off', true);
    DELETE FROM vote_votes WHERE true;
    DELETE FROM vote_submissions WHERE true;
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

  DELETE FROM matches WHERE true;

  IF p_closed THEN
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
    DELETE FROM vote_votes WHERE true;
    DELETE FROM vote_submissions WHERE true;
    UPDATE vote_settings
    SET is_closed = false, closed_at = NULL
    WHERE id = 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_votes() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_single_vote(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_single_vote(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_vote_results() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_vote_open(boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_vote_closed(boolean) TO anon, authenticated;
