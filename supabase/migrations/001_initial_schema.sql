-- ================================================================
-- 솔로파티 앱 — Supabase 초기 스키마
-- Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 테이블 ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applicants (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  gender              text        NOT NULL CHECK (gender IN ('남성', '여성')),
  age                 integer     NOT NULL,
  nickname            text        NOT NULL,
  mbti                text        NOT NULL,
  contact             text        NOT NULL,
  job                 text        NOT NULL,
  job_detail          text,
  current_work        text        NOT NULL,
  life_goal           text        NOT NULL,
  alone_time          text        NOT NULL,
  instagram           text        NOT NULL,
  ideal_type          text        NOT NULL,
  charm               text        NOT NULL,
  celebrity           text        NOT NULL,
  photos              text[]      NOT NULL DEFAULT '{}',
  vote_profile_photo  text,
  refund_bank         text        NOT NULL,
  refund_account      text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  sms_sent            boolean     NOT NULL DEFAULT false,
  session_token       text        UNIQUE,
  submitted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vote_settings (
  id          int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_open     boolean     NOT NULL DEFAULT false,
  is_closed   boolean     NOT NULL DEFAULT false,
  male_open   boolean     NOT NULL DEFAULT true,
  female_open boolean     NOT NULL DEFAULT true,
  closed_at   timestamptz
);

CREATE TABLE IF NOT EXISTS vote_submissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id        uuid        NOT NULL UNIQUE REFERENCES applicants(id) ON DELETE CASCADE,
  voted_for_ids   uuid[]      NOT NULL DEFAULT '{}',
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id        uuid        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  user2_id        uuid        NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  calculated_at   timestamptz NOT NULL DEFAULT now(),
  user1_response  text        NOT NULL DEFAULT 'pending'
                  CHECK (user1_response IN ('pending', 'going', 'not_going')),
  user2_response  text        NOT NULL DEFAULT 'pending'
                  CHECK (user2_response IN ('pending', 'going', 'not_going')),
  CONSTRAINT matches_user_order CHECK (user1_id < user2_id),
  UNIQUE (user1_id, user2_id)
);

CREATE TABLE IF NOT EXISTS admin_config (
  id              int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash   text        NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token           text        PRIMARY KEY DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

INSERT INTO vote_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_config (id, password_hash)
VALUES (1, extensions.crypt('clynniemine0505', extensions.gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

-- ── 뷰 ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW approved_for_voting AS
SELECT
  id,
  nickname,
  gender,
  vote_profile_photo,
  photos
FROM applicants
WHERE status = 'approved';

-- ── 헬퍼 ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_session_token()
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'x-session-token',
    nullif(current_setting('request.headers', true), '')::json->>'X-Session-Token'
  );
$$;

CREATE OR REPLACE FUNCTION get_admin_token()
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'x-admin-token',
    nullif(current_setting('request.headers', true), '')::json->>'X-Admin-Token'
  );
$$;

  CREATE OR REPLACE FUNCTION normalize_contact(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  IF length(d) = 10 AND left(d, 2) = '10' THEN
    d := '0' || d;
  END IF;
  IF length(d) = 12 AND left(d, 2) = '82' THEN
    d := '0' || substring(d from 3);
  END IF;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION verify_admin_token()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_sessions
    WHERE token = get_admin_token()
      AND expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION get_voter_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM applicants
  WHERE session_token = get_session_token()
    AND status = 'approved'
  LIMIT 1;
$$;

-- ── 참가자 RPC ───────────────────────────────────────────────────

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

CREATE OR REPLACE FUNCTION get_my_application()
RETURNS SETOF applicants
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM applicants WHERE id = get_voter_id();
$$;

CREATE OR REPLACE FUNCTION get_my_submission()
RETURNS TABLE (voted_for_ids uuid[], submitted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.voted_for_ids, vs.submitted_at
  FROM vote_submissions vs
  WHERE vs.voter_id = get_voter_id();
$$;

CREATE OR REPLACE FUNCTION update_vote_profile_photo(p_photo_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM vote_settings WHERE id = 1 AND is_closed) THEN
    RAISE EXCEPTION 'vote closed';
  END IF;
  UPDATE applicants SET vote_profile_photo = p_photo_url WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION submit_vote(p_voted_for_ids uuid[])
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

  IF EXISTS (SELECT 1 FROM vote_submissions WHERE voter_id = v_id) THEN
    RAISE EXCEPTION 'already submitted';
  END IF;

  IF coalesce(array_length(p_voted_for_ids, 1), 0) > 4 THEN
    RAISE EXCEPTION 'max 4 votes';
  END IF;

  INSERT INTO vote_submissions (voter_id, voted_for_ids)
  VALUES (v_id, coalesce(p_voted_for_ids, '{}'));
END;
$$;

CREATE OR REPLACE FUNCTION get_my_matches()
RETURNS SETOF matches
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.*
  FROM matches m
  JOIN vote_settings vs ON vs.id = 1
  WHERE vs.is_closed
    AND (m.user1_id = get_voter_id() OR m.user2_id = get_voter_id());
$$;

CREATE OR REPLACE FUNCTION update_lounge_response(p_match_id uuid, p_response text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_match matches%ROWTYPE;
BEGIN
  v_id := get_voter_id();
  IF v_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_response NOT IN ('going', 'not_going') THEN RAISE EXCEPTION 'invalid response'; END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'match not found'; END IF;

  IF v_match.user1_id = v_id THEN
    UPDATE matches SET user1_response = p_response WHERE id = p_match_id;
  ELSIF v_match.user2_id = v_id THEN
    UPDATE matches SET user2_response = p_response WHERE id = p_match_id;
  ELSE
    RAISE EXCEPTION 'not your match';
  END IF;
END;
$$;

-- ── 관리자 RPC ───────────────────────────────────────────────────

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

CREATE OR REPLACE FUNCTION admin_list_applicants()
RETURNS SETOF applicants
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM applicants
  WHERE verify_admin_token()
  ORDER BY submitted_at DESC;
$$;

CREATE OR REPLACE FUNCTION admin_update_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  UPDATE applicants SET status = p_status WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_mark_sms_sent(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE applicants SET sms_sent = true WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_vote_results()
RETURNS TABLE (voter_id uuid, voted_for_ids uuid[], submitted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.voter_id, vs.voted_for_ids, vs.submitted_at
  FROM vote_submissions vs
  WHERE verify_admin_token();
$$;

CREATE OR REPLACE FUNCTION admin_get_matches()
RETURNS SETOF matches
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM matches
  WHERE verify_admin_token()
  ORDER BY calculated_at DESC;
$$;

CREATE OR REPLACE FUNCTION admin_toggle_vote_open(p_open boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE vote_settings SET is_open = p_open WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION admin_toggle_gender_open(p_gender text, p_open boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_gender = '남성' THEN
    UPDATE vote_settings SET male_open = p_open WHERE id = 1;
  ELSIF p_gender = '여성' THEN
    UPDATE vote_settings SET female_open = p_open WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'invalid gender';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_close_voting()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  DELETE FROM matches WHERE true;

  INSERT INTO matches (user1_id, user2_id)
  SELECT DISTINCT
    LEAST(s1.voter_id, voted_id),
    GREATEST(s1.voter_id, voted_id)
  FROM vote_submissions s1
  CROSS JOIN LATERAL unnest(s1.voted_for_ids) AS voted_id
  JOIN vote_submissions s2 ON s2.voter_id = voted_id
  WHERE s1.voter_id = ANY(s2.voted_for_ids)
    AND s1.voter_id <> voted_id;

  UPDATE vote_settings
  SET is_open = false, is_closed = true, closed_at = now()
  WHERE id = 1;
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────────

ALTER TABLE applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applicants_insert_anon ON applicants;
CREATE POLICY applicants_insert_anon ON applicants
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS vote_settings_select_anon ON vote_settings;
CREATE POLICY vote_settings_select_anon ON vote_settings
  FOR SELECT TO anon USING (true);

-- ── Storage (사진 업로드) ────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('applicants', 'applicants', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS applicants_storage_insert ON storage.objects;
DROP POLICY IF EXISTS applicants_storage_select ON storage.objects;

CREATE POLICY applicants_storage_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'applicants');

CREATE POLICY applicants_storage_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'applicants');

-- ── 권한 ─────────────────────────────────────────────────────────

GRANT SELECT ON approved_for_voting TO anon, authenticated;
GRANT SELECT ON vote_settings TO anon, authenticated;
GRANT INSERT ON applicants TO anon, authenticated;

GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_my_application() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_my_submission() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_vote_profile_photo(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_vote(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_my_matches() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_lounge_response(uuid, text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_login(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_applicants() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_status(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_sms_sent(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_vote_results() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_matches() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_vote_open(boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_gender_open(text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_close_voting() TO anon, authenticated;
