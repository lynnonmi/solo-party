import React, { useState, useRef, useEffect, ChangeEvent, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  ChevronLeft, ChevronRight, Copy, CheckCheck, Heart, X, Check,
  Plus, LogOut, ClipboardList, ChevronDown, ChevronUp,
  Eye, EyeOff, AlertCircle, MessageSquare,
  Camera
} from "lucide-react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import posterImage from "@/imports/Group_5_mobile.jpg";

/* ═══════════════════════════════════════════
   SUPABASE CLIENT
═══════════════════════════════════════════ */
const SB_URL = (() => {
  let url = ((import.meta.env.VITE_SUPABASE_URL as string) ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/rest\/v1\/?/gi, "/")
    .replace(/\/+$/, "");
  url = url.replace(/^(https?:)\/(?!\/)/i, "$1//");
  return url;
})();
const SB_ANON = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "")
  .trim()
  .replace(/^["']|["']$/g, "");
const SB_READY = /^https:\/\//i.test(SB_URL);

const _sbCache: Record<string, ReturnType<typeof createClient>> = {};

function getSupabase(sessionToken?: string | null) {
  const token = sessionToken || (typeof window !== "undefined" ? localStorage.getItem("sp_voter_token") : null) || "";
  if (!SB_READY) {
    // Supabase 미설정 시 호출을 조용히 무시하는 더미 클라이언트 반환
    const nullRes = { data: null, error: null };
    const emptyRes = { data: [], error: null };
    const chain: Record<string, () => unknown> = {};
    const leaf = () => Promise.resolve(nullRes);
    const arrLeaf = () => Promise.resolve(emptyRes);
    // Build a chainable no-op that handles the most common Supabase query patterns
    const q = (): unknown => new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return undefined; // not a thenable itself
        if (["single","maybeSingle"].includes(prop as string)) return () => Promise.resolve(nullRes);
        if (["select","insert","update","delete","upsert","eq","neq","in","gte","lte","order","limit"].includes(prop as string)) return () => q();
        return () => Promise.resolve(emptyRes);
      },
    });
    return {
      from: () => q(),
      rpc: async () => emptyRes,
    } as unknown as ReturnType<typeof createClient>;
  }
  const cacheKey = token;
  if (!_sbCache[cacheKey]) {
    _sbCache[cacheKey] = createClient(SB_URL, SB_ANON, {
      global: { headers: token ? { "x-session-token": token } : {} },
    });
  }
  return _sbCache[cacheKey];
}

function voteRpcErrorMessage(msg: string | undefined, fallback: string): string {
  const m = msg ?? "";
  if (m.includes("PGRST202") || m.includes("submit_single_vote") || m.includes("get_my_votes") || m.includes("get_votes_for_me")) {
    return "투표 기능 DB 설정이 필요합니다. 터미널에서 npm run db:push 를 실행해주세요.";
  }
  if (m.includes("vote not open")) return "지금은 투표할 수 없습니다. 관리자가 투표를 열어야 합니다.";
  if (m.includes("max 4")) return "투표는 최대 4명까지 가능합니다.";
  if (m.includes("message required")) return "쪽지를 입력해주세요.";
  if (m.includes("message too long")) return "쪽지는 200자 이내로 입력해주세요.";
  if (m.includes("invalid target")) return "투표할 수 없는 대상입니다.";
  if (m.includes("unauthorized")) return "로그인이 만료되었습니다. 다시 로그인해주세요.";
  return fallback;
}

function CsFooter({ className = "" }: { className?: string }) {
  return (
    <div className={`text-center pt-6 ${className}`}>
      <p className="text-xs text-muted-foreground mb-2">궁금한 점이 있으신가요?</p>
      <a
        href={CS_OPEN_CHAT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 text-sm text-primary hover:opacity-80 transition-opacity underline underline-offset-4">
        <MessageSquare className="w-3.5 h-3.5" />
        카카오 오픈채팅 고객센터
      </a>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TYPES
═══════════════════════════════════════════ */
type View = "home" | "apply" | "success" | "vote-login" | "vote-profile" | "vote" | "vote-result" | "my-app";
type Gender = "남성" | "여성";
type AppStatus = "pending" | "approved" | "rejected";
type GenderFilter = "전체" | "남성" | "여성";
type StatusFilter = "전체" | "pending" | "approved" | "rejected";
type MatchResponse = "pending" | "going" | "not-going";

interface ReceivedVote {
  voterId: string;
  nickname: string;
  gender: Gender;
  age: string;
  mbti: string;
  job: string;
  jobDetail?: string;
  currentWork: string;
  lifeGoal: string;
  hobbies: string;
  instagram: string;
  idealType: string;
  charm: string;
  celebrity: string;
  voteProfilePhoto?: string;
  photos: string[];
  message: string;
  createdAt: string;
}

interface Application {
  id: string;
  name: string;
  gender: Gender;
  age: string;
  nickname: string;
  mbti: string;
  contact: string;
  job: string;
  jobDetail?: string;
  currentWork: string;
  lifeGoal: string;
  hobbies: string;
  instagram: string;
  idealType: string;
  charm: string;
  celebrity: string;
  photos: string[];
  voteProfilePhoto?: string;
  refundBank: string;
  refundAccount: string;
  status: AppStatus;
  smsSent?: boolean;
  submittedAt: string;
}

interface VoteSubmission {
  id: string;
  voterId: string;
  votedForIds: string[];
  submittedAt: string;
}

interface VoteSettings {
  isOpen: boolean;
  isClosed: boolean;
  closedAt?: string;
  maleOpen: boolean;
  femaleOpen: boolean;
}

interface Match {
  id: string;
  user1Id: string;
  user2Id: string;
  calculatedAt: string;
  user1Response: MatchResponse;
  user2Response: MatchResponse;
}

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const MAX_PHOTOS       = 3;
const MAX_VOTES        = 4;
const MAX_VOTE_MESSAGE = 200;
const SMS_TEXT        = "승인문자";

const MBTI_LIST = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];
const JOB_LIST  = ["대학생","대학원생","직장인","취업 준비 중","이직 준비 중","기타"];
const AGE_LIST  = Array.from({ length: 10 }, (_, i) => ({ age: 20 + i, birth: 2027 - (20 + i) }));

const PHASE2_START = new Date("2026-08-02T12:00:00+09:00");
const PHASE1_START = new Date("2026-07-19T18:00:00+09:00");
const EVENT_START  = new Date("2026-08-09T17:00:00+09:00");
const CS_OPEN_CHAT_URL = "https://open.kakao.com/o/s9r5ORCi";
const now_         = new Date();
const currentPrice = () => now_ >= PHASE2_START ? "45,000원" : "43,000원";

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
async function fileToBlob(file: File): Promise<Blob> {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1200, s = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * s; c.height = img.height * s;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => { if (blob) res(blob); }, "image/jpeg", 0.88);
    };
    img.src = url;
  });
}

function photoDisplayUrl(url: string, width = 600): string {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;
  return url.replace("/object/public/", "/render/image/public/") + `?width=${width}&quality=88&resize=cover`;
}

function resolveVoteView(app: Application, settings: VoteSettings): View | null {
  if (settings.isClosed) return "vote-result";
  if (settings.isOpen) {
    if (app.voteProfilePhoto) return "vote";
    return "vote-profile";
  }
  return null;
}

function VotePhoto({ src, alt, className, width = 400 }: {
  src: string; alt: string; className?: string; width?: number;
}) {
  return (
    <img
      src={photoDisplayUrl(src, width)}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

function getProfilePhoto(app: Partial<Application>): string | null {
  return app.voteProfilePhoto || app.photos?.[0] || null;
}

function normalizeContact(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("10")) d = "0" + d;
  if (d.length === 12 && d.startsWith("82")) d = "0" + d.slice(2);
  return d;
}


/* ═══════════════════════════════════════════
   APP ROOT
═══════════════════════════════════════════ */
export default function App() {
  const [view,         setView]         = useState<View>("home");
  const [voter,        setVoter]        = useState<Application | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [settings,     setSettings]     = useState<VoteSettings>({ isOpen: false, isClosed: false, maleOpen: true, femaleOpen: true });
  const [appLoading,   setAppLoading]   = useState(true);

  const go = (v: View) => { window.scrollTo(0, 0); setView(v); };

  const fetchGlobalSettings = async () => {
    try {
      const { data, error } = await getSupabase().from("vote_settings").select("*").maybeSingle();
      if (data && !error) {
        setSettings({
          isOpen: data.is_open,
          isClosed: data.is_closed,
          closedAt: data.closed_at,
          maleOpen: data.male_open ?? true,
          femaleOpen: data.female_open ?? true
        });
        return data;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  useEffect(() => {
    const initApp = async () => {
      const currentSettings = await fetchGlobalSettings();
      const savedToken = localStorage.getItem("sp_voter_token");
      
      if (savedToken) {
        try {
          const { data, error } = await getSupabase(savedToken).rpc("get_my_application");
          if (data && data.length > 0 && !error) {
            const row = data[0];
            const app: Application = {
              id: row.id,
              name: row.name || "",
              gender: row.gender as Gender,
              age: String(row.age || ""),
              nickname: row.nickname || "",
              mbti: row.mbti || "",
              contact: row.contact || "",
              job: row.job || "",
              jobDetail: row.job_detail,
              currentWork: row.current_work || "",
              lifeGoal: row.life_goal || "",
              hobbies: row.alone_time || "",
              instagram: row.instagram || "",
              idealType: row.ideal_type || "",
              charm: row.charm || "",
              celebrity: row.celebrity || "",
              photos: row.photos || [],
              voteProfilePhoto: row.vote_profile_photo || undefined,
              refundBank: row.refund_bank || "",
              refundAccount: row.refund_account || "",
              status: row.status as AppStatus,
              submittedAt: row.submitted_at || "",
            };
            setVoter(app);
            setSessionToken(savedToken);

            const voteSettings: VoteSettings = {
              isOpen: currentSettings?.is_open ?? false,
              isClosed: currentSettings?.is_closed ?? false,
              closedAt: currentSettings?.closed_at,
              maleOpen: currentSettings?.male_open ?? true,
              femaleOpen: currentSettings?.female_open ?? true,
            };
            setView(resolveVoteView(app, voteSettings) ?? "home");
          } else {
            localStorage.removeItem("sp_voter_token");
          }
        } catch {
          localStorage.removeItem("sp_voter_token");
        }
      } else if (currentSettings?.is_open || currentSettings?.is_closed) {
        setView("vote-login");
      }
      setAppLoading(false);
    };
    initApp();
  }, []);

  useEffect(() => {
    const poll = setInterval(fetchGlobalSettings, 15000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchGlobalSettings(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  useEffect(() => {
    if (appLoading || !voter) return;
    if (settings.isClosed && (view === "vote" || view === "vote-profile")) {
      go("vote-result");
    }
  }, [settings.isClosed, voter, view, appLoading]);

  useEffect(() => {
    if (appLoading || view !== "home" || !voter) return;
    const next = resolveVoteView(voter, settings);
    if (next) go(next);
  }, [appLoading, voter, view, settings]);

  const handleVoteLogin = (a: Application, token: string) => {
    setVoter(a);
    setSessionToken(token);
    localStorage.setItem("sp_voter_token", token);
    go(resolveVoteView(a, settings) ?? "home");
  };

  const handleLogout = () => {
    setVoter(null);
    setSessionToken(null);
    localStorage.removeItem("sp_voter_token");
    go("home");
  };

  if (appLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">로딩 중...</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {view === "home"         && <HomePage go={go} settings={settings} refreshSettings={fetchGlobalSettings} hasVoter={!!voter} onVote={() => voter ? go(resolveVoteView(voter, settings) ?? "vote-login") : go("vote-login")} />}
      {view === "apply"        && <ApplyPage go={go} settings={settings} />}
      {view === "success"      && <SuccessPage go={go} />}
      {view === "vote-login"   && <VoteLoginPage go={go} onLogin={handleVoteLogin} settings={settings} />}
      {view === "vote-profile" && voter && <VoteProfilePage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} onLogout={handleLogout} />}
      {view === "vote"         && voter && <VotePage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} onLogout={handleLogout} />}
      {view === "vote-result"  && voter && <VoteResultPage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} onLogout={handleLogout} />}
      {view === "my-app"       && voter && <MyApplicationPage voter={voter} onBack={() => go(resolveVoteView(voter, settings) ?? "home")} />}
    </div>
  );
}

function getRecruitmentChips(
  now: Date,
  phaseStart: Date,
  phaseEnd: Date,
  maleOpen: boolean,
  femaleOpen: boolean,
): { label: string; color: "pink" | "gray" }[] {
  if (now < phaseStart) return [{ label: "예정", color: "gray" }];
  if (now >= phaseEnd) return [{ label: "마감", color: "gray" }];
  if (maleOpen && femaleOpen) return [{ label: "모집 중", color: "pink" }];
  if (!maleOpen && !femaleOpen) return [{ label: "마감", color: "gray" }];
  if (!maleOpen && femaleOpen) {
    return [
      { label: "남성 모집 마감", color: "gray" },
      { label: "여성 모집 중", color: "pink" },
    ];
  }
  return [
    { label: "여성 모집 마감", color: "gray" },
    { label: "남성 모집 중", color: "pink" },
  ];
}

function RecruitmentChips({ now, phaseStart, phaseEnd, maleOpen, femaleOpen }: {
  now: Date; phaseStart: Date; phaseEnd: Date; maleOpen: boolean; femaleOpen: boolean;
}) {
  const chips = getRecruitmentChips(now, phaseStart, phaseEnd, maleOpen, femaleOpen);
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      {chips.map((chip) => (
        <Chip key={chip.label} color={chip.color}>{chip.label}</Chip>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════ */
function HomePage({ go, settings, refreshSettings, hasVoter, onVote }: { go: (v: View) => void; settings: VoteSettings; refreshSettings: () => Promise<any>; hasVoter: boolean; onVote: () => void }) {
  const [copied,   setCopied]   = useState(false);

  useEffect(() => { refreshSettings(); }, []);

  const now = new Date();

  const copy = () => {
    navigator.clipboard.writeText("65201536202013").catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const voteText   = settings.isClosed ? "결과 확인하기" : settings.isOpen ? "투표하기" : "투표 준비 중";
  const voteActive = settings.isClosed || settings.isOpen;
  const intakeOpen = settings.maleOpen || settings.femaleOpen;
  const voteRunning = settings.isOpen;

  const firstLabel = voteRunning
    ? "내 신청서 확인하기"
    : intakeOpen
      ? "참가 신청하기"
      : "신청 마감";
  const firstAction = () => {
    if (voteRunning) {
      if (hasVoter) go("my-app");
      else go("vote-login");
    } else if (intakeOpen) {
      go("apply");
    }
  };
  const firstDisabled = !voteRunning && !intakeOpen;

  const buttons = (
    <div className="space-y-3 w-full">
      <button
        onClick={firstAction}
        disabled={firstDisabled}
        className={`w-full py-4 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
          voteRunning
            ? "bg-[#080808] border-[1.5px] border-[#F0A8BE] text-[#F0A8BE] hover:bg-[rgba(240,168,190,0.08)]"
            : "bg-[#F0A8BE] text-[#080808] hover:opacity-90"
        }`}>
        {firstLabel}
      </button>
      <button
        onClick={() => voteActive && onVote()}
        disabled={!voteActive}
        className={`w-full py-4 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98] ${
          voteRunning
            ? "bg-[#F0A8BE] text-[#080808] hover:opacity-90 cursor-pointer"
            : voteActive
              ? "bg-transparent border-[1.5px] border-[#F0A8BE] text-[#F0A8BE] hover:bg-[rgba(240,168,190,0.08)] cursor-pointer"
              : "bg-[#1A1A1A] border-[1.5px] border-[rgba(240,168,190,0.35)] text-[#888888] cursor-not-allowed"
        }`}>
        {voteText}
      </button>
    </div>
  );

  if (voteRunning) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col justify-center px-4 pb-16">
        <div className="w-full flex justify-center pb-6">
          <ImageWithFallback
            src={posterImage}
            alt="THE SECOND SOLO PARTY"
            className="w-full max-w-xs object-contain"
            width={658}
            height={900}
            decoding="async"
            fetchPriority="high"
            loading="eager"
          />
        </div>
        {buttons}
        <CsFooter />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="w-full flex justify-center bg-background pt-6 pb-2 px-6">
        <ImageWithFallback
          src={posterImage}
          alt="THE SECOND SOLO PARTY"
          className="w-full max-w-xs object-contain"
          width={658}
          height={900}
          decoding="async"
          fetchPriority="high"
          loading="eager"
        />
      </div>

      <div className="px-4">
        <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-3 mt-5">
          <p className="text-[10px] tracking-normal uppercase text-primary mb-4">모집 일정</p>
          <div className="space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 pr-2">
                <p className="text-sm font-semibold">1차 모집</p>
                <p className="text-xs text-muted-foreground mt-0.5">7월 19일 (일) 오후 6시 오픈</p>
                <p className="text-xs text-muted-foreground">인원 마감 시 모집 종료</p>
              </div>
              <RecruitmentChips
                now={now}
                phaseStart={PHASE1_START}
                phaseEnd={PHASE2_START}
                maleOpen={settings.maleOpen}
                femaleOpen={settings.femaleOpen}
              />
            </div>
            <div className="h-px bg-[rgba(240,168,190,0.20)]" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 pr-2">
                <p className="text-sm font-semibold">2차 모집</p>
                <p className="text-xs text-muted-foreground mt-0.5">8월 2일 (일) 오후 12시 오픈</p>
              </div>
              <RecruitmentChips
                now={now}
                phaseStart={PHASE2_START}
                phaseEnd={EVENT_START}
                maleOpen={settings.maleOpen}
                femaleOpen={settings.femaleOpen}
              />
            </div>
          </div>
        </div>

        <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-3">
          <p className="text-[10px] tracking-normal uppercase text-primary mb-4">이벤트 정보</p>
          <div className="space-y-3.5">
            <Row label="일정">
              <div className="text-right">
                <p className="text-sm font-medium">2026년 8월 9일 (일)</p>
                <p className="text-xs text-muted-foreground mt-0.5">오후 5시 - 오후 11시</p>
              </div>
            </Row>
            <div className="h-px bg-[rgba(240,168,190,0.20)]" />
            <Row label="참가비">
              <div className="text-right">
                <span className="text-sm font-semibold text-primary">{currentPrice()}</span>
                <p className="text-xs text-muted-foreground mt-0.5">추가 비용 없음</p>
              </div>
            </Row>
            <div className="h-px bg-[rgba(240,168,190,0.20)]" />
            <Row label="입금 계좌">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">기업은행 · 김해린</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>65201536202013</p>
                  <button onClick={copy} className="text-primary transition-opacity hover:opacity-70">
                    {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </Row>
          </div>
        </div>

        <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-6">
          <p className="text-[10px] tracking-normal uppercase text-primary mb-3.5">환불 안내</p>
          <div className="space-y-2.5">
            <NoticeItem icon={<Check className="w-3 h-3 text-[#F0A8BE]" />} iconBg="bg-[rgba(240,168,190,0.18)]">행사 <strong className="text-[#F5F0F2] font-semibold">7일 전까지</strong> 100% 환불</NoticeItem>
            <NoticeItem icon={<X className="w-3 h-3 text-[#D4183D]" />} iconBg="bg-[rgba(212,24,61,0.15)]">7일 이후 환불 불가</NoticeItem>
            <NoticeItem icon={<Check className="w-3 h-3 text-[#F0A8BE]" />} iconBg="bg-[rgba(240,168,190,0.18)]">승인 거절 시 100% 환불</NoticeItem>
          </div>
        </div>

        {buttons}
        <CsFooter className="pb-4" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   APPLY PAGE (5 steps)
═══════════════════════════════════════════ */
type FormData = Omit<Application, "id" | "status" | "submittedAt" | "smsSent" | "voteProfilePhoto">;
const emptyForm = (): Partial<FormData> => ({ gender: "남성", mbti: "", job: "", photos: [] });

function ApplyPage({ go, settings }: { go: (v: View) => void; settings: VoteSettings }) {
  const [step,          setStep]          = useState(1);
  const TOTAL = 5;
  const [form,          setForm]          = useState<Partial<FormData>>(emptyForm());
  const [errors,        setErrors]        = useState<Record<string, string>>({});
  const [loading,       setLoading]       = useState(false);
  const [termsAgreed,   setTermsAgreed]   = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState<boolean | null>(null);
  const [privacyOpen,   setPrivacyOpen]   = useState(false);
  const [uploadFiles,   setUploadFiles]   = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof FormData, v: string | string[]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const handlePhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const canAdd = MAX_PHOTOS - uploadFiles.length;
    if (canAdd <= 0) return;
    
    const addedFiles = files.slice(0, canAdd);
    const newFiles = [...uploadFiles, ...addedFiles];
    setUploadFiles(newFiles);
    
    const previews = newFiles.map(f => URL.createObjectURL(f));
    setForm((f) => ({ ...f, photos: previews }));
    setErrors((e) => ({ ...e, photos: "" }));
  };

  const removePhoto = (idx: number) => {
    const newFiles = uploadFiles.filter((_, i) => i !== idx);
    setUploadFiles(newFiles);
    const previews = newFiles.map(f => URL.createObjectURL(f));
    setForm((f) => ({ ...f, photos: previews }));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!form.name?.trim())    errs.name    = "이름을 입력해주세요.";
      if (!form.gender)          errs.gender  = "성별을 선택해주세요.";
      if (form.gender === "남성" && !settings.maleOpen) errs.gender = "현재 남성 신청은 마감되었습니다.";
      if (form.gender === "여성" && !settings.femaleOpen) errs.gender = "현재 여성 신청은 마감되었습니다.";
      if (!form.age)             errs.age     = "나이를 선택해주세요.";
      if (!form.nickname?.trim()) errs.nickname = "닉네임을 입력해주세요.";
      if (!form.mbti)            errs.mbti    = "MBTI를 선택해주세요.";
      if (!form.contact?.trim()) errs.contact  = "연락처를 입력해주세요.";
      if (!form.job)             errs.job     = "현재 상태를 선택해주세요.";
      if (form.job === "기타" && !form.jobDetail?.trim()) errs.jobDetail = "직접 입력해주세요.";
    } else if (step === 2) {
      if (!form.currentWork?.trim()) errs.currentWork = "답변을 입력해주세요.";
      if (!form.lifeGoal?.trim())    errs.lifeGoal    = "답변을 입력해주세요.";
      if (!form.hobbies?.trim())     errs.hobbies     = "답변을 입력해주세요.";
      if (!form.instagram?.trim())   errs.instagram   = "인스타그램 ID를 입력해주세요.";
    } else if (step === 3) {
      if (!form.idealType?.trim())  errs.idealType  = "답변을 입력해주세요.";
      if (!form.charm?.trim())      errs.charm      = "답변을 입력해주세요.";
      if (!form.celebrity?.trim())  errs.celebrity  = "답변을 입력해주세요.";
    } else if (step === 4) {
      if (!uploadFiles.length)        errs.photos       = "사진을 최소 1장 업로드해주세요.";
      if (!form.refundBank?.trim())    errs.refundBank   = "환불 은행을 입력해주세요.";
      if (!form.refundAccount?.trim()) errs.refundAccount = "환불 계좌번호를 입력해주세요.";
    } else if (step === 5) {
      if (!termsAgreed)           errs.terms   = "이용약관에 동의해주세요.";
      if (privacyAgreed !== true) errs.privacy = "개인정보 수집 이용에 동의해주세요.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (!validate()) return;
    if (step < TOTAL) { setStep((s) => s + 1); window.scrollTo(0, 0); }
    else submit();
  };

  const submit = async () => {
    setLoading(true);
    try {
      if (!SB_READY) {
        setErrors({ global: "Supabase가 연결되지 않았습니다. 관리자에게 문의해 주세요." });
        return;
      }

      const uploadedUrls: string[] = [];
      const supabase = getSupabase();
      for (const file of uploadFiles) {
        const compressedBlob = await fileToBlob(file);
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from("applicants")
          .upload(filename, compressedBlob, { contentType: "image/jpeg" });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from("applicants").getPublicUrl(filename);
        uploadedUrls.push(publicUrl);
      }

      const { error: insertErr } = await supabase.from("applicants").insert({
        name: form.name!.trim(), gender: form.gender, age: parseInt(form.age!, 10),
        nickname: form.nickname!.trim(), mbti: form.mbti, contact: normalizeContact(form.contact!.trim()),
        job: form.job, job_detail: form.jobDetail?.trim(),
        current_work: form.currentWork!.trim(), life_goal: form.lifeGoal!.trim(),
        alone_time: form.hobbies!.trim(), instagram: form.instagram!.trim(),
        ideal_type: form.idealType!.trim(), charm: form.charm!.trim(),
        celebrity: form.celebrity!.trim(), photos: uploadedUrls,
        refund_bank: form.refundBank!.trim(), refund_account: form.refundAccount!.trim(),
        status: "pending",
        fee_confirmed: !!(form as Record<string, unknown>).feeConfirmed,
      });
      if (insertErr) throw insertErr;
      go("success");
    } catch (e) {
      console.error(e);
      setErrors({ global: "신청서 제출 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      setLoading(false);
    }
  };

  const stepLabels = ["기본 정보", "자기소개", "호감 포인트", "사진 & 환불", "약관 동의"];

  return (
    <div className="max-w-md mx-auto pb-16 px-4">
      <div className="flex items-center gap-4 pt-6 pb-6">
        <button onClick={() => { if (step > 1) { setStep((s) => s - 1); window.scrollTo(0, 0); } else go("home"); }}
          className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">STEP {step} / {TOTAL}</p>
          <p className="text-sm font-semibold mt-0.5">{stepLabels[step - 1]}</p>
        </div>
      </div>

      <div className="flex gap-1.5 mb-8">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{ background: i < step ? "var(--primary)" : "var(--border)" }} />
        ))}
      </div>

      {errors.global && (
        <div className="mb-4 flex items-start gap-2 bg-destructive/10 rounded-xl p-3.5 border border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{errors.global}</p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <FormField label="이름 (주민등록상 이름)" required error={errors.name}>
            <FInput placeholder="홍길동" value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField label="성별" required error={errors.gender}>
            <div className="flex gap-3">
              {(["남성", "여성"] as Gender[]).map((g) => {
                const isClosed = g === "남성" ? !settings.maleOpen : !settings.femaleOpen;
                return (
                  <button key={g} type="button" onClick={() => !isClosed && set("gender", g)} disabled={isClosed}
                    className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all flex flex-col items-center justify-center ${
                      form.gender === g ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground"
                    } ${isClosed ? "opacity-40 cursor-not-allowed bg-muted" : ""}`}>
                    <span>{g}</span>
                    {isClosed && <span className="text-[10px] text-destructive font-normal mt-0.5">마감됨</span>}
                  </button>
                );
              })}
            </div>
          </FormField>
          <FormField label="나이" required error={errors.age} hint="20세 (2007년생) - 29세 (1998년생)">
            <FSelect value={form.age || ""} onChange={(e) => { set("age", e.target.value); setErrors((er) => ({ ...er, age: "" })); }}>
              <option value="">나이 선택</option>
              {AGE_LIST.map(({ age, birth }) => <option key={age} value={String(age)}>{age}세 ({birth}년생)</option>)}
            </FSelect>
          </FormField>
          <FormField label="파티에서 사용할 닉네임" required error={errors.nickname}>
            <FInput placeholder="예: 별이" value={form.nickname || ""} onChange={(e) => set("nickname", e.target.value)} />
          </FormField>
          <FormField label="MBTI" required error={errors.mbti}>
            <FSelect value={form.mbti || ""} onChange={(e) => set("mbti", e.target.value)}>
              <option value="">선택해주세요</option>
              {MBTI_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
            </FSelect>
          </FormField>
          <FormField label="연락처" required error={errors.contact}>
            <FInput placeholder="01000000000" type="tel" value={form.contact || ""} onChange={(e) => set("contact", e.target.value)} />
          </FormField>
          <FormField label="현재 상태" required error={errors.job}>
            <div className="grid grid-cols-2 gap-2">
              {JOB_LIST.map((j) => (
                <button key={j} type="button" onClick={() => set("job", j)}
                  className={`py-2.5 px-3 rounded-xl border text-sm text-left transition-all ${form.job === j ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground"}`}>
                  {j}
                </button>
              ))}
            </div>
          </FormField>
          {form.job === "기타" && (
            <FormField label="현재 상태 (기타)" required error={errors.jobDetail}>
              <FInput placeholder="직접 입력해주세요" value={form.jobDetail || ""} onChange={(e) => set("jobDetail", e.target.value)} />
            </FormField>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="bg-primary/8 border border-primary/20 rounded-xl px-4 py-3.5">
            <p className="text-sm text-primary/90 leading-relaxed">이번 행사에 함께할 분들을 더 잘 알아가기 위해 몇 가지 질문을 준비했습니다. 정답은 없으니 편하고 솔직하게 작성해주세요.</p>
          </div>
          <FormField label="요즘 어떤 삶을 살고 있나요?" hint="공부, 일, 대외활동, 취미 등" required error={errors.currentWork}>
            <FTextarea placeholder="" value={form.currentWork || ""} onChange={(e) => set("currentWork", e.target.value)} />
          </FormField>
          <FormField label="이루고 싶은 삶" required error={errors.lifeGoal}>
            <FTextarea placeholder="" value={form.lifeGoal || ""} onChange={(e) => set("lifeGoal", e.target.value)} />
          </FormField>
          <FormField label="혼자 있을 때 무엇을 하며 시간을 보내나요?" required error={errors.hobbies}>
            <FTextarea placeholder="" value={form.hobbies || ""} onChange={(e) => set("hobbies", e.target.value)} />
          </FormField>
          <FormField label="인스타그램 ID" required error={errors.instagram}>
            <FInput placeholder="@ 없이 입력" value={form.instagram || ""} onChange={(e) => set("instagram", e.target.value)} />
          </FormField>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <FormField label="어떤 사람에게 끌리나요? (이상형 등)" required error={errors.idealType}>
            <FTextarea placeholder="" value={form.idealType || ""} onChange={(e) => set("idealType", e.target.value)} />
          </FormField>
          <FormField label="사람들이 자주 말하는 나의 장점은?" required error={errors.charm}>
            <FTextarea placeholder="" value={form.charm || ""} onChange={(e) => set("charm", e.target.value)} />
          </FormField>
          <FormField label="자주 듣는 닮은 꼴" required error={errors.celebrity} hint="연예인, 캐릭터, 동물 등">
            <FInput placeholder="" value={form.celebrity || ""} onChange={(e) => set("celebrity", e.target.value)} />
          </FormField>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <FormField label="본인 사진" hint={`1~${MAX_PHOTOS}장`} required error={errors.photos}>
            <div className="bg-muted/40 rounded-xl border border-dashed border-border p-4 space-y-3">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotos} />
              {form.photos && form.photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {form.photos.map((p, i) => (
                    <div key={i} className="relative aspect-square">
                      <img src={p} alt={`사진 ${i + 1}`} className="w-full h-full object-cover rounded-lg" />
                      <button type="button" onClick={() => removePhoto(i)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"><X className="w-3 h-3 text-white" /></button>
                    </div>
                  ))}
                  {form.photos.length < MAX_PHOTOS && (
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="aspect-square rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary hover:border-primary transition-colors">
                      <Plus className="w-5 h-5" /><span className="text-xs">추가</span>
                    </button>
                  )}
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full py-5 rounded-xl border border-border flex flex-col items-center gap-2 text-muted-foreground hover:text-primary hover:border-primary transition-colors">
                  <Plus className="w-6 h-6" /><span className="text-sm">사진 선택하기</span>
                  <span className="text-xs">최대 {MAX_PHOTOS}장</span>
                </button>
              )}
            </div>
          </FormField>
          <div className="bg-[#131313] rounded-xl border border-[rgba(240,168,190,0.30)] p-4">
            <p className="text-xs tracking-widest uppercase text-primary mb-3">참가비 안내</p>
            <div className="space-y-2 text-sm">
              <Row label="금액"><div className="text-right"><span className="font-semibold text-primary">{currentPrice()}</span><p className="text-xs text-muted-foreground mt-0.5">추가 비용 없음</p></div></Row>
              <Row label="계좌"><span className="text-right text-xs leading-relaxed">기업은행<br />65201536202013 (김해린)</span></Row>
            </div>
          </div>
          <FormField label="환불 은행" required error={errors.refundBank}>
            <FInput placeholder="예: 국민은행" value={form.refundBank || ""} onChange={(e) => set("refundBank", e.target.value)} />
          </FormField>
          <FormField label="환불 계좌번호" required error={errors.refundAccount}>
            <FInput placeholder="숫자만 입력" value={form.refundAccount || ""} onChange={(e) => set("refundAccount", e.target.value)} />
          </FormField>
          <CheckRow checked={!!(form as Record<string, unknown>).feeConfirmed}
            onToggle={() => setForm((f) => ({ ...f, feeConfirmed: !(f as Record<string, unknown>).feeConfirmed } as Partial<FormData>))}
            label={`참가비(${currentPrice()})를 입금하였습니다.`} />
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold mb-3">이용약관</p>
            <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4 text-xs text-muted-foreground space-y-4 leading-relaxed max-h-80 overflow-y-auto">
              <section>
                <p className="text-foreground font-semibold text-sm mb-2">1. 환불 정책</p>
                <div className="space-y-1.5">
                  <p>행사 7일 전까지 환불 신청 시 100% 환불됩니다.</p>
                  <p>7일 이내에는 환불이 불가합니다.</p>
                  <p>운영진의 판단으로 승인이 거절된 경우에는 100% 환불됩니다.</p>
                </div>
              </section>
              <section>
                <p className="text-foreground font-semibold text-sm mb-2">2. 촬영 안내</p>
                <div className="space-y-1.5">
                  <p>파티 진행 중 스탭이 현장을 촬영하는 경우가 있습니다.</p>
                  <p>참가자가 촬영 영상에 포함될 경우 모자이크 처리됩니다.</p>
                  <p>촬영된 콘텐츠는 김해린 채널에 업로드될 수 있으나, 개인 식별 정보는 절대 노출되지 않으니 걱정하지 않으셔도 됩니다.</p>
                </div>
              </section>
              <section>
                <p className="text-foreground font-semibold text-sm mb-2">3. 사고 책임</p>
                <p>참가자는 행사 중 본인의 안전에 유의해야 하며, 개인 부주의로 발생한 사고에 대해서는 본인이 책임을 집니다.</p>
              </section>
              <section>
                <p className="text-foreground font-semibold text-sm mb-2">4. 행동 수칙</p>
                <div className="space-y-1.5">
                  <p>만취 상태이거나 타인에게 불쾌감 또는 피해를 주는 행동을 하는 경우 즉시 퇴장 조치될 수 있습니다.</p>
                  <p>모두가 즐거운 파티를 위해 상호 존중을 부탁드립니다.</p>
                </div>
              </section>
              <section>
                <p className="text-foreground font-semibold text-sm mb-2">5. 승인 안내</p>
                <div className="space-y-1.5">
                  <p>신청 완료 후 승인이 되면 문자로 안내 사항이 발송됩니다.</p>
                  <p>발송은 24시간 이내로 예정되어 있습니다.</p>
                  <p>원활한 운영을 위해 신청 내용을 검토하는 시간이 필요합니다.</p>
                  <p>24시간 이후에도 안내 문자가 오지 않는 경우{" "}
                    <a href={CS_OPEN_CHAT_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
                      고객센터
                    </a>
                    로 문의해주세요.
                  </p>
                </div>
              </section>
            </div>
          </div>
          <CheckRow checked={termsAgreed} onToggle={() => { setTermsAgreed(!termsAgreed); setErrors((e) => ({ ...e, terms: "" })); }} label="위 이용약관을 모두 읽었으며 동의합니다." error={errors.terms} />
          <div className="border-t border-border pt-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">개인정보 수집 이용 동의서</p>
              <button type="button" onClick={() => setPrivacyOpen(true)} className="text-xs text-primary border border-primary/40 rounded-lg px-3 py-1 hover:bg-primary/8 transition-colors">보기</button>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setPrivacyAgreed(true); setErrors((e) => ({ ...e, privacy: "" })); }}
                className={`flex-1 py-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition-all ${privacyAgreed === true ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground"}`}>
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${privacyAgreed === true ? "border-primary bg-primary" : "border-muted-foreground/50"}`}>{privacyAgreed === true && <Check className="w-2.5 h-2.5 text-white" />}</div>동의함
              </button>
              <button type="button" onClick={() => { setPrivacyAgreed(false); setErrors((e) => ({ ...e, privacy: "" })); }}
                className={`flex-1 py-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition-all ${privacyAgreed === false ? "border-destructive bg-destructive/8 text-destructive" : "border-border text-muted-foreground"}`}>
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${privacyAgreed === false ? "border-destructive bg-destructive" : "border-muted-foreground/50"}`}>{privacyAgreed === false && <X className="w-2.5 h-2.5 text-white" />}</div>동의하지 않음
              </button>
            </div>
            {privacyAgreed === false && <div className="mt-2.5 bg-destructive/10 border border-destructive/20 rounded-xl p-3"><p className="text-xs text-destructive">개인정보 수집 이용에 동의하지 않으시면 솔로파티 참가 신청이 불가합니다.</p></div>}
            {errors.privacy && <p className="text-xs text-destructive mt-1.5">{errors.privacy}</p>}
          </div>
        </div>
      )}

      <div className="mt-8">
        <button onClick={next} disabled={loading || (step === 5 && privacyAgreed === false)}
          className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50 flex items-center justify-center">
          {loading ? "처리 중..." : step === TOTAL ? "신청 완료" : "다음 단계"}
        </button>
      </div>
      <CsFooter className="pb-4" />

      {privacyOpen && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-end justify-center p-4" onClick={() => setPrivacyOpen(false)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-sm">개인정보 수집 이용 동의서</h3>
              <button onClick={() => setPrivacyOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 text-xs text-muted-foreground space-y-4 leading-relaxed max-h-[60vh] overflow-y-auto">
              <div>
                <p className="text-foreground font-medium mb-1">개인정보 처리자</p>
                <p>김해린</p>
              </div>
              <div>
                <p className="text-foreground font-medium mb-1">개인정보 수집 이용 목적</p>
                <p>솔로파티 참가자 승인 및 솔로파티 운영</p>
              </div>
              <div>
                <p className="text-foreground font-medium mb-1">수집하는 개인정보 항목</p>
                <p>실명, 성별, 나이, 파티에서 사용할 닉네임, MBTI, 연락처, 현재 직업, 현재 하고 있는 일, 삶의 목표, 쉴 때 하는 일, 인스타그램 아이디, 이상형, 본인의 매력, 닮은 꼴 연예인, 본인 사진, 환불 은행, 환불 계좌번호</p>
              </div>
              <div>
                <p className="text-foreground font-medium mb-1">개인정보의 보유 및 이용 기간</p>
                <p>2026년 8월 30일까지</p>
              </div>
              <div>
                <p className="text-foreground font-medium mb-1">동의 거부권 및 동의 거부에 따른 불이익</p>
                <p>위 개인정보의 수집 및 이용에 동의를 거부할 권리가 있습니다. 동의를 거부할 경우 솔로파티 참가 신청이 자동으로 취소됩니다.</p>
              </div>
              <p className="text-foreground pt-1">위 내용에 따라 개인정보를 수집하고 이용하는 데 동의합니다.</p>
            </div>
            <div className="px-5 py-4 border-t border-border">
              <button onClick={() => setPrivacyOpen(false)} className="w-full py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUCCESS PAGE
═══════════════════════════════════════════ */
function SuccessPage({ go }: { go: (v: View) => void }) {
  return (
    <div className="max-w-md mx-auto px-4 pt-24 pb-16 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
        <Heart className="w-9 h-9 fill-primary text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2">신청 완료!</h2>
      <p className="text-muted-foreground text-sm leading-relaxed mb-8">참가 신청이 접수되었습니다.<br />운영진 검토 후 24시간 이내에 결과를 문자로 안내드립니다.</p>
      <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] text-left mb-8">
        <p className="text-[10px] tracking-[0.35em] uppercase text-primary mb-3.5">입금 안내</p>
        <div className="space-y-3">
          <Row label="참가비"><div className="text-right"><span className="font-semibold text-primary">{currentPrice()}</span><p className="text-xs text-muted-foreground mt-0.5">추가 비용 없음</p></div></Row>
          <div className="h-px bg-border" />
          <Row label="입금 계좌"><div className="text-right text-sm"><p>기업은행 65201536202013</p><p className="text-xs text-muted-foreground mt-0.5">김해린</p></div></Row>
        </div>
      </div>
      <button onClick={() => go("home")} className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity">홈으로</button>
      <CsFooter />
    </div>
  );
}

/* ═══════════════════════════════════════════
   VOTE LOGIN PAGE
═══════════════════════════════════════════ */
function VoteLoginPage({ go, onLogin, settings }: { go: (v: View) => void; onLogin: (a: Application, token: string) => void; settings: VoteSettings }) {
  const [name,    setName]    = useState("");
  const [contact, setContact] = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!name.trim() || !contact.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcErr } = await getSupabase().rpc("verify_applicant", {
        p_name:    name.trim(),
        p_contact: normalizeContact(contact.trim()),
      });
      if (rpcErr) {
        setError("로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      if (!data?.length) {
        setError("이름과 연락처가 일치하는 승인된 참가자를 찾을 수 없습니다. 신청 시 입력한 이름(주민등록상)과 연락처를 확인해주세요.");
        return;
      }
      const row = data[0];
      const app: Application = {
        id:                row.id,
        name:              row.name || "",
        gender:            row.gender as Gender,
        age:               String(row.age || ""),
        nickname:          row.nickname || "",
        mbti:              row.mbti || "",
        contact:           row.contact || "",
        job:               row.job || "",
        jobDetail:         row.job_detail,
        currentWork:       row.current_work || "",
        lifeGoal:          row.life_goal || "",
        hobbies:           row.alone_time || "",
        instagram:         row.instagram || "",
        idealType:         row.ideal_type || "",
        charm:             row.charm || "",
        celebrity:         row.celebrity || "",
        photos:            row.photos ?? [],
        voteProfilePhoto:  row.vote_profile_photo ?? undefined,
        refundBank:        row.refund_bank || "",
        refundAccount:     row.refund_account || "",
        status:            "approved",
        submittedAt:       row.submitted_at || "",
      };
      onLogin(app, row.session_token as string);
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center gap-4 pt-6 pb-8">
        <button onClick={() => go("home")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-lg font-semibold">{settings.isClosed ? "결과 확인" : "투표하기"}</h2>
      </div>
      <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground leading-relaxed">승인된 참가자만 이용할 수 있습니다.<br />신청서에 입력한 이름과 연락처를 입력해주세요.</p>
        </div>
      </div>
      <div className="space-y-4">
        <FormField label="이름">
          <FInput placeholder="홍길동" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </FormField>
        <FormField label="연락처">
          <FInput placeholder="01000000000" type="tel" value={contact} onChange={(e) => { setContact(e.target.value); setError(""); }} />
        </FormField>
        {error && (
          <div className="flex items-start gap-2 bg-destructive/10 rounded-xl p-3.5 border border-destructive/20">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        <button onClick={login} disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-2 disabled:opacity-50">
          {loading ? "확인 중..." : settings.isClosed ? "결과 확인하기" : "입장하기"}
        </button>
      </div>
      <CsFooter className="pb-8" />
    </div>
  );
}

/* ═══════════════════════════════════════════
   VOTE PROFILE PAGE
═══════════════════════════════════════════ */
function VoteProfilePage({ voter, go, onUpdate, sessionToken, onLogout }: {
  voter: Application; go: (v: View) => void;
  onUpdate: (a: Application) => void; sessionToken: string | null; onLogout: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(voter.voteProfilePhoto || voter.photos?.[0] || null);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState("");
  const sb = getSupabase(sessionToken);

  useEffect(() => {
    if (voter.voteProfilePhoto) go("vote");
  }, [voter.voteProfilePhoto, go]);

  const confirm = async () => {
    if (!selected || voter.voteProfilePhoto) return;
    setSaving(true);
    setSaveErr("");
    const { error } = await sb.rpc("update_vote_profile_photo", { p_photo_url: selected });
    if (error) {
      setSaveErr(error.message?.includes("profile already set")
        ? "프로필 사진은 한 번 설정하면 변경할 수 없습니다."
        : "사진 저장 중 오류가 발생했습니다.");
      setSaving(false);
      return;
    }
    onUpdate({ ...voter, voteProfilePhoto: selected });
    setSaving(false);
    go("vote");
  };

  if (voter.voteProfilePhoto) return null;

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center justify-between pt-6 pb-6">
        <div>
          <h2 className="text-lg font-semibold">프로필 사진 선택</h2>
          <p className="text-xs text-muted-foreground mt-0.5">한 번 선택하면 변경할 수 없습니다</p>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="w-3.5 h-3.5" /> 로그아웃
        </button>
      </div>

      {selected && (
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-2">선택한 프로필 미리보기</p>
          <div className="w-full aspect-[3/4] rounded-2xl overflow-hidden">
            <VotePhoto src={selected} alt="선택된 프로필" className="w-full h-full object-cover" width={800} />
          </div>
        </div>
      )}

      {voter.photos?.length > 1 && (
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-3">사진 선택</p>
          <div className="grid grid-cols-3 gap-2">
            {voter.photos.map((p, i) => (
              <button key={i} onClick={() => setSelected(p)} className="relative aspect-square">
                <VotePhoto src={p} alt={`사진 ${i + 1}`} className="w-full h-full object-cover rounded-xl" width={300} />
                {selected === p && (
                  <div className="absolute inset-0 bg-primary/35 rounded-xl flex items-center justify-center">
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"><Check className="w-4 h-4 text-white" /></div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {saveErr && <p className="text-xs text-destructive mb-3">{saveErr}</p>}
      <button onClick={confirm} disabled={!selected || saving}
        className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saving ? "저장 중..." : "이 사진으로 투표 시작하기"}
      </button>
      <CsFooter />
    </div>
  );
}

function VotePage({ voter, go, onUpdate, sessionToken, onLogout }: {
  voter: Application; go: (v: View) => void;
  onUpdate: (a: Application) => void; sessionToken: string | null; onLogout: () => void;
}) {
  const sb = getSupabase(sessionToken);
  const [candidates,  setCandidates]  = useState<Pick<Application, "id"|"nickname"|"gender"|"voteProfilePhoto">[]>([]);
  const [myVotes,     setMyVotes]     = useState<Record<string, string>>({});
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [message,     setMessage]     = useState("");
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [removing,    setRemoving]    = useState(false);
  const [error,       setError]       = useState("");
  const [showMyModal, setShowMyModal] = useState(false);

  const votedCount = Object.keys(myVotes).length;
  const selected = candidates.find(c => c.id === selectedId) ?? null;
  const hasVotedSelected = selected ? selected.id in myVotes : false;
  const atMaxVotes = votedCount >= MAX_VOTES && !hasVotedSelected;

  const loadVoteState = async () => {
    const oppositeGender = voter.gender === "남성" ? "여성" : "남성";
    const [candRes, votesRes] = await Promise.all([
      getSupabase().from("approved_for_voting")
        .select("id, nickname, gender, vote_profile_photo")
        .eq("gender", oppositeGender)
        .neq("id", voter.id),
      sb.rpc("get_my_votes"),
    ]);
    if (candRes.data) {
      setCandidates(candRes.data.map((c: Record<string, string>) => ({
        id: c.id, nickname: c.nickname, gender: c.gender as Gender,
        voteProfilePhoto: c.vote_profile_photo ?? undefined,
      })));
    }
    const votes: Record<string, string> = {};
    (votesRes.data ?? []).forEach((v: { voted_for_id: string; message: string }) => {
      votes[v.voted_for_id] = v.message;
    });
    setMyVotes(votes);
    setLoading(false);
  };

  useEffect(() => {
    loadVoteState();
    const onVisible = () => { if (document.visibilityState === "visible") loadVoteState(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [voter.id, sessionToken]);

  const openCandidate = (id: string) => {
    setSelectedId(id);
    setMessage(myVotes[id] ?? "");
    setError("");
  };

  const closeCandidate = () => {
    setSelectedId(null);
    setMessage("");
    setError("");
  };

  const handleSendVote = async () => {
    if (!selected || atMaxVotes) return;
    const trimmed = message.trim();
    if (!trimmed) { setError("쪽지를 입력해주세요."); return; }
    setSubmitting(true);
    setError("");
    const { error: rpcErr } = await sb.rpc("submit_single_vote", {
      p_voted_for_id: selected.id,
      p_message: trimmed,
    });
    if (rpcErr) {
      setError(voteRpcErrorMessage(rpcErr.message, "투표 전송에 실패했습니다."));
    } else {
      setMyVotes(prev => ({ ...prev, [selected.id]: trimmed }));
      closeCandidate();
    }
    setSubmitting(false);
  };

  const handleRemoveVote = async () => {
    if (!selected || !hasVotedSelected) return;
    setRemoving(true);
    setError("");
    const { error: rpcErr } = await sb.rpc("remove_single_vote", { p_voted_for_id: selected.id });
    if (rpcErr) {
      setError(voteRpcErrorMessage(rpcErr.message, "투표 취소에 실패했습니다."));
    } else {
      setMyVotes(prev => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      setMessage("");
      closeCandidate();
    }
    setRemoving(false);
  };

  if (loading) {
    return <div className="max-w-md mx-auto px-4 pt-24 pb-16 text-center text-muted-foreground text-sm">불러오는 중...</div>;
  }

  if (!candidates.length) {
    return (
      <div className="max-w-md mx-auto px-4 pt-24 pb-16 text-center">
        <p className="text-muted-foreground text-sm mb-6">투표 가능한 참가자가 없습니다.</p>
        <button onClick={onLogout} className="text-sm text-muted-foreground underline">로그아웃</button>
      </div>
    );
  }

  const selectedPhoto = selected ? getProfilePhoto(selected) : null;

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center justify-between pt-6 pb-2">
        <div>
          <h2 className="text-lg font-semibold">투표</h2>
          <p className="text-xs text-muted-foreground">{voter.nickname}님 · {votedCount}/{MAX_VOTES}명 투표함</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMyModal(true)} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            <ClipboardList className="w-3.5 h-3.5" /> 내 신청서
          </button>
          <button onClick={onLogout} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            <LogOut className="w-3.5 h-3.5" /> 로그아웃
          </button>
        </div>
      </div>

      <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-4 mt-4">
        <p className="text-sm text-primary/90">투표할 사람을 선택하고 쪽지를 보내주세요. 투표 마감 전까지 수정할 수 있습니다.</p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {candidates.map((c) => {
          const photo = getProfilePhoto(c);
          const voted = c.id in myVotes;
          return (
            <button key={c.id} onClick={() => openCandidate(c.id)}
              className={`rounded-xl border overflow-hidden text-left transition-all active:scale-[0.97] ${voted ? "border-primary ring-1 ring-primary/30" : "border-[rgba(240,168,190,0.30)] bg-[#131313] hover:border-primary/40"}`}>
              <div className="aspect-[3/4] relative bg-muted">
                {photo
                  ? <VotePhoto src={photo} alt={c.nickname} className="w-full h-full object-cover" width={200} />
                  : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Camera className="w-5 h-5 opacity-30" /></div>}
                {voted && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Heart className="w-2.5 h-2.5 fill-white text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs font-medium px-2 py-1.5 truncate">{c.nickname}</p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-end justify-center p-4" onClick={closeCandidate}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-sm">{selected.nickname}님에게 투표</h3>
              <button onClick={closeCandidate} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4">
              <div className="w-1/4 min-w-[72px] max-w-[96px] mx-auto aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-4">
                {selectedPhoto
                  ? <VotePhoto src={selectedPhoto} alt={selected.nickname} className="w-full h-full object-cover" width={200} />
                  : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Camera className="w-6 h-6 opacity-30" /></div>}
              </div>
              <FormField label="쪽지" hint={`최대 ${MAX_VOTE_MESSAGE}자`}>
                <FTextarea
                  placeholder="마음이 전해지도록 짧은 쪽지를 남겨주세요."
                  value={message}
                  maxLength={MAX_VOTE_MESSAGE}
                  onChange={(e) => { setMessage(e.target.value); setError(""); }}
                  rows={4}
                />
              </FormField>
              {error && <p className="text-xs text-destructive mt-2">{error}</p>}
              {atMaxVotes && <p className="text-xs text-amber-400 mt-2">투표는 최대 {MAX_VOTES}명까지 가능합니다.</p>}
              <div className="space-y-3 mt-5">
                <button
                  onClick={handleSendVote}
                  disabled={submitting || atMaxVotes}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                  {submitting ? "전송 중..." : hasVotedSelected ? "쪽지 수정하기" : "투표 보내기"}
                </button>
                {hasVotedSelected && (
                  <button
                    onClick={handleRemoveVote}
                    disabled={removing}
                    className="w-full py-3 rounded-xl font-medium text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors disabled:opacity-50">
                    {removing ? "취소 중..." : "이 사람 투표 취소"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showMyModal && <MyApplicationModal voter={voter} onClose={() => setShowMyModal(false)} />}
      <CsFooter />
    </div>
  );
}

/* ═══════════════════════════════════════════
   VOTE RESULT PAGE
═══════════════════════════════════════════ */
function VoteResultPage({ voter, go, onUpdate, sessionToken, onLogout }: {
  voter: Application; go: (v: View) => void;
  onUpdate: (a: Application) => void; sessionToken: string | null; onLogout: () => void;
}) {
  const sb = getSupabase(sessionToken);
  const [tab,         setTab]         = useState<"received" | "matches">("received");
  const [received,    setReceived]    = useState<ReceivedVote[]>([]);
  const [matches,     setMatches]     = useState<Match[]>([]);
  const [matchApps,   setMatchApps]   = useState<Record<string, { id: string; nickname: string; voteProfilePhoto?: string }>>({});
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      sb.rpc("get_votes_for_me"),
      sb.rpc("get_my_matches"),
    ]).then(async ([votesRes, matchesRes]) => {
      if (votesRes.data) {
        setReceived(votesRes.data.map((r: Record<string, unknown>) => ({
          voterId: r.voter_id as string,
          nickname: (r.nickname as string) || "",
          gender: r.gender as Gender,
          age: String(r.age ?? ""),
          mbti: (r.mbti as string) || "",
          job: (r.job as string) || "",
          jobDetail: r.job_detail as string | undefined,
          currentWork: (r.current_work as string) || "",
          lifeGoal: (r.life_goal as string) || "",
          hobbies: (r.alone_time as string) || "",
          instagram: (r.instagram as string) || "",
          idealType: (r.ideal_type as string) || "",
          charm: (r.charm as string) || "",
          celebrity: (r.celebrity as string) || "",
          voteProfilePhoto: (r.vote_profile_photo as string) || undefined,
          photos: (r.photos as string[]) || [],
          message: (r.message as string) || "",
          createdAt: (r.created_at as string) || "",
        })));
      }

      const mData = matchesRes.data;
      if (mData?.length) {
        const converted: Match[] = mData.map((m: Record<string, string>) => ({
          id: m.id, user1Id: m.user1_id, user2Id: m.user2_id,
          calculatedAt: m.calculated_at,
          user1Response: m.user1_response.replace("_", "-") as MatchResponse,
          user2Response: m.user2_response.replace("_", "-") as MatchResponse,
        }));
        setMatches(converted);

        const otherIds = mData.map((m: Record<string, string>) =>
          m.user1_id === voter.id ? m.user2_id : m.user1_id
        );
        const { data: appsData } = await getSupabase()
          .from("approved_for_voting")
          .select("id, nickname, vote_profile_photo")
          .in("id", otherIds);
        if (appsData) {
          const map: Record<string, { id: string; nickname: string; voteProfilePhoto?: string }> = {};
          appsData.forEach((a: Record<string, string>) => {
            map[a.id] = { id: a.id, nickname: a.nickname, voteProfilePhoto: a.vote_profile_photo };
          });
          setMatchApps(map);
        }
      }
      setLoading(false);
    });
  }, []);

  const myMatches = matches.map(m => {
    const isUser1 = m.user1Id === voter.id;
    const otherId = isUser1 ? m.user2Id : m.user1Id;
    const other   = matchApps[otherId];
    const myR     = isUser1 ? m.user1Response : m.user2Response;
    const theirR  = isUser1 ? m.user2Response : m.user1Response;

    let currentStatus: "pending" | "success" | "closed" = "pending";
    if (myR === "not-going" || theirR === "not-going") currentStatus = "closed";
    else if (myR === "going" && theirR === "going") currentStatus = "success";

    return { m, other, myR, theirR, isUser1, status: currentStatus };
  }).filter(x => x.other);

  const respond = async (matchId: string, isUser1: boolean, response: "going" | "not-going") => {
    const sbResponse = response === "not-going" ? "not_going" : "going";
    const { error } = await sb.rpc("update_lounge_response", {
      p_match_id: matchId,
      p_response: sbResponse,
    });
    if (!error) {
      setMatches(prev => prev.map(m => {
        if (m.id !== matchId) return m;
        return isUser1 ? { ...m, user1Response: response as MatchResponse }
                       : { ...m, user2Response: response as MatchResponse };
      }));
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center justify-between pt-6 pb-4">
        <div>
          <h2 className="text-lg font-semibold">투표 결과</h2>
          <p className="text-xs text-muted-foreground">{voter.nickname}님</p>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="w-3.5 h-3.5" /> 로그아웃
        </button>
      </div>

      <div className="flex gap-1 p-1 bg-secondary/30 rounded-xl mb-5">
        <button
          onClick={() => setTab("received")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === "received" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}>
          나에게 온 투표
          {received.length > 0 && (
            <span className="ml-1.5 text-xs text-primary">{received.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab("matches")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === "matches" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}>
          매칭
          {myMatches.length > 0 && (
            <span className="ml-1.5 text-xs text-primary">{myMatches.length}</span>
          )}
        </button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground text-sm py-12">조회 중...</p>
      ) : tab === "received" ? (
        received.length === 0 ? (
          <div className="text-center pt-12 pb-8">
            <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold mb-2">아직 투표가 없습니다</p>
            <p className="text-muted-foreground text-sm">나에게 투표한 분이 없어요.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {received.map(r => {
              const photo = r.voteProfilePhoto || r.photos[0] || null;
              const expanded = expandedId === r.voterId;
              return (
                <div key={r.voterId} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
                  <div className="flex items-start gap-4 p-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-muted shrink-0">
                      {photo
                        ? <VotePhoto src={photo} alt={r.nickname} className="w-full h-full object-cover" width={200} />
                        : <div className="w-full h-full flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground/40" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{r.nickname}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.age}세 · {r.mbti} · {r.job}{r.jobDetail ? ` (${r.jobDetail})` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="px-4 pb-3">
                    <div className="bg-primary/8 border border-primary/20 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        <p className="text-xs font-medium text-primary">쪽지</p>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.message}</p>
                    </div>
                  </div>

                  <div className="border-t border-border px-4 py-3">
                    <button
                      onClick={() => setExpandedId(expanded ? null : r.voterId)}
                      className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {expanded ? "프로필 접기" : "프로필 더보기"}
                    </button>
                    {expanded && (
                      <div className="mt-3 space-y-3">
                        {r.photos.length > 0 && (
                          <div className="grid grid-cols-3 gap-2">
                            {r.photos.map((p, i) => (
                              <VotePhoto key={i} src={p} alt="" className="aspect-square w-full object-cover rounded-xl" width={300} />
                            ))}
                          </div>
                        )}
                        <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-muted-foreground">성별</span><span>{r.gender}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">닮은꼴</span><span>{r.celebrity || "-"}</span></div>
                          {r.instagram && (
                            <div className="flex justify-between"><span className="text-muted-foreground">인스타</span><span>@{r.instagram}</span></div>
                          )}
                        </div>
                        {r.currentWork && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">요즘 어떤 삶을 살고 있나요?</p>
                            <p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{r.currentWork}</p>
                          </div>
                        )}
                        {r.lifeGoal && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">이루고 싶은 삶</p>
                            <p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{r.lifeGoal}</p>
                          </div>
                        )}
                        {r.hobbies && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">혼자 있을 때</p>
                            <p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{r.hobbies}</p>
                          </div>
                        )}
                        {r.idealType && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">어떤 사람에게 끌리나요?</p>
                            <p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{r.idealType}</p>
                          </div>
                        )}
                        {r.charm && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">나의 장점</p>
                            <p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{r.charm}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : myMatches.length === 0 ? (
        <div className="text-center pt-12 pb-8">
          <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold mb-2">매칭 상대가 없습니다</p>
          <p className="text-muted-foreground text-sm">서로 선택한 분이 없어요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-primary/8 border border-primary/20 rounded-xl px-4 py-3 mb-2">
            <p className="text-sm text-primary/90">서로 선택한 분이 있습니다! 라운지에 입장하시겠어요?</p>
          </div>
          {myMatches.map(({ m, other, myR, theirR, isUser1, status }) => {
            if (!other) return null;
            const otherPhoto = other.voteProfilePhoto ?? null;
            return (
              <div key={m.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-muted shrink-0">
                    {otherPhoto ? <VotePhoto src={otherPhoto} alt={other.nickname} className="w-full h-full object-cover" width={200} /> : <div className="w-full h-full flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground/40" /></div>}
                  </div>
                  <div>
                    <p className="font-semibold">{other.nickname}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Heart className="w-3 h-3 fill-primary text-primary" />
                      <p className="text-xs text-primary">서로 선택</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border px-4 py-3">
                  {status === "success" ? (
                    <div className="text-center py-2">
                      <p className="text-sm font-semibold text-primary mb-1">매칭 성사!</p>
                      <p className="text-xs text-muted-foreground">스탭이 현장에서 두 분을 불러서 안내해 드릴 예정입니다.</p>
                    </div>
                  ) : status === "closed" ? (
                    <div className="text-center py-2">
                      <p className="text-sm text-muted-foreground">이 매칭은 종료되었습니다.</p>
                    </div>
                  ) : myR === "pending" ? (
                    <div className="flex gap-2">
                      <button onClick={() => respond(m.id, isUser1, "going")}
                        className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                        라운지 입장
                      </button>
                      <button onClick={() => respond(m.id, isUser1, "not-going")}
                        className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">
                        거절
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-1">
                      <p className="text-xs text-muted-foreground">상대방의 응답을 기다리는 중입니다.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CsFooter />
    </div>
  );
}

/* ═══════════════════════════════════════════
   MY APPLICATION PAGE (Read-only view)
═══════════════════════════════════════════ */
function MyApplicationPage({ voter, onBack }: { voter: Application; onBack: () => void }) {
  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center gap-4 pt-6 pb-6">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <div>
          <h2 className="text-lg font-semibold">내 신청서 확인</h2>
          <p className="text-xs text-muted-foreground">제출하신 정보는 수정할 수 없는 읽기 전용 상태입니다.</p>
        </div>
      </div>
      <ApplicationDetailView app={voter} />
      <button onClick={onBack} className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-6">투표 화면으로</button>
    </div>
  );
}

function MyApplicationModal({ voter, onClose }: { voter: Application; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-t-2xl max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <h3 className="font-semibold text-base">내 신청 정보</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <ApplicationDetailView app={voter} />
      </div>
    </div>
  );
}

function ApplicationDetailView({ app }: { app: Application }) {
  return (
    <div className="space-y-5">
      {!!app.photos?.length && (
        <div className="grid grid-cols-3 gap-2">
          {app.photos.map((p, i) => <img key={i} src={p} alt="" className="aspect-square w-full h-full object-cover rounded-xl" />)}
        </div>
      )}
      <div className="bg-secondary/40 border border-border rounded-2xl p-4 space-y-2.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">이름</span><span>{app.name}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">성별</span><span>{app.gender}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">나이</span><span>{app.age}세</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">닉네임</span><span>{app.nickname}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">MBTI</span><span>{app.mbti}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">연락처</span><span>{app.contact}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">현재 상태</span><span>{app.job}{app.jobDetail ? ` (${app.jobDetail})` : ""}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">인스타그램</span><span>@{app.instagram}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">닮은꼴</span><span>{app.celebrity}</span></div>
      </div>
      <div className="space-y-3">
        <div><p className="text-xs text-muted-foreground mb-1">요즘 어떤 삶을 살고 있나요?</p><p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{app.currentWork}</p></div>
        <div><p className="text-xs text-muted-foreground mb-1">이루고 싶은 삶</p><p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{app.lifeGoal}</p></div>
        <div><p className="text-xs text-muted-foreground mb-1">혼자 있을 때 무엇을 하나요?</p><p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{app.hobbies}</p></div>
        <div><p className="text-xs text-muted-foreground mb-1">어떤 사람에게 끌리나요?</p><p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{app.idealType}</p></div>
        <div><p className="text-xs text-muted-foreground mb-1">나의 장점</p><p className="text-sm bg-secondary/20 p-3 rounded-xl border border-border leading-relaxed">{app.charm}</p></div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHARED UI
═══════════════════════════════════════════ */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[#888888] text-sm shrink-0">{label}</span>
      <div className="text-sm text-[#F5F0F2]">{children}</div>
    </div>
  );
}

function NoticeItem({ icon, iconBg, children }: { icon: React.ReactNode; iconBg: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-[18px] h-[18px] rounded-full ${iconBg} flex items-center justify-center shrink-0 mt-0.5`}>{icon}</div>
      <p className="text-sm text-[#888888] leading-relaxed">{children}</p>
    </div>
  );
}

function Chip({ color, children }: { color: "pink" | "gray"; children: React.ReactNode }) {
  return (
    <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border shrink-0 whitespace-nowrap ${
      color === "pink"
        ? "border-[rgba(240,168,190,0.5)] bg-[rgba(240,168,190,0.12)] text-[#F0A8BE]"
        : "border-[rgba(240,168,190,0.20)] text-[#888888]"
    }`}>{children}</span>
  );
}

function CheckRow({ checked, onToggle, label, error }: { checked: boolean; onToggle: () => void; label: string; error?: string }) {
  return (
    <div>
      <button type="button" onClick={onToggle}
        className={`w-full py-3.5 rounded-xl border-[1.5px] text-sm flex items-center gap-3 px-4 transition-all ${
          checked
            ? "border-[#F0A8BE] bg-[rgba(240,168,190,0.10)] text-[#F0A8BE]"
            : "border-[rgba(240,168,190,0.25)] text-[#888888]"
        }`}>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          checked ? "border-[#F0A8BE] bg-[#F0A8BE]" : "border-[rgba(240,168,190,0.35)]"
        }`}>
          {checked && <Check className="w-3 h-3 text-[#080808]" />}
        </div>
        {label}
      </button>
      {error && <p className="text-xs text-[#D4183D] mt-1.5 ml-1">{error}</p>}
    </div>
  );
}

function FormField({ label, hint, required, error, children }: { label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label}{required && <span className="text-primary ml-0.5">*</span>}
        {hint && <span className="font-normal text-muted-foreground ml-1.5 text-xs">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
    </div>
  );
}

function FInput({ className = "", style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  // 16px 고정: iOS Safari 포커스 확대 방지
  return (
    <input
      {...props}
      style={{ fontSize: 16, ...style }}
      className={`w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors ${className}`}
    />
  );
}

function FTextarea({ style, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={3}
      style={{ fontSize: 16, ...style }}
      className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors resize-none"
    />
  );
}

function FSelect({ children, style, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{ fontSize: 16, ...style }}
      className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground outline-none focus:border-primary transition-colors appearance-none"
    >
      {children}
    </select>
  );
}