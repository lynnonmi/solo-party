-- 투표 오픈 시 신청 접수 강제 마감 + 투표 중 접수 재오픈 금지
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

    -- 투표 오픈과 동시에 접수 마감 상태 유지(안전장치)
    UPDATE vote_settings
    SET is_open = true,
        male_open = false,
        female_open = false
    WHERE id = 1;
  ELSE
    UPDATE vote_settings SET is_open = false WHERE id = 1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_toggle_gender_open(p_gender text, p_open boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vote_open boolean;
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_open THEN
    SELECT is_open AND NOT is_closed INTO v_vote_open
    FROM vote_settings
    WHERE id = 1;

    IF coalesce(v_vote_open, false) THEN
      RAISE EXCEPTION 'vote already open';
    END IF;
  END IF;

  IF p_gender = '남성' THEN
    UPDATE vote_settings SET male_open = p_open WHERE id = 1;
  ELSIF p_gender = '여성' THEN
    UPDATE vote_settings SET female_open = p_open WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'invalid gender';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_vote_open(boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_gender_open(text, boolean) TO anon, authenticated;

-- 현재 잘못된 상태 정리: 투표 오픈 중이면 접수 마감
UPDATE vote_settings
SET male_open = false, female_open = false
WHERE id = 1 AND is_open = true AND NOT is_closed;

NOTIFY pgrst, 'reload schema';
