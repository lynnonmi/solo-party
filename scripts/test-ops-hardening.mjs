/**
 * DB 회귀 테스트 (023 ops hardening)
 *   npm run test:db
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function connect() {
  const env = { ...loadEnv(), ...process.env };
  const candidates = [];
  if (env.SUPABASE_DB_URL) candidates.push(env.SUPABASE_DB_URL);
  if (env.VITE_SUPABASE_URL?.startsWith("https://") && env.SUPABASE_DB_PASSWORD) {
    const ref = env.VITE_SUPABASE_URL.replace("https://", "").split(".")[0];
    const regions = [...new Set([env.SUPABASE_DB_REGION, "ap-northeast-1", "ap-northeast-2"].filter(Boolean))];
    for (const region of regions) {
      for (const port of [6543, 5432]) {
        candidates.push(
          `postgresql://postgres.${ref}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-0-${region}.pooler.supabase.com:${port}/postgres`,
        );
      }
    }
  }
  if (!candidates.length) {
    console.error("SKIP: DB credentials missing");
    process.exit(0);
  }
  let lastErr;
  for (const url of candidates) {
    const client = postgres(url, { ssl: "require", max: 1, prepare: false, connect_timeout: 10 });
    try {
      await client`SELECT 1`;
      return client;
    } catch (e) {
      lastErr = e;
      await client.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastErr ?? new Error("DB connect failed");
}

async function main() {
  const sql = await connect();
  console.log("🔗 DB connected\n");
  const fails = [];
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (e) {
      fails.push(`${name}: ${e.message}`);
      console.error(`✗ ${name}: ${e.message}`);
    }
  };

  await check("deleted_at column", async () => {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'applicants' AND column_name = 'deleted_at'
      ) AS exists`;
    assert(exists, "missing deleted_at");
  });

  await check("applicant_sessions table", async () => {
    const [{ exists }] = await sql`SELECT to_regclass('public.applicant_sessions') IS NOT NULL AS exists`;
    assert(exists, "missing applicant_sessions");
  });

  await check("sms_logs table", async () => {
    const [{ exists }] = await sql`SELECT to_regclass('public.sms_logs') IS NOT NULL AS exists`;
    assert(exists, "missing sms_logs");
  });

  await check("admin_claim_sms_send exists", async () => {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'admin_claim_sms_send'
      ) AS exists`;
    assert(exists, "missing admin_claim_sms_send");
  });

  await check("get_voter_id uses applicant_sessions", async () => {
    const [{ def }] = await sql`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_voter_id'
      LIMIT 1`;
    assert(def?.includes("applicant_sessions"), "get_voter_id not updated");
  });

  await check("admin_delete_applicant soft-deletes", async () => {
    const [{ def }] = await sql`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_delete_applicant'
      LIMIT 1`;
    assert(def?.includes("deleted_at"), "admin_delete_applicant not soft delete");
    assert(!/DELETE FROM applicants\s+WHERE id = p_id/i.test(def), "still hard-deletes applicants");
  });

  await check("submit_single_vote has FOR UPDATE", async () => {
    const [{ def }] = await sql`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'submit_single_vote'
      LIMIT 1`;
    assert(def?.includes("FOR UPDATE"), "submit_single_vote missing lock");
  });

  await check("admin_toggle_vote_closed closes before match", async () => {
    const [{ def }] = await sql`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_toggle_vote_closed'
      LIMIT 1`;
    assert(def?.includes("FOR UPDATE"), "close missing lock");
    const closeIdx = def.indexOf("is_closed = true");
    const insertIdx = def.indexOf("INSERT INTO matches");
    assert(closeIdx > -1 && insertIdx > -1 && closeIdx < insertIdx, "close should precede match insert");
  });

  await check("admin_claim_sms_send blocks uncertain pending", async () => {
    const [{ def }] = await sql`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_claim_sms_send'
      LIMIT 1`;
    assert(def?.includes("uncertain"), "claim missing uncertain guard");
  });

  await check("admin_list_orphan_storage_objects exists", async () => {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'admin_list_orphan_storage_objects'
      ) AS exists`;
    assert(exists, "missing admin_list_orphan_storage_objects");
  });

  // migration file present
  await check("023/024 migration files present", async () => {
    const files = readdirSync(join(root, "supabase", "migrations"));
    assert(files.includes("023_ops_hardening.sql"), "023 missing");
    assert(files.includes("024_ops_safety_followup.sql"), "024 missing");
  });

  await sql.end({ timeout: 5 });
  if (fails.length) {
    console.error(`\n${fails.length} failed`);
    process.exit(1);
  }
  console.log("\n✨ DB hardening checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
