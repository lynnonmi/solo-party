-- 관리자 매칭 현황: 쌍별 라운지 입장 체크 (운영자 수동)

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS lounge_entered boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION admin_toggle_match_lounge_entered(p_match_id uuid, p_entered boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE matches SET lounge_entered = p_entered WHERE id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_match_lounge_entered(uuid, boolean) TO anon, authenticated;
