-- 관리자 세션 무효화 + 비밀번호 변경 RPC
-- 실제 비밀번호 교체는: npm run admin:set-password

DELETE FROM admin_sessions;

CREATE OR REPLACE FUNCTION admin_change_password(p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_new IS NULL OR length(trim(p_new)) < 10 THEN
    RAISE EXCEPTION 'password too short';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admin_config
    WHERE id = 1 AND password_hash = extensions.crypt(p_old, password_hash)
  ) THEN
    RAISE EXCEPTION 'wrong password';
  END IF;

  UPDATE admin_config
  SET password_hash = extensions.crypt(p_new, extensions.gen_salt('bf'))
  WHERE id = 1;

  DELETE FROM admin_sessions;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_change_password(text, text) TO anon, authenticated;
