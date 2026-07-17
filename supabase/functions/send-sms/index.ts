import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt)),
  );
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function sendSolapiSms(opts: {
  apiKey: string;
  apiSecret: string;
  to: string;
  from: string;
  text: string;
  subject?: string;
}) {
  const message: Record<string, string> = {
    to: opts.to,
    from: opts.from,
    text: opts.text,
  };
  if (opts.subject?.trim()) {
    message.subject = opts.subject.trim().slice(0, 40);
  }

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: await solapiAuthHeader(opts.apiKey, opts.apiSecret),
    },
    body: JSON.stringify({ message }),
  });

  const body = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const msg =
      (parsed.errorMessage as string) ||
      (parsed.message as string) ||
      body ||
      `Solapi HTTP ${res.status}`;
    throw new Error(msg);
  }

  return parsed;
}

function extractProviderMessageId(parsed: Record<string, unknown>): string | null {
  const direct = parsed.messageId ?? parsed.message_id;
  if (typeof direct === "string" && direct) return direct;
  const group = parsed.groupId ?? parsed.group_id;
  if (typeof group === "string" && group) return group;
  return null;
}

async function ignoreRpcError(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    await client.rpc(name, args);
  } catch {
    // Best-effort logging must not hide the original provider error.
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  let claimedKey: string | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    const applicant_id = payload.applicant_id as string | undefined;
    const text = payload.text as string | undefined;
    const subject = payload.subject as string | undefined;
    const force = payload.force === true;
    const adminToken =
      req.headers.get("x-admin-token") ||
      (payload.admin_token as string | undefined) ||
      "";

    if (!adminToken) {
      return json({ ok: false, error: "관리자 로그인이 필요합니다." }, 401);
    }
    if (!applicant_id) {
      return json({ ok: false, error: "applicant_id가 필요합니다." }, 400);
    }

    const apiKey = Deno.env.get("SOLAPI_API_KEY");
    const apiSecret = Deno.env.get("SOLAPI_API_SECRET");
    const sender = Deno.env.get("SOLAPI_SENDER");
    if (!apiKey || !apiSecret || !sender) {
      return json({
        ok: false,
        error:
          "솔라피 Secrets가 없습니다. SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER를 등록해 주세요.",
      }, 500);
    }

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { "x-admin-token": adminToken } } },
    );

    const { data: sessionOk, error: sessionErr } = await supabase.rpc("admin_verify_session");
    if (sessionErr) {
      if (
        sessionErr.code === "PGRST202" ||
        sessionErr.message?.includes("Could not find the function")
      ) {
        return json({
          ok: false,
          error: "DB에 admin_verify_session이 없습니다. 014_admin_sms_rpcs.sql을 적용해 주세요.",
        }, 500);
      }
      return json({ ok: false, error: `세션 확인 실패: ${sessionErr.message}` }, 500);
    }
    if (!sessionOk) {
      return json({
        ok: false,
        error: "관리자 세션이 만료되었습니다. 다시 로그인해 주세요.",
      }, 401);
    }

    const { data: applicantRows, error: appErr } = await supabase.rpc(
      "admin_get_applicant_for_sms",
      { p_id: applicant_id },
    );
    if (appErr) {
      if (appErr.message?.includes("unauthorized")) {
        return json({
          ok: false,
          error: "관리자 세션이 만료되었습니다. 다시 로그인해 주세요.",
        }, 401);
      }
      return json({ ok: false, error: appErr.message || "신청자를 찾을 수 없습니다." }, 404);
    }

    const applicant = Array.isArray(applicantRows) ? applicantRows[0] : applicantRows;
    if (!applicant) {
      return json({ ok: false, error: "신청자를 찾을 수 없습니다." }, 404);
    }
    if (applicant.status !== "approved" && applicant.status !== "rejected") {
      return json({ ok: false, error: "승인 또는 거절된 참가자에게만 문자를 보낼 수 있습니다." }, 400);
    }

    const kind = applicant.status === "rejected" ? "reject" : "approve";
    // 기본 키: 같은 상태당 1회. force면 새 키로 재발송.
    const idempotency_key = force
      ? `${applicant_id}:${kind}:${crypto.randomUUID()}`
      : `${applicant_id}:${kind}:v1`;
    claimedKey = idempotency_key;

    const { data: claimRows, error: claimErr } = await supabase.rpc("admin_claim_sms_send", {
      p_applicant_id: applicant_id,
      p_kind: kind,
      p_idempotency_key: idempotency_key,
    });
    if (claimErr) {
      if (claimErr.code === "PGRST202" || claimErr.message?.includes("Could not find the function")) {
        // 구버전 DB: claim 없이 진행 (하위 호환)
      } else {
        return json({ ok: false, error: claimErr.message || "SMS claim 실패" }, 500);
      }
    } else {
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (claim?.result === "already_sent") {
        return json({
          ok: true,
          already_sent: true,
          provider_message_id: claim.provider_message_id ?? null,
        });
      }
      if (claim?.result === "uncertain") {
        return json({
          ok: false,
          uncertain: true,
          error:
            "이전 전송 결과를 확정할 수 없어 자동 재전송을 막았습니다. Solapi 내역을 확인한 뒤 필요할 때만 강제 재발송하세요.",
          provider_message_id: claim.provider_message_id ?? null,
        }, 409);
      }
    }

    const to = normalizePhone(String(applicant.contact ?? ""));
    if (!/^01[0-9]{8,9}$/.test(to)) {
      if (claimedKey) {
        await ignoreRpcError(supabase, "admin_finish_sms_send", {
          p_idempotency_key: claimedKey,
          p_success: false,
          p_error_message: `invalid contact: ${applicant.contact}`,
        });
      }
      return json({
        ok: false,
        error: `연락처 형식이 올바르지 않습니다: ${applicant.contact}`,
      }, 400);
    }

    const defaultBody = `안녕하세요, 김해린입니다.

저의 두번째 솔로파티에 신청해주셔서 감사합니다.

신청서를 꼼꼼히 검토한 결과, 최종 승인되어 안내드립니다.

[행사 안내]
• 일시: 8월 9일(일) 오후 5:00
(오후 4:50부터 입장 가능하며, 원활한 진행을 위해 오후 5시까지 입장 부탁드립니다.)

• 장소: 서울특별시 강남구 학동로2길 56 원창빌딩 3층 컴업살롱

[안내사항]
• 신분증 지참 필수 (본인 확인용)
• 다과, 음료, 주류 및 간단한 식사는 행사 2부에서 제공될 예정입니다. 식사를 먼저 하고 오시면 더욱 편하게 참여하실 수 있습니다.
• 주차는 지원되지 않습니다.

문의사항은 아래 오픈채팅으로 부탁드립니다.
(본 번호는 수신 전용으로 회신이 어렵습니다.)
https://open.kakao.com/o/s9r5ORCi

솔로파티 당일에 뵙겠습니다.
감사합니다! <3`;

    const smsText = (text?.trim() || Deno.env.get("SOLAPI_SMS_TEXT") || defaultBody).slice(0, 2000);
    const smsSubject = (
      subject?.trim() ||
      Deno.env.get("SOLAPI_SMS_SUBJECT") ||
      "[김해린의 두번째 솔로파티] 승인 안내"
    ).slice(0, 40);

    let providerId: string | null = null;
    try {
      const parsed = await sendSolapiSms({
        apiKey,
        apiSecret,
        to,
        from: sender.replace(/\D/g, ""),
        text: smsText,
        subject: smsSubject,
      });
      providerId = extractProviderMessageId(parsed);
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      if (claimedKey) {
        await ignoreRpcError(supabase, "admin_finish_sms_send", {
          p_idempotency_key: claimedKey,
          p_success: false,
          p_error_message: msg,
        });
      }
      throw sendErr;
    }

    if (claimedKey) {
      const { error: finishErr } = await supabase.rpc("admin_finish_sms_send", {
        p_idempotency_key: claimedKey,
        p_success: true,
        p_provider_message_id: providerId,
      });
      if (finishErr) {
        // 문자는 갔지만 로그 실패 — 중복 방지 위해 already 처리된 것처럼 표시
        if (finishErr.code === "PGRST202") {
          await ignoreRpcError(supabase, "admin_mark_sms_sent", { p_id: applicant_id });
        } else {
          return json({
            ok: false,
            error: `문자는 전송됐으나 로그 저장 실패: ${finishErr.message}`,
            provider_message_id: providerId,
          }, 500);
        }
      }
    } else {
      const { error: updateErr } = await supabase.rpc("admin_mark_sms_sent", {
        p_id: applicant_id,
      });
      if (updateErr) {
        return json({
          ok: false,
          error: `문자는 전송됐으나 DB 업데이트 실패: ${updateErr.message}`,
        }, 500);
      }
    }

    return json({ ok: true, provider_message_id: providerId, already_sent: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg || "문자 전송에 실패했습니다." }, 500);
  }
});
