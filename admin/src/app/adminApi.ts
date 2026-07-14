/* ================================================================
   adminApi.ts — Supabase 관리자 데이터 레이어
================================================================ */

import { createClient } from "@supabase/supabase-js";

/** Vercel Env에 /rest/v1 이 붙거나 https:/ 처럼 깨지면 로그인 실패합니다 */
function normalizeSupabaseUrl(raw: string): string {
  let url = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/rest\/v1\/?/gi, "/")
    .replace(/\/+$/, "");

  // https:/host → https://host (붙여넣기/빌드 중 슬래시 유실 보정)
  url = url.replace(/^(https?:)\/(?!\/)/i, "$1//");

  return url;
}

const SB_URL = normalizeSupabaseUrl((import.meta.env.VITE_SUPABASE_URL as string) ?? "");
const SB_ANON = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "").trim().replace(/^["']|["']$/g, "");
const ADMIN_TOKEN_KEY = "sp_admin_token";

export interface AdminVoteSettings {
  is_open: boolean;
  is_closed: boolean;
  male_open: boolean;
  female_open: boolean;
  closed_at?: string;
}

function getClient() {
  const token = typeof window !== "undefined" ? localStorage.getItem(ADMIN_TOKEN_KEY) : null;
  return createClient(SB_URL, SB_ANON, {
    global: { headers: token ? { "x-admin-token": token } : {} },
  });
}

const toSnake = (a: Record<string, unknown>) => ({
  id: a.id,
  name: a.name,
  gender: a.gender,
  age: a.age,
  nickname: a.nickname,
  mbti: a.mbti,
  contact: a.contact,
  job: a.job,
  job_detail: a.job_detail ?? null,
  current_work: a.current_work ?? null,
  life_goal: a.life_goal ?? null,
  alone_time: a.alone_time ?? null,
  instagram: a.instagram ?? null,
  ideal_type: a.ideal_type ?? null,
  charm: a.charm ?? null,
  celebrity: a.celebrity ?? null,
  photos: a.photos ?? [],
  vote_profile_photo: a.vote_profile_photo ?? null,
  refund_bank: a.refund_bank ?? null,
  refund_account: a.refund_account ?? null,
  status: a.status,
  sms_sent: a.sms_sent ?? false,
  fee_confirmed: a.fee_confirmed ?? false,
  deposit_confirmed: a.deposit_confirmed ?? false,
  submitted_at: a.submitted_at ?? null,
});

export const adminApi = {
  hasSession(): boolean {
    return !!localStorage.getItem(ADMIN_TOKEN_KEY);
  },

  async login(pw: string): Promise<void> {
    const { data, error } = await createClient(SB_URL, SB_ANON).rpc("admin_login", {
      p_password: pw,
    });
    if (error) {
      if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
        throw new Error("db_not_setup");
      }
      if (error.message?.includes("function crypt") || error.code === "42883") {
        throw new Error("db_fix_needed");
      }
      if (error.message?.includes("wrong password")) {
        throw new Error("wrong password");
      }
      if (/Invalid path/i.test(error.message || "") || error.code === "PGRST125") {
        throw new Error(error.message || "Invalid path specified in request URL");
      }
      throw new Error(error.message || "login_failed");
    }
    if (!data?.length) throw new Error("wrong password");
    localStorage.setItem(ADMIN_TOKEN_KEY, data[0].token as string);
  },

  logout(): void {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  },

  async listApplicants() {
    const { data, error } = await getClient().rpc("admin_list_applicants");
    if (error) throw error;
    return (data ?? []).map((a: Record<string, unknown>) => toSnake(a));
  },

  async updateStatus(id: string, status: string): Promise<void> {
    const { error } = await getClient().rpc("admin_update_status", {
      p_id: id,
      p_status: status,
    });
    if (error) throw error;
  },

  async markSmsSent(id: string): Promise<void> {
    const { error } = await getClient().rpc("admin_mark_sms_sent", { p_id: id });
    if (error) throw error;
  },

  async toggleDepositConfirmed(id: string, confirmed: boolean): Promise<void> {
    const { error } = await getClient().rpc("admin_toggle_deposit_confirmed", {
      p_id: id,
      p_confirmed: confirmed,
    });
    if (error) {
      if (error.message?.includes("unauthorized")) {
        throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
        throw new Error("DB에 입금 확인 함수가 없습니다. Supabase에서 012_deposit_confirmed.sql을 실행해 주세요.");
      }
      throw new Error(error.message || "입금 확인 저장에 실패했습니다.");
    }
  },

  async sendSms(applicantId: string, text?: string, subject?: string): Promise<void> {
    const token = typeof window !== "undefined" ? localStorage.getItem(ADMIN_TOKEN_KEY) : null;
    if (!token) {
      throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    const { data, error } = await getClient().functions.invoke("send-sms", {
      body: { applicant_id: applicantId, text, subject, admin_token: token },
      headers: { "x-admin-token": token },
    });

    if (error) {
      if (error.message?.includes("Failed to send a request to the Edge Function")) {
        throw new Error("SMS 기능이 아직 배포되지 않았습니다. Supabase에서 send-sms 함수를 배포해 주세요.");
      }

      // Edge Function이 4xx/5xx를 주면 본문({ error })을 꺼내 보여줌
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.json() as { error?: string; message?: string };
          if (body?.error || body?.message) {
            throw new Error(body.error || body.message);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== error.message) throw e;
        }
      }

      throw new Error(error.message || "문자 전송에 실패했습니다.");
    }

    const result = data as { ok?: boolean; error?: string } | null;
    if (result?.error) throw new Error(result.error);
    if (!result?.ok) throw new Error("문자 전송에 실패했습니다.");
  },

  async deleteApplicant(id: string): Promise<void> {
    const { error } = await getClient().rpc("admin_delete_applicant", { p_id: id });
    if (error) {
      if (error.message?.includes("unauthorized")) {
        throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
        throw new Error("DB에 삭제 함수가 없습니다. Supabase에서 009_admin_delete_applicant.sql을 실행해 주세요.");
      }
      throw new Error(error.message || "삭제에 실패했습니다.");
    }
  },

  async getVoteResults() {
    const { data, error } = await getClient().rpc("admin_get_vote_results");
    if (error) throw error;
    return (data ?? []).map((s: Record<string, unknown>) => ({
      voter_id: s.voter_id,
      voted_for_id: s.voted_for_id,
      message: s.message ?? "",
      created_at: s.created_at,
    }));
  },

  async getMatches() {
    const { data, error } = await getClient().rpc("admin_get_matches");
    if (error) throw error;
    return (data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id,
      user1_id: m.user1_id,
      user2_id: m.user2_id,
      calculated_at: m.calculated_at,
      user1_response: m.user1_response,
      user2_response: m.user2_response,
    }));
  },

  async getVoteSettings(): Promise<AdminVoteSettings> {
    const { data, error } = await getClient()
      .from("vote_settings")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return {
      is_open: data?.is_open ?? false,
      is_closed: data?.is_closed ?? false,
      male_open: data?.male_open ?? true,
      female_open: data?.female_open ?? true,
      closed_at: data?.closed_at ?? undefined,
    };
  },

  async toggleVoteOpen(open: boolean): Promise<void> {
    const { error } = await getClient().rpc("admin_toggle_vote_open", { p_open: open });
    if (error) {
      if (error.message?.includes("unauthorized")) {
        throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      throw new Error(error.message || "투표 오픈 설정에 실패했습니다.");
    }
  },

  async clearVoteData(): Promise<void> {
    const { error } = await getClient().rpc("admin_clear_vote_data", {
      p_confirm: "DELETE_ALL_VOTES",
    });
    if (error) {
      if (error.message?.includes("unauthorized")) {
        throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
        throw new Error("DB에 투표 초기화 함수가 없습니다. npm run db:push 후 다시 시도해 주세요.");
      }
      throw new Error(error.message || "투표 데이터 삭제에 실패했습니다.");
    }
  },

  async verifySession(): Promise<boolean> {
    const { data, error } = await getClient().rpc("admin_verify_session");
    if (error) return false;
    return data === true;
  },

  async toggleGenderOpen(gender: string, open: boolean): Promise<void> {
    const { error } = await getClient().rpc("admin_toggle_gender_open", {
      p_gender: gender,
      p_open: open,
    });
    if (error) throw error;
  },

  async toggleVoteClosed(closed: boolean): Promise<void> {
    const { error } = await getClient().rpc("admin_toggle_vote_closed", { p_closed: closed });
    if (error) {
      if (error.message?.includes("unauthorized")) {
        throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      if (error.code === "PGRST202" || error.message?.includes("Could not find the function")) {
        throw new Error("DB에 투표 마감 토글 함수가 없습니다. Supabase에서 006_toggle_vote_closed.sql을 실행해 주세요.");
      }
      throw new Error(error.message || "투표 마감 설정에 실패했습니다.");
    }
  },
};
