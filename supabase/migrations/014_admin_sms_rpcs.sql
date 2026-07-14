-- Edge Function / 클라이언트가 관리자 세션을 RPC로 검증할 수 있게 함

CREATE OR REPLACE FUNCTION admin_verify_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT verify_admin_token();
$$;

CREATE OR REPLACE FUNCTION admin_get_applicant_for_sms(p_id uuid)
RETURNS TABLE (id uuid, contact text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT verify_admin_token() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT a.id, a.contact::text, a.status::text
  FROM applicants a
  WHERE a.id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_session() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_applicant_for_sms(uuid) TO anon, authenticated;
