-- 투표 후보 뷰: 투표 프로필 미설정자는 신청 사진 썸네일로 폴백
-- (노출 범위는 기존 vote_profile_photo와 동일한 단일 프로필 사진 수준)
DROP VIEW IF EXISTS approved_for_voting;
CREATE VIEW approved_for_voting AS
SELECT
  id,
  nickname,
  gender,
  COALESCE(
    vote_profile_photo,
    NULLIF(photo_thumbs[1], ''),
    NULLIF(photos[1], '')
  ) AS vote_profile_photo
FROM applicants
WHERE status = 'approved'
  AND deleted_at IS NULL;

GRANT SELECT ON approved_for_voting TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
