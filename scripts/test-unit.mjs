/**
 * 단위 테스트 (DB 불필요)
 *   node --test scripts/test-unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

function normalizeContact(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("10")) d = "0" + d;
  if (d.length === 12 && d.startsWith("82")) d = "0" + d.slice(2);
  return d;
}

function smsIdempotencyKey(applicantId, kind, force, uuid = crypto.randomUUID()) {
  if (force) return `${applicantId}:${kind}:${uuid}`;
  return `${applicantId}:${kind}:v1`;
}

function isNetworkErrorMessage(msg) {
  const m = (msg || "").toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("timeout")
  );
}

test("normalizeContact strips non-digits and fixes 10-digit", () => {
  assert.equal(normalizeContact("010-1234-5678"), "01012345678");
  assert.equal(normalizeContact("1012345678"), "01012345678");
  assert.equal(normalizeContact("+82 10-1234-5678"), "01012345678");
});

test("sms idempotency key is stable without force", () => {
  const a = smsIdempotencyKey("u1", "approve", false);
  const b = smsIdempotencyKey("u1", "approve", false);
  assert.equal(a, b);
  assert.equal(a, "u1:approve:v1");
});

test("sms idempotency key changes with force", () => {
  const a = smsIdempotencyKey("u1", "approve", true, "aaa");
  const b = smsIdempotencyKey("u1", "approve", true, "bbb");
  assert.notEqual(a, b);
  assert.match(a, /^u1:approve:aaa$/);
});

test("network error detection", () => {
  assert.equal(isNetworkErrorMessage("Failed to fetch"), true);
  assert.equal(isNetworkErrorMessage("unauthorized"), false);
});
