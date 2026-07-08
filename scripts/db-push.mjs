#!/usr/bin/env node
/**
 * supabase/migrations/*.sql 중 아직 적용 안 된 파일만 DB에 실행합니다.
 *
 * 사용법 (프로젝트 폴더에서):
 *   npm run db:push
 *
 * .env 설정 (둘 중 하나):
 *   A) SUPABASE_DB_URL=postgresql://postgres.xxxx:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
 *      ↑ Supabase 대시보드 → Project Settings → Database → Connection string (URI) 복사
 *   B) VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD (+ 선택: SUPABASE_DB_REGION)
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const path = join(root, ".env");
  try {
    const lines = readFileSync(path, "utf8").split("\n");
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

const env = loadEnv();
const sbUrl = env.VITE_SUPABASE_URL;
const password = env.SUPABASE_DB_PASSWORD;
const dbUrl = env.SUPABASE_DB_URL;

const migrationsDir = join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function buildCandidates() {
  if (dbUrl) return [{ label: "SUPABASE_DB_URL", url: dbUrl }];

  if (!sbUrl?.startsWith("https://") || !password) return [];

  const ref = sbUrl.replace("https://", "").split(".")[0];
  const regions = [
    env.SUPABASE_DB_REGION,
    "ap-northeast-2",
    "ap-northeast-1",
    "us-east-1",
    "eu-west-1",
  ].filter(Boolean);

  const uniqueRegions = [...new Set(regions)];
  const out = [];
  for (const region of uniqueRegions) {
    for (const port of [6543, 5432]) {
      out.push({
        label: `${region}:${port}`,
        url: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:${port}/postgres`,
      });
    }
  }
  return out;
}

async function connect() {
  const candidates = buildCandidates();
  if (!candidates.length) {
    console.error("\n❌ .env 설정이 필요합니다.\n");
    console.error("   방법 A (추천): Supabase → Project Settings → Database");
    console.error("   → Connection string → URI 복사 후 .env 에 추가:");
    console.error("   SUPABASE_DB_URL=postgresql://...\n");
    console.error("   방법 B: VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD\n");
    process.exit(1);
  }

  let lastErr;
  for (const { label, url } of candidates) {
    const client = postgres(url, { ssl: "require", max: 1, prepare: false, connect_timeout: 10 });
    try {
      await client`SELECT 1 AS ok`;
      console.log(`🔗 DB 연결 성공 (${label})\n`);
      return client;
    } catch (err) {
      lastErr = err;
      await client.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastErr ?? new Error("DB 연결 실패");
}

async function fnExists(sql, name) {
  const [{ exists }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ${name}
    ) AS exists
  `;
  return exists;
}

async function maybeBaseline(sql, done) {
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM _app_migrations`;
  if (c > 0) return;

  const [{ exists: legacy }] = await sql`
    SELECT to_regclass('public.applicants') IS NOT NULL AS exists
  `;
  if (!legacy) return;

  console.log("ℹ️  기존 DB 감지 — 이미 적용된 마이그레이션을 자동 등록합니다.\n");

  for (const file of files) {
    if (done.has(file)) continue;

    let skip = false;
    if (file === "011_get_votes_for_me.sql") skip = await fnExists(sql, "get_votes_for_me");
    else if (file === "010_one_by_one_vote.sql") skip = await fnExists(sql, "submit_single_vote");
    else skip = true;

    if (skip) {
      await sql`INSERT INTO _app_migrations (version) VALUES (${file}) ON CONFLICT DO NOTHING`;
      done.add(file);
      console.log(`   ✓ ${file}`);
    }
  }
  if (files.some((f) => !done.has(f))) console.log("");
}

async function main() {
  const sql = await connect();

  await sql`
    CREATE TABLE IF NOT EXISTS _app_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = await sql`SELECT version FROM _app_migrations`;
  const done = new Set(applied.map((r) => r.version));

  await maybeBaseline(sql, done);

  let count = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`⏭  ${file} (이미 적용됨)`);
      continue;
    }
    const body = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`▶  ${file} 적용 중...`);
    try {
      await sql.unsafe(body);
      await sql`INSERT INTO _app_migrations (version) VALUES (${file})`;
      console.log(`✅ ${file}`);
      count++;
    } catch (err) {
      console.error(`\n❌ ${file} 실패:\n`, err.message ?? err);
      process.exit(1);
    }
  }

  if (count === 0) {
    console.log("\n✨ 적용할 새 마이그레이션이 없습니다.");
  } else {
    console.log(`\n✨ ${count}개 마이그레이션 적용 완료.`);
  }

  await sql`NOTIFY pgrst, 'reload schema'`;
  console.log("🔄 API 스키마 캐시 새로고침 완료");

  await sql.end();
}

main().catch((err) => {
  console.error("\n❌ 연결 또는 실행 오류:", err.message ?? err);
  console.error("\n💡 Supabase 대시보드 → Project Settings → Database → Connection string (URI)");
  console.error("   를 복사해서 .env 에 SUPABASE_DB_URL=... 로 넣고 다시 npm run db:push 해보세요.\n");
  process.exit(1);
});
