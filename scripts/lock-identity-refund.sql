-- 행사 당일 아침: 이름+연락처 환불 RPC 잠금
-- (로그인된 승인자의 request_refund()는 그대로 동작)
-- Supabase SQL Editor에서 실행

REVOKE EXECUTE ON FUNCTION request_refund_by_identity(text, text) FROM anon, authenticated, PUBLIC;
