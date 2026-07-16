-- 승인 심사용 원본(photos) + 투표용 썸네일(photo_thumbs)

ALTER TABLE applicants
  ADD COLUMN IF NOT EXISTS photo_thumbs text[] NOT NULL DEFAULT '{}';

DROP FUNCTION IF EXISTS submit_application(
  text, text, integer, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text, text
);

CREATE OR REPLACE FUNCTION submit_application(
  p_name text,
  p_gender text,
  p_age integer,
  p_nickname text,
  p_mbti text,
  p_contact text,
  p_job text,
  p_job_detail text,
  p_current_work text,
  p_life_goal text,
  p_alone_time text,
  p_instagram text,
  p_ideal_type text,
  p_charm text,
  p_celebrity text,
  p_photos text[],
  p_photo_thumbs text[],
  p_refund_bank text,
  p_refund_account text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact text;
  v_id uuid;
  v_male_open boolean;
  v_female_open boolean;
  v_thumbs text[];
BEGIN
  IF p_gender NOT IN ('남성', '여성') THEN
    RAISE EXCEPTION 'invalid gender';
  END IF;

  IF p_photos IS NULL OR cardinality(p_photos) < 1 THEN
    RAISE EXCEPTION 'photos required';
  END IF;

  v_thumbs := coalesce(p_photo_thumbs, '{}');
  IF cardinality(v_thumbs) > 0 AND cardinality(v_thumbs) <> cardinality(p_photos) THEN
    RAISE EXCEPTION 'photo thumbs mismatch';
  END IF;

  v_contact := normalize_contact(p_contact);
  IF v_contact IS NULL OR length(v_contact) < 10 THEN
    RAISE EXCEPTION 'invalid contact';
  END IF;

  SELECT male_open, female_open INTO v_male_open, v_female_open
  FROM vote_settings WHERE id = 1;

  IF p_gender = '남성' AND NOT coalesce(v_male_open, false) THEN
    RAISE EXCEPTION 'male applications closed';
  END IF;
  IF p_gender = '여성' AND NOT coalesce(v_female_open, false) THEN
    RAISE EXCEPTION 'female applications closed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM applicants
    WHERE normalize_contact(contact) = v_contact
      AND status IN ('pending', 'approved', 'refund_requested')
  ) THEN
    RAISE EXCEPTION 'duplicate contact';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO applicants (
    name, gender, age, nickname, mbti, contact, job, job_detail,
    current_work, life_goal, alone_time, instagram, ideal_type, charm, celebrity,
    photos, photo_thumbs, refund_bank, refund_account, status, fee_confirmed
  ) VALUES (
    trim(p_name), p_gender, p_age, trim(p_nickname), p_mbti, v_contact,
    p_job, NULLIF(trim(coalesce(p_job_detail, '')), ''),
    trim(p_current_work), trim(p_life_goal), trim(p_alone_time), trim(p_instagram),
    trim(p_ideal_type), trim(p_charm), trim(p_celebrity),
    p_photos, v_thumbs, trim(p_refund_bank), trim(p_refund_account),
    'pending', false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_application(
  text, text, integer, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text, text
) TO anon, authenticated;

-- 로그인 응답에 photo_thumbs 포함
DROP FUNCTION IF EXISTS verify_applicant(text, text);

CREATE OR REPLACE FUNCTION verify_applicant(p_name text, p_contact text)
RETURNS TABLE (
  id uuid, name text, gender text, age integer, nickname text, mbti text,
  contact text, job text, job_detail text, current_work text, life_goal text,
  alone_time text, instagram text, ideal_type text, charm text, celebrity text,
  photos text[], photo_thumbs text[], vote_profile_photo text,
  refund_bank text, refund_account text,
  status text, submitted_at timestamptz, session_token text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_token text;
  v_count int;
BEGIN
  SELECT count(*)::int INTO v_count
  FROM applicants a
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved';

  IF v_count = 0 THEN
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'ambiguous applicant';
  END IF;

  SELECT a.id INTO v_id
  FROM applicants a
  WHERE regexp_replace(trim(a.name), '\s+', ' ', 'g') = regexp_replace(trim(p_name), '\s+', ' ', 'g')
    AND normalize_contact(a.contact) = normalize_contact(p_contact)
    AND a.status = 'approved'
  LIMIT 1;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE applicants SET session_token = v_token WHERE applicants.id = v_id;

  RETURN QUERY
  SELECT
    a.id, a.name, a.gender, a.age, a.nickname, a.mbti, a.contact, a.job,
    a.job_detail, a.current_work, a.life_goal, a.alone_time, a.instagram,
    a.ideal_type, a.charm, a.celebrity, a.photos, a.photo_thumbs, a.vote_profile_photo,
    a.refund_bank, a.refund_account, a.status, a.submitted_at, v_token
  FROM applicants a WHERE a.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_applicant(text, text) TO anon, authenticated;
