-- 투표 오픈: 남·여 신청 접수가 모두 마감된 경우에만 허용
CREATE OR REPLACE FUNCTION admin_toggle_vote_open(p_open boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_male_open boolean;
  v_female_open boolean;
  v_closed boolean;
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_open THEN
    SELECT male_open, female_open, is_closed
      INTO v_male_open, v_female_open, v_closed
    FROM vote_settings
    WHERE id = 1;

    IF coalesce(v_closed, false) THEN
      RAISE EXCEPTION 'vote already closed';
    END IF;

    IF coalesce(v_male_open, false) OR coalesce(v_female_open, false) THEN
      RAISE EXCEPTION 'applications still open';
    END IF;

    UPDATE vote_settings SET is_open = true WHERE id = 1;
  ELSE
    UPDATE vote_settings SET is_open = false WHERE id = 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_vote_open(boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
