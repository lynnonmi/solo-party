#!/usr/bin/env node
/**
 * 프로덕션 관리자 비밀번호 설정/교체 + 세션 전부 무효화
 *
 *   ADMIN_PASSWORD='새강한비밀번호' npm run admin:set-password
 *
 * .env: SUPABASE_DB_URL 또는 VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const lines = readFileSync(join(root, ".env"), "utf8").split("\n");
    const env = {};
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

const fileEnv = loadEnv();
const env = { ...fileEnv, ...process.env };
const password = (env.ADMIN_PASSWORD || "").trim();
const dbUrl = env.SUPABASE_DB_URL;
const sbUrl = env.VITE_SUPABASE_URL;
const dbPassword = env.SUPABASE_DB_PASSWORD;

if (password.length < 10) {
  console.error("\n❌ ADMIN_PASSWORD 를 10자 이상으로 설정하세요.\n");
  console.error("   ADMIN_PASSWORD='새강한비밀번호' npm run admin:set-password\n");
  process.exit(1);
}

function buildCandidates() {
  if (dbUrl) return [{ label: "SUPABASE_DB_URL", url: dbUrl }];
  if (!sbUrl?.startsWith("https://") || !dbPassword) return [];
  const ref = sbUrl.replace("https://", "").split(".")[0];
  const regions = [...new Set([
    env.SUPABASE_DB_REGION,
    "ap-northeast-2",
    "ap-northeast-1",
    "us-east-1",
    "eu-west-1",
  ].filter(Boolean))];
  const out = [];
  for (const region of regions) {
    for (const port of [6543, 5432]) {
      out.push({
        label: `${region}:${port}`,
        url: `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@aws-0-${region}.pooler.supabase.com:${port}/postgres`,
      });
    }
  }
  return out;
}

async function connect() {
  const candidates = buildCandidates();
  if (!candidates.length) {
    console.error("\n❌ .env 에 SUPABASE_DB_URL 또는 VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD 가 필요합니다.\n");
    process.exit(1);
  }
  let lastErr;
  for (const { label, url } of candidates) {
    const client = postgres(url, { ssl: "require", max: 1, prepare: false, connect_timeout: 10 });
    try {
      await client`SELECT 1 AS ok`;
      console.log(`🔗 DB 연결 성공 (${label})`);
      return client;
    } catch (err) {
      lastErr = err;
      await client.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastErr ?? new Error("DB 연결 실패");
}

const sql = await connect();
try {
  await sql`
    INSERT INTO admin_config (id, password_hash)
    VALUES (1, extensions.crypt(${password}, extensions.gen_salt('bf')))
    ON CONFLICT (id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash
  `;
  const deleted = await sql`DELETE FROM admin_sessions RETURNING token`;
  console.log(`✅ 관리자 비밀번호를 갱신했습니다. 기존 세션 ${deleted.length}개 무효화.`);
  console.log("   새 비밀번호로 다시 로그인해 주세요.\n");
} finally {
  await sql.end();
}
