-- 마감 후 get_votes_for_me / 결과 조회 대비
CREATE INDEX IF NOT EXISTS idx_vote_votes_voted_for ON vote_votes (voted_for_id);
