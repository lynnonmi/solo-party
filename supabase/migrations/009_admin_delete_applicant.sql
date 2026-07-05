-- 관리자: 신청자 삭제 (투표·매칭 기록은 FK CASCADE로 함께 삭제)

CREATE OR REPLACE FUNCTION admin_delete_applicant(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  DELETE FROM applicants WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_applicant(uuid) TO anon, authenticated;
