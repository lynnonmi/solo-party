-- ================================================================
-- 연락처 정규화 수정 (투표 로그인 매칭 오류 해결)
-- Supabase SQL Editor → 붙여넣기 → Run
-- ================================================================

CREATE OR REPLACE FUNCTION normalize_contact(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  -- 1012345678 → 01012345678
  IF length(d) = 10 AND left(d, 2) = '10' THEN
    d := '0' || d;
  END IF;
  -- 821012345678 → 01012345678
  IF length(d) = 12 AND left(d, 2) = '82' THEN
    d := '0' || substring(d from 3);
  END IF;
  RETURN d;
END;
$$;

-- 기존 신청자 연락처도 통일
UPDATE applicants SET contact = normalize_contact(contact) WHERE contact IS NOT NULL;

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
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
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

GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
