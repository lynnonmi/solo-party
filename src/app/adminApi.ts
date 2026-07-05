/* ================================================================
   adminApi.ts
   관리자 전용 데이터 접근 레이어.
   현재는 localStorage를 사용하며, Supabase 연동 시 각 메서드를
   Supabase 클라이언트 호출로 교체하면 됩니다.
================================================================ */

const ADMIN_PW     = "clynniemine0505";
const SESSION_KEY  = "sp_admin_session";
const APP_KEY      = "sp_apps_v2";
const SUBS_KEY     = "sp_subs_v1";
const MATCHES_KEY  = "sp_matches_v1";
const SETTINGS_KEY = "sp_settings_v1";

/* ── 내부 타입 ── */
interface RawApp {
  id: string; name: string; gender: string; age: string | number;
  nickname: string; mbti: string; contact: string; job: string;
  jobDetail?: string; currentWork?: string; lifeGoal?: string;
  hobbies?: string; instagram?: string; idealType?: string;
  charm?: string; celebrity?: string; photos?: string[];
  voteProfilePhoto?: string; refundBank?: string; refundAccount?: string;
  status: string; smsSent?: boolean; submittedAt?: string;
}

interface RawSub {
  id: string; voterId: string; votedForIds: string[]; submittedAt: string;
}

interface RawMatch {
  id: string; user1Id: string; user2Id: string; calculatedAt: string;
  user1Response: string; user2Response: string;
}

export interface AdminVoteSettings {
  is_open: boolean;
  is_closed: boolean;
  male_open: boolean;
  female_open: boolean;
  closed_at?: string;
}

/* ── localStorage 헬퍼 ── */
const load = <T>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
};
const save = (key: string, val: unknown) =>
  localStorage.setItem(key, JSON.stringify(val));

const loadSettings = (): AdminVoteSettings => ({
  is_open: false, is_closed: false, male_open: true, female_open: true,
  ...load<Partial<AdminVoteSettings>>(SETTINGS_KEY, {}),
});

/* ── snake_case 변환 ── */
const toSnake = (a: RawApp) => ({
  id: a.id, name: a.name, gender: a.gender, age: a.age,
  nickname: a.nickname, mbti: a.mbti, contact: a.contact,
  job: a.job, job_detail: a.jobDetail ?? null,
  current_work: a.currentWork ?? null, life_goal: a.lifeGoal ?? null,
  alone_time: a.hobbies ?? null, instagram: a.instagram ?? null,
  ideal_type: a.idealType ?? null, charm: a.charm ?? null,
  celebrity: a.celebrity ?? null, photos: a.photos ?? [],
  vote_profile_photo: a.voteProfilePhoto ?? null,
  refund_bank: a.refundBank ?? null, refund_account: a.refundAccount ?? null,
  status: a.status, sms_sent: a.smsSent ?? false,
  submitted_at: a.submittedAt ?? null,
});

const subToSnake = (s: RawSub) => ({
  voter_id: s.voterId,
  voted_for_ids: s.votedForIds ?? [],
  submitted_at: s.submittedAt,
});

const matchToSnake = (m: RawMatch) => ({
  id: m.id,
  user1_id: m.user1Id,
  user2_id: m.user2Id,
  calculated_at: m.calculatedAt,
  user1_response: (m.user1Response ?? "pending").replace("-", "_"),
  user2_response: (m.user2Response ?? "pending").replace("-", "_"),
});

/* ── 매칭 계산 ── */
function computeMatches(subs: RawSub[]): RawMatch[] {
  const processed = new Set<string>();
  const matches: RawMatch[] = [];
  for (const s1 of subs) {
    for (const vid of s1.votedForIds ?? []) {
      const s2 = subs.find(s => s.voterId === vid);
      if (s2?.votedForIds?.includes(s1.voterId)) {
        const key = [s1.voterId, vid].sort().join("|");
        if (!processed.has(key)) {
          processed.add(key);
          matches.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            user1Id: s1.voterId, user2Id: vid,
            calculatedAt: new Date().toISOString(),
            user1Response: "pending", user2Response: "pending",
          });
        }
      }
    }
  }
  return matches;
}

/* ================================================================
   공개 API
================================================================ */
export const adminApi = {
  /* ── 세션 ── */
  hasSession(): boolean {
    return localStorage.getItem(SESSION_KEY) === "1";
  },

  async login(pw: string): Promise<void> {
    if (pw !== ADMIN_PW) throw new Error("wrong password");
    localStorage.setItem(SESSION_KEY, "1");
  },

  logout(): void {
    localStorage.removeItem(SESSION_KEY);
  },

  /* ── 신청자 ── */
  async listApplicants(): Promise<ReturnType<typeof toSnake>[]> {
    return load<RawApp[]>(APP_KEY, []).map(toSnake);
  },

  async updateStatus(id: string, status: string): Promise<void> {
    const apps = load<RawApp[]>(APP_KEY, []);
    save(APP_KEY, apps.map(a => a.id === id ? { ...a, status } : a));
  },

  async markSmsSent(id: string): Promise<void> {
    const apps = load<RawApp[]>(APP_KEY, []);
    save(APP_KEY, apps.map(a => a.id === id ? { ...a, smsSent: true } : a));
  },

  /* ── 투표 제출 결과 ── */
  async getVoteResults(): Promise<{ voter_id: string; voted_for_ids: string[] }[]> {
    return load<RawSub[]>(SUBS_KEY, []).map(subToSnake);
  },

  /* ── 매칭 ── */
  async getMatches(): Promise<ReturnType<typeof matchToSnake>[]> {
    return load<RawMatch[]>(MATCHES_KEY, []).map(matchToSnake);
  },

  /* ── 투표 운영 설정 ── */
  async getVoteSettings(): Promise<AdminVoteSettings> {
    return loadSettings();
  },

  async toggleVoteOpen(open: boolean): Promise<void> {
    save(SETTINGS_KEY, { ...loadSettings(), is_open: open });
  },

  async toggleGenderOpen(gender: string, open: boolean): Promise<void> {
    const s = loadSettings();
    if (gender === "남성") save(SETTINGS_KEY, { ...s, male_open: open });
    else                   save(SETTINGS_KEY, { ...s, female_open: open });
  },

  async closeVoting(): Promise<void> {
    const subs = load<RawSub[]>(SUBS_KEY, []);
    const matches = computeMatches(subs);
    save(MATCHES_KEY, matches);
    save(SETTINGS_KEY, {
      ...loadSettings(),
      is_open: false, is_closed: true,
      closed_at: new Date().toISOString(),
    });
  },
};
