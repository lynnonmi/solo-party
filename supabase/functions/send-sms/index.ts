import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SolapiMessageService } from "npm:solapi@5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
};

function normalizePhone(contact: string): string {
  let digits = contact.replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 10) {
    digits = `0${digits.slice(2)}`;
  }
  return digits;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) {
      return json({ error: "관리자 로그인이 필요합니다." }, 401);
    }

    const { applicant_id, text } = await req.json();
    if (!applicant_id) {
      return json({ error: "applicant_id가 필요합니다." }, 400);
    }

    const apiKey = Deno.env.get("SOLAPI_API_KEY");
    const apiSecret = Deno.env.get("SOLAPI_API_SECRET");
    const sender = Deno.env.get("SOLAPI_SENDER");
    if (!apiKey || !apiSecret || !sender) {
      return json({
        error: "Supabase에 솔라피 설정이 없습니다. Edge Function Secrets에 SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER를 등록해 주세요.",
      }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session } = await supabase
      .from("admin_sessions")
      .select("token")
      .eq("token", adminToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!session) {
      return json({ error: "관리자 세션이 만료되었습니다. 다시 로그인해 주세요." }, 401);
    }

    const { data: applicant, error: appErr } = await supabase
      .from("applicants")
      .select("id, contact, status")
      .eq("id", applicant_id)
      .maybeSingle();

    if (appErr || !applicant) {
      return json({ error: "신청자를 찾을 수 없습니다." }, 404);
    }
    if (applicant.status !== "approved") {
      return json({ error: "승인된 참가자에게만 문자를 보낼 수 있습니다." }, 400);
    }

    const to = normalizePhone(applicant.contact);
    if (!/^01[0-9]{8,9}$/.test(to)) {
      return json({ error: `연락처 형식이 올바르지 않습니다: ${applicant.contact}` }, 400);
    }

    const smsText = (text?.trim() || Deno.env.get("SOLAPI_SMS_TEXT") || "승인문자").slice(0, 2000);

    const messageService = new SolapiMessageService(apiKey, apiSecret);
    await messageService.send({ to, from: sender.replace(/\D/g, ""), text: smsText });

    const { error: updateErr } = await supabase
      .from("applicants")
      .update({ sms_sent: true })
      .eq("id", applicant_id);

    if (updateErr) {
      return json({ error: `문자는 전송됐으나 DB 업데이트 실패: ${updateErr.message}` }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg || "문자 전송에 실패했습니다." }, 500);
  }
});
