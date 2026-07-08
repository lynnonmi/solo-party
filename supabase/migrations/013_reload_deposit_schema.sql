-- 입금 확인 함수·컬럼 재확인 + API 스키마 캐시 갱신

ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS fee_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS deposit_confirmed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION admin_toggle_deposit_confirmed(p_id uuid, p_confirmed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE applicants
  SET deposit_confirmed = p_confirmed
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_deposit_confirmed(uuid, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
