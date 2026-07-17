-- 현장 수기 매칭: 관리자 전용 저장/조회/입장 체크
CREATE TABLE IF NOT EXISTS offline_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person1_name text NOT NULL CHECK (length(trim(person1_name)) BETWEEN 1 AND 50),
  person2_name text NOT NULL CHECK (length(trim(person2_name)) BETWEEN 1 AND 50),
  lounge_entered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE offline_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE offline_matches FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_list_offline_matches()
RETURNS SETOF offline_matches
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM offline_matches
  WHERE verify_admin_token()
  ORDER BY created_at, id;
$$;

CREATE OR REPLACE FUNCTION admin_add_offline_match(p_person1_name text, p_person2_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF length(trim(coalesce(p_person1_name, ''))) NOT BETWEEN 1 AND 50
     OR length(trim(coalesce(p_person2_name, ''))) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid name';
  END IF;

  INSERT INTO offline_matches (person1_name, person2_name)
  VALUES (trim(p_person1_name), trim(p_person2_name))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_toggle_offline_match_entered(p_id uuid, p_entered boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE offline_matches SET lounge_entered = p_entered WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_offline_match(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT verify_admin_token() THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM offline_matches WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_offline_matches() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_add_offline_match(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_offline_match_entered(uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_offline_match(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
