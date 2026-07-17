/**
 * Storage orphan 정리 Edge Function 호출 헬퍼
 *
 * 필요 env:
 *   VITE_SUPABASE_URL
 *   STORAGE_CLEANUP_SECRET
 *
 * 사용:
 *   STORAGE_CLEANUP_SECRET=... npm run cleanup:orphans
 */
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

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const base = env.VITE_SUPABASE_URL;
  const secret = env.STORAGE_CLEANUP_SECRET;
  if (!base || !secret) {
    console.error("VITE_SUPABASE_URL / STORAGE_CLEANUP_SECRET 가 필요합니다.");
    process.exit(1);
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/cleanup-storage-orphans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cleanup-secret": secret,
    },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    console.error("cleanup failed:", body);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
