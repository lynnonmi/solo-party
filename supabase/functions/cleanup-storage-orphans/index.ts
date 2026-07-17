import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-cleanup-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function objectNameFromPublicUrl(url: string): string | null {
  const marker = "/storage/v1/object/public/applicants/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const expectedSecret = Deno.env.get("STORAGE_CLEANUP_SECRET");
  const suppliedSecret = req.headers.get("x-cleanup-secret");
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "service role configuration missing" }, 500);
  }

  const client = createClient(supabaseUrl, serviceRoleKey);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const referenced = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("applicants")
      .select("photos, photo_thumbs")
      .range(from, from + pageSize - 1);
    if (error) return json({ ok: false, error: error.message }, 500);

    for (const row of data ?? []) {
      for (const url of [...(row.photos ?? []), ...(row.photo_thumbs ?? [])]) {
        const name = objectNameFromPublicUrl(String(url));
        if (name) referenced.add(name);
      }
    }
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  const orphanNames: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from("applicants").list("", {
      limit: 1000,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    for (const object of data ?? []) {
      if (!object.id || !object.created_at) continue;
      if (new Date(object.created_at).getTime() >= cutoff) continue;
      if (!referenced.has(object.name)) orphanNames.push(object.name);
    }
    if (!data || data.length < 1000) break;
    offset += 1000;
  }

  const removed: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (let i = 0; i < orphanNames.length; i += 100) {
    const batch = orphanNames.slice(i, i + 100);
    const { error } = await client.storage.from("applicants").remove(batch);
    if (error) {
      for (const name of batch) failed.push({ name, error: error.message });
    } else {
      removed.push(...batch);
    }
  }

  return json({
    ok: failed.length === 0,
    scanned_references: referenced.size,
    orphan_count: orphanNames.length,
    removed,
    failed,
  });
});
