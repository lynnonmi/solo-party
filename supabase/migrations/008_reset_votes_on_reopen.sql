-- 베타 재테스트: 투표 오픈 시 이전 투표 기록 초기화

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
    DELETE FROM vote_submissions WHERE true;
    UPDATE vote_settings SET is_open = true WHERE id = 1;
  ELSE
    UPDATE vote_settings SET is_open = false WHERE id = 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_vote_open(boolean) TO anon, authenticated;
