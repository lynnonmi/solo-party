-- ================================================================
-- pgcrypto 경로 수정 (관리자 로그인 오류 해결)
-- Supabase SQL Editor → New query → 붙여넣기 → Run
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

INSERT INTO admin_config (id, password_hash)
VALUES (1, extensions.crypt('clynniemine0505', extensions.gen_salt('bf')))
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash;

CREATE OR REPLACE FUNCTION admin_login(p_password text)
RETURNS TABLE (token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_config
    WHERE id = 1 AND password_hash = extensions.crypt(p_password, password_hash)
  ) THEN
    RAISE EXCEPTION 'wrong password';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO admin_sessions (token) VALUES (v_token);
  RETURN QUERY SELECT v_token;
END;
$$;

CREATE OR REPLACE FUNCTION verify_applicant(p_name text, p_contact text)
RETURNS TABLE (
  id uuid, name text, gender text, age integer, nickname text, mbti text,
  contact text, job text, job_detail text, current_work text, life_goal text,
  alone_time text, instagram text, ideal_type text, charm text, celebrity text,
  photos text[], vote_profile_photo text, refund_bank text, refund_account text,
  status text, submitted_at timestamptz, session_token text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_token text;
BEGIN
  SELECT a.id INTO v_id
  FROM applicants a
  WHERE trim(a.name) = trim(p_name)
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE applicants SET session_token = v_token WHERE applicants.id = v_id;

  RETURN QUERY
  SELECT
    a.id, a.name, a.gender, a.age, a.nickname, a.mbti, a.contact, a.job,
    a.job_detail, a.current_work, a.life_goal, a.alone_time, a.instagram,
    a.ideal_type, a.charm, a.celebrity, a.photos, a.vote_profile_photo,
    a.refund_bank, a.refund_account, a.status, a.submitted_at, v_token
  FROM applicants a WHERE a.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_login(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
