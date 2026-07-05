import React, { useState, useRef, useEffect, ChangeEvent, useCallback } from "react";
import { adminApi } from "./adminApi";
import { createClient } from "@supabase/supabase-js";
import {
  ChevronLeft, ChevronRight, Copy, CheckCheck, Heart, X, Check,
  Plus, LogOut, BarChart2, ClipboardList, ChevronDown, ChevronUp,
  Eye, EyeOff, AlertCircle, MessageSquare, Download, Users,
  Camera, Award, Zap
} from "lucide-react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import posterImage from "@/imports/Group_5.png";

/* ═══════════════════════════════════════════
   SUPABASE CLIENT
═══════════════════════════════════════════ */
const SB_URL  = (import.meta.env.VITE_SUPABASE_URL  as string) ?? "";
const SB_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "";
const SB_READY = SB_URL.startsWith("https://");

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

/* ═══════════════════════════════════════════
   TYPES
═══════════════════════════════════════════ */
type View = "home" | "apply" | "success" | "vote-login" | "vote-profile" | "vote" | "vote-result" | "admin-login" | "admin" | "my-app";
type Gender = "남성" | "여성";
type AppStatus = "pending" | "approved" | "rejected";
type GenderFilter = "전체" | "남성" | "여성";
type StatusFilter = "전체" | "pending" | "approved" | "rejected";
type MatchResponse = "pending" | "going" | "not-going";
type AdminTab = "apps" | "vote" | "matching";
type PCSection = "applications" | "vote-management" | "matching";

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
const SMS_TEXT        = "승인문자";

const MBTI_LIST = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];
const JOB_LIST  = ["대학생","대학원생","직장인","취업 준비 중","이직 준비 중","기타"];
const AGE_LIST  = Array.from({ length: 10 }, (_, i) => ({ age: 20 + i, birth: 2027 - (20 + i) }));

const PHASE2_START = new Date("2026-08-02T12:00:00+09:00");
const PHASE1_START = new Date("2026-07-19T18:00:00+09:00");
const EVENT_START  = new Date("2026-08-09T17:00:00+09:00");
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
      const MAX = 700, s = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * s; c.height = img.height * s;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => { if (blob) res(blob); }, "image/jpeg", 0.78);
    };
    img.src = url;
  });
}

function getProfilePhoto(app: Partial<Application>): string | null {
  return app.voteProfilePhoto || app.photos?.[0] || null;
}

function downloadCSV(apps: Application[]) {
  const h = ["이름","성별","나이","닉네임","MBTI","연락처","직업","상태","환불 은행","환불 계좌번호"];
  const sl: Record<AppStatus, string> = { pending: "대기", approved: "승인", rejected: "거절" };
  const rows = apps.map(a => [a.name, a.gender, a.age, a.nickname, a.mbti, a.contact, a.job + (a.jobDetail ? ` (${a.jobDetail})` : ""), sl[a.status], a.refundBank, a.refundAccount]);
  const csv = [h, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a"); el.href = url; el.download = "솔로파티_신청자목록.csv"; el.click();
  URL.revokeObjectURL(url);
}

function useIsPC() {
  const [isPC, setIsPC] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);
  useEffect(() => {
    const h = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isPC;
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
            
            if (currentSettings?.is_closed) {
              setView("vote-result");
            } else if (currentSettings?.is_open) {
              setView("vote");
            }
          } else {
            localStorage.removeItem("sp_voter_token");
          }
        } catch {
          localStorage.removeItem("sp_voter_token");
        }
      }
      setAppLoading(false);
    };
    initApp();
  }, []);

  const handleVoteLogin = (a: Application, token: string) => {
    setVoter(a);
    setSessionToken(token);
    localStorage.setItem("sp_voter_token", token);
    if (settings.isClosed) go("vote-result");
    else go("vote-profile");
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
      {view === "home"         && <HomePage go={go} settings={settings} refreshSettings={fetchGlobalSettings} hasVoter={!!voter} />}
      {view === "apply"        && <ApplyPage go={go} settings={settings} />}
      {view === "success"      && <SuccessPage go={go} />}
      {view === "vote-login"   && <VoteLoginPage go={go} onLogin={handleVoteLogin} settings={settings} />}
      {view === "vote-profile" && voter && <VoteProfilePage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} />}
      {view === "vote"         && voter && <VotePage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} onLogout={handleLogout} />}
      {view === "vote-result"  && voter && <VoteResultPage voter={voter} go={go} onUpdate={setVoter} sessionToken={sessionToken} onLogout={handleLogout} />}
      {view === "admin-login"  && <AdminLoginPage go={go} />}
      {view === "admin"        && <AdminPage go={go} />}
      {view === "my-app"       && voter && <MyApplicationPage voter={voter} go={go} />}
    </div>
  );
}

/* ═══════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════ */
function HomePage({ go, settings, refreshSettings, hasVoter }: { go: (v: View) => void; settings: VoteSettings; refreshSettings: () => Promise<any>; hasVoter: boolean }) {
  const [copied,   setCopied]   = useState(false);

  useEffect(() => { refreshSettings(); }, []);

  const phase1Active = now_ >= PHASE1_START && now_ < PHASE2_START;
  const phase2Active = now_ >= PHASE2_START && now_ < EVENT_START;

  const copy = () => {
    navigator.clipboard.writeText("65201536202013").catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const voteText   = settings.isClosed ? "결과 확인하기" : settings.isOpen ? "투표하기" : "투표 준비 중";
  const voteActive = settings.isClosed || settings.isOpen;

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="w-full flex justify-center bg-background pt-6 pb-2 px-6">
        <ImageWithFallback
          src={posterImage}
          alt="THE SECOND SOLO PARTY"
          className="w-full max-w-xs object-contain"
        />
      </div>

      <div className="px-4">
        <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-3 mt-5">
          <p className="text-[10px] tracking-[0.35em] uppercase text-primary mb-4">모집 일정</p>
          <div className="space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">1차 모집</p>
                <p className="text-xs text-muted-foreground mt-0.5">7월 19일 (일) 오후 6시 오픈</p>
                <p className="text-xs text-muted-foreground">인원 마감 시 모집 종료</p>
              </div>
              {phase1Active && <Chip color="pink">모집 중</Chip>}
              {now_ < PHASE1_START && <Chip color="gray">예정</Chip>}
              {now_ >= PHASE2_START && <Chip color="gray">마감</Chip>}
            </div>
            <div className="h-px bg-[rgba(240,168,190,0.20)]" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">2차 모집</p>
                <p className="text-xs text-muted-foreground mt-0.5">8월 2일 (일) 오후 12시 오픈</p>
              </div>
              {phase2Active && <Chip color="pink">모집 중</Chip>}
              {now_ < PHASE2_START && <Chip color="gray">예정</Chip>}
              {now_ >= EVENT_START && <Chip color="gray">마감</Chip>}
            </div>
          </div>
        </div>

        <div className="bg-[#131313] rounded-2xl p-5 border border-[rgba(240,168,190,0.30)] mb-3">
          <p className="text-[10px] tracking-[0.35em] uppercase text-primary mb-4">이벤트 정보</p>
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
          <p className="text-[10px] tracking-[0.35em] uppercase text-primary mb-3.5">환불 안내</p>
          <div className="space-y-2.5">
            <NoticeItem icon={<Check className="w-3 h-3 text-[#F0A8BE]" />} iconBg="bg-[rgba(240,168,190,0.18)]">행사 <strong className="text-[#F5F0F2] font-semibold">7일 전까지</strong> 100% 환불</NoticeItem>
            <NoticeItem icon={<X className="w-3 h-3 text-[#D4183D]" />} iconBg="bg-[rgba(212,24,61,0.15)]">7일 이후 환불 불가</NoticeItem>
            <NoticeItem icon={<Check className="w-3 h-3 text-[#F0A8BE]" />} iconBg="bg-[rgba(240,168,190,0.18)]">승인 거절 시 100% 환불</NoticeItem>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => settings.isOpen || hasVoter ? go(hasVoter ? "my-app" : "vote-login") : go("apply")}
            className="w-full py-4 rounded-2xl font-bold text-[15px] bg-[#F0A8BE] text-[#080808] transition-opacity hover:opacity-90 active:scale-[0.98]">
            {settings.isOpen || hasVoter ? "내 신청서 확인하기" : "참가 신청하기"}
          </button>
          <button
            onClick={() => voteActive && go("vote-login")}
            disabled={!voteActive}
            className={`w-full py-4 rounded-2xl font-bold text-[15px] border-[1.5px] transition-all active:scale-[0.98] ${
              voteActive
                ? "bg-transparent border-[#F0A8BE] text-[#F0A8BE] hover:bg-[rgba(240,168,190,0.08)] cursor-pointer"
                : "bg-[#1A1A1A] border-[rgba(240,168,190,0.35)] text-[#888888] cursor-not-allowed"
            }`}>
            {voteText}
          </button>
        </div>

        <div className="text-center mt-14">
          <button onClick={() => go("admin-login")} className="text-[11px] text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors">
            관리자
          </button>
        </div>
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
      // Supabase 미설정 시 localStorage 폴백
      if (!SB_READY) {
        const base64Photos: string[] = await Promise.all(
          uploadFiles.map(
            (file) =>
              new Promise<string>((res) => {
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                  const MAX = 700, s = Math.min(1, MAX / Math.max(img.width, img.height));
                  const c = document.createElement("canvas");
                  c.width = img.width * s; c.height = img.height * s;
                  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
                  URL.revokeObjectURL(url);
                  res(c.toDataURL("image/jpeg", 0.78));
                };
                img.src = url;
              })
          )
        );
        const apps = JSON.parse(localStorage.getItem("sp_apps_v2") || "[]");
        apps.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          name: form.name!.trim(), gender: form.gender, age: form.age,
          nickname: form.nickname!.trim(), mbti: form.mbti,
          contact: form.contact!.trim(), job: form.job,
          jobDetail: form.jobDetail?.trim(),
          currentWork: form.currentWork!.trim(), lifeGoal: form.lifeGoal!.trim(),
          hobbies: form.hobbies!.trim(), instagram: form.instagram!.trim(),
          idealType: form.idealType!.trim(), charm: form.charm!.trim(),
          celebrity: form.celebrity!.trim(), photos: base64Photos,
          refundBank: form.refundBank!.trim(), refundAccount: form.refundAccount!.trim(),
          status: "pending", smsSent: false, submittedAt: new Date().toISOString(),
        });
        localStorage.setItem("sp_apps_v2", JSON.stringify(apps));
        go("success");
        return;
      }

      // Supabase 연동 시 Storage 업로드
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
        nickname: form.nickname!.trim(), mbti: form.mbti, contact: form.contact!.trim(),
        job: form.job, job_detail: form.jobDetail?.trim(),
        current_work: form.currentWork!.trim(), life_goal: form.lifeGoal!.trim(),
        alone_time: form.hobbies!.trim(), instagram: form.instagram!.trim(),
        ideal_type: form.idealType!.trim(), charm: form.charm!.trim(),
        celebrity: form.celebrity!.trim(), photos: uploadedUrls,
        refund_bank: form.refundBank!.trim(), refund_account: form.refundAccount!.trim(),
        status: "pending",
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
            <FTextarea placeholder="예: 기획 중이고 수영을 배우고 있어요." value={form.currentWork || ""} onChange={(e) => set("currentWork", e.target.value)} />
          </FormField>
          <FormField label="이루고 싶은 삶" required error={errors.lifeGoal}>
            <FTextarea placeholder="예: 좋아하는 일을 하면서 행복하게 사는 것이요." value={form.lifeGoal || ""} onChange={(e) => set("lifeGoal", e.target.value)} />
          </FormField>
          <FormField label="혼자 있을 때 무엇을 하며 시간을 보내나요?" required error={errors.hobbies}>
            <FTextarea placeholder="예: 새로운 카페를 탐방하거나 유튜브를 봐요." value={form.hobbies || ""} onChange={(e) => set("hobbies", e.target.value)} />
          </FormField>
          <FormField label="인스타그램 ID" required error={errors.instagram}>
            <FInput placeholder="@ 없이 입력" value={form.instagram || ""} onChange={(e) => set("instagram", e.target.value)} />
          </FormField>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <FormField label="어떤 사람에게 끌리나요? (이상형 등)" required error={errors.idealType}>
            <FTextarea placeholder="예: 대화가 잘 통하는 사람이 좋아요." value={form.idealType || ""} onChange={(e) => set("idealType", e.target.value)} />
          </FormField>
          <FormField label="사람들이 자주 말하는 나의 장점은?" required error={errors.charm}>
            <FTextarea placeholder="예: 분위기를 밝게 만드는 편이에요." value={form.charm || ""} onChange={(e) => set("charm", e.target.value)} />
          </FormField>
          <FormField label="자주 듣는 닮은 꼴" required error={errors.celebrity} hint="연예인, 캐릭터, 동물 등">
            <FInput placeholder="직접 입력해주세요" value={form.celebrity || ""} onChange={(e) => set("celebrity", e.target.value)} />
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
            <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4 text-xs text-muted-foreground space-y-4 leading-relaxed max-h-64 overflow-y-auto">
              <section><p className="text-foreground font-semibold text-sm mb-2">1. 환불 정책</p><p>행사 7일 전까지 환불 신청 시 100% 환불됩니다.</p></section>
              <section><p className="text-foreground font-semibold text-sm mb-2">2. 촬영 안내</p><p>촬영된 콘텐츠는 채널에 업로드될 수 있으나, 식별 정보는 노출되지 않습니다.</p></section>
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

      {privacyOpen && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-end justify-center p-4" onClick={() => setPrivacyOpen(false)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-sm">개인정보 수집 이용 동의서</h3>
              <button onClick={() => setPrivacyOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 text-xs text-muted-foreground space-y-3.5 leading-relaxed max-h-[60vh] overflow-y-auto">
              <p>솔로파티 참가자 확인 및 운영 목적을 위해 개인정보를 수집합니다.</p>
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
        p_contact: contact.trim(),
      });
      if (rpcErr || !data?.length) {
        setError("이름과 연락처가 일치하는 승인된 참가자를 찾을 수 없습니다.");
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
    </div>
  );
}

/* ═══════════════════════════════════════════
   VOTE PROFILE PAGE
═══════════════════════════════════════════ */
function VoteProfilePage({ voter, go, onUpdate, sessionToken }: {
  voter: Application; go: (v: View) => void;
  onUpdate: (a: Application) => void; sessionToken: string | null;
}) {
  const [selected,     setSelected]     = useState<string | null>(voter.voteProfilePhoto || voter.photos?.[0] || null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState("");
  const sb = getSupabase(sessionToken);

  useEffect(() => {
    sb.rpc("get_my_submission").then(({ data }) => setHasSubmitted(!!data?.length));
  }, []);

  const confirm = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveErr("");
    const { error } = await sb.rpc("update_vote_profile_photo", { p_photo_url: selected });
    if (error) { setSaveErr("사진 저장 중 오류가 발생했습니다."); setSaving(false); return; }
    onUpdate({ ...voter, voteProfilePhoto: selected });
    setSaving(false);
    go("vote");
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center gap-4 pt-6 pb-6">
        <button onClick={() => go("home")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">프로필 사진 선택</h2>
          <p className="text-xs text-muted-foreground mt-0.5">투표 화면에 노출될 사진을 선택해주세요</p>
        </div>
      </div>

      {selected && (
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-2">현재 선택된 프로필</p>
          <img src={selected} alt="선택된 프로필" className="w-full h-52 object-cover rounded-2xl" />
        </div>
      )}

      {voter.photos?.length > 1 && (
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-3">다른 사진으로 변경</p>
          <div className="grid grid-cols-3 gap-2">
            {voter.photos.map((p, i) => (
              <button key={i} onClick={() => setSelected(p)} className="relative aspect-square">
                <img src={p} alt={`사진 ${i + 1}`} className="w-full h-full object-cover rounded-xl" />
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

      {hasSubmitted && (
        <div className="bg-primary/8 border border-primary/20 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-primary/90">이미 투표를 완료했습니다. 프로필 사진만 변경할 수 있습니다.</p>
        </div>
      )}

      {saveErr && <p className="text-xs text-destructive mb-3">{saveErr}</p>}
      <button onClick={confirm} disabled={!selected || saving}
        className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saving ? "저장 중..." : hasSubmitted ? "사진 저장 후 투표 현황 보기" : "이 사진으로 투표 시작하기"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   VOTE PAGE
═══════════════════════════════════════════ */
function VotePage({ voter, go, onUpdate, sessionToken, onLogout }: {
  voter: Application; go: (v: View) => void;
  onUpdate: (a: Application) => void; sessionToken: string | null; onLogout: () => void;
}) {
  const sb = getSupabase(sessionToken);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitted,   setSubmitted]   = useState(false);
  const [candidates,  setCandidates]  = useState<Pick<Application, "id"|"nickname"|"gender"|"voteProfilePhoto">[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [showMyModal, setShowMyModal] = useState(false);

  useEffect(() => {
    const oppositeGender = voter.gender === "남성" ? "여성" : "남성";
    Promise.all([
      getSupabase().from("approved_for_voting")
        .select("id, nickname, gender, vote_profile_photo")
        .eq("gender", oppositeGender)
        .neq("id", voter.id),
      sb.rpc("get_my_submission"),
    ]).then(([candRes, subRes]) => {
      if (candRes.data) {
        setCandidates(candRes.data.map((c: Record<string, string>) => ({
          id: c.id, nickname: c.nickname, gender: c.gender as Gender,
          voteProfilePhoto: c.vote_profile_photo ?? undefined,
        })));
      }
      if (subRes.data?.length) {
        setSelectedIds(subRes.data[0].voted_for_ids ?? []);
        setSubmitted(true);
      }
      setLoading(false);
    });
  }, []);

  const toggle = (id: string) => {
    if (submitted) return;
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < MAX_VOTES ? [...prev, id] : prev
    );
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const { error } = await sb.rpc("submit_vote", { p_voted_for_ids: selectedIds });
    if (!error) setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto px-4 pt-24 pb-16 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-6">
          <Heart className="w-9 h-9 fill-primary text-primary" />
        </div>
        <h3 className="text-xl font-bold mb-2">투표 완료!</h3>
        <p className="text-muted-foreground text-sm mb-2">소중한 마음이 전달되길 바랍니다.</p>
        <p className="text-muted-foreground text-xs mb-8">매칭 결과는 투표 마감 후 공개됩니다.</p>
        <button onClick={() => go("vote-profile")} className="w-full py-3.5 rounded-2xl font-medium text-sm border border-primary text-primary hover:bg-primary/8 transition-colors mb-3">
          프로필 사진 변경하기
        </button>
        <button onClick={() => setShowMyModal(true)} className="w-full py-3.5 rounded-2xl font-medium text-sm border border-border text-muted-foreground hover:bg-secondary/30 transition-colors mb-4">
          내 신청서 확인하기
        </button>
        <button onClick={onLogout} className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity">로그아웃 후 홈으로</button>
        
        {showMyModal && <MyApplicationModal voter={voter} onClose={() => setShowMyModal(false)} />}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center justify-between pt-6 pb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => go("vote-profile")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <div>
            <h2 className="text-lg font-semibold">투표</h2>
            <p className="text-xs text-muted-foreground">{voter.nickname}님 · {selectedIds.length}/{MAX_VOTES}명 선택</p>
          </div>
        </div>
        <button onClick={() => setShowMyModal(true)} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          <ClipboardList className="w-3.5 h-3.5" /> 내 신청서
        </button>
      </div>

      <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-5 mt-4">
        <p className="text-sm text-primary/90">마음에 드는 분을 최대 {MAX_VOTES}명까지 선택할 수 있습니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {candidates.map((c) => {
          const isSelected = selectedIds.includes(c.id);
          const photo = getProfilePhoto(c);
          return (
            <button key={c.id} onClick={() => toggle(c.id)}
              className={`rounded-2xl border overflow-hidden transition-all active:scale-[0.97] ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-[rgba(240,168,190,0.30)] bg-[#131313] hover:border-primary/40"}`}>
              <div className="aspect-[4/5] relative bg-muted">
                {photo ? <img src={photo} alt={c.nickname} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Camera className="w-8 h-8 opacity-30" /></div>}
                {isSelected && <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg"><Heart className="w-3.5 h-3.5 fill-white text-white" /></div>}
              </div>
              <div className="p-3 text-left">
                <p className="font-semibold text-sm">{c.nickname}</p>
              </div>
            </button>
          );
        })}
      </div>

      {candidates.length === 0 && <p className="text-center text-muted-foreground text-sm py-12">투표 가능한 참가자가 없습니다.</p>}

      <button onClick={handleSubmit} disabled={submitting}
        className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {submitting ? "제출 중..." : selectedIds.length === 0 ? "마음에 드는 분 없음으로 제출" : `${selectedIds.length}명 선택 완료 · 제출하기`}
      </button>

      {showMyModal && <MyApplicationModal voter={voter} onClose={() => setShowMyModal(false)} />}
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
  const [matches,   setMatches]   = useState<Match[]>([]);
  const [matchApps, setMatchApps] = useState<Record<string, { id: string; nickname: string; voteProfilePhoto?: string }>>({});
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    sb.rpc("get_my_matches").then(async ({ data: mData }) => {
      if (!mData?.length) { setLoading(false); return; }

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
      <div className="flex items-center justify-between pt-6 pb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => go("home")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <div>
            <h2 className="text-lg font-semibold">매칭 결과</h2>
            <p className="text-xs text-muted-foreground">{voter.nickname}님</p>
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1 text-xs border border-border rounded-lg px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="w-3.5 h-3.5" /> 로그아웃
        </button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground text-sm py-12">조회 중...</p>
      ) : myMatches.length === 0 ? (
        <div className="text-center pt-12 pb-8">
          <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold mb-2">매칭 상대가 없습니다.</p>
          <p className="text-muted-foreground text-sm">이번 인연은 아니었지만 다음 기회가 있을 거예요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-primary/8 border border-primary/20 rounded-xl px-4 py-3 mb-2">
            <p className="text-sm text-primary/90">서로 선택한 분이 있습니다! 프라이빗 라운지로 이동하시겠어요?</p>
          </div>
          {myMatches.map(({ m, other, myR, theirR, isUser1, status }) => {
            if (!other) return null;
            const otherPhoto = other.voteProfilePhoto ?? null;
            return (
              <div key={m.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-muted shrink-0">
                    {otherPhoto ? <img src={otherPhoto} alt={other.nickname} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground/40" /></div>}
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
                        라운지로 간다
                      </button>
                      <button onClick={() => respond(m.id, isUser1, "not-going")}
                        className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">
                        가지 않는다
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

      <button onClick={() => go("home")} className="w-full py-4 rounded-2xl font-semibold text-[15px] border border-border text-muted-foreground hover:text-foreground transition-colors mt-6">홈으로</button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MY APPLICATION PAGE (Read-only view)
═══════════════════════════════════════════ */
function MyApplicationPage({ voter, go }: { voter: Application; go: (v: View) => void }) {
  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center gap-4 pt-6 pb-6">
        <button onClick={() => go("home")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <div>
          <h2 className="text-lg font-semibold">내 신청서 확인</h2>
          <p className="text-xs text-muted-foreground">제출하신 정보는 수정할 수 없는 읽기 전용 상태입니다.</p>
        </div>
      </div>
      <ApplicationDetailView app={voter} />
      <button onClick={() => go("home")} className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-6">홈으로</button>
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
      <div className="text-xs text-muted-foreground border-t border-border pt-3">환불 계좌: {app.refundBank} {app.refundAccount}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN LOGIN
═══════════════════════════════════════════ */
function AdminLoginPage({ go }: { go: (v: View) => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (adminApi.hasSession()) go("admin");
  }, []);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      await adminApi.login(pw);
      go("admin");
    } catch {
      setError("비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="flex items-center gap-4 pt-6 pb-10">
        <button onClick={() => go("home")} className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-lg font-semibold">관리자 로그인</h2>
      </div>
      <div className="space-y-4">
        <FormField label="비밀번호">
          <div className="relative">
            <FInput type={show ? "text" : "password"} placeholder="비밀번호 입력" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && login()} className="pr-12" />
            <button onClick={() => setShow(!show)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
        </FormField>
        <button onClick={login} disabled={loading} className="w-full py-4 rounded-2xl font-semibold text-[15px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity mt-2 disabled:opacity-50">
          {loading ? "확인 중..." : "로그인"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN PAGE (routes to mobile or PC)
═══════════════════════════════════════════ */
function AdminPage({ go }: { go: (v: View) => void }) {
  const isPC = useIsPC();
  return isPC ? <PCAdminPage go={go} /> : <MobileAdminPage go={go} />;
}

/* ─── MOBILE ADMIN ─── */
function MobileAdminPage({ go }: { go: (v: View) => void }) {
  const [tab, setTab] = useState<AdminTab>("apps");
  const [apps, setApps] = useState<Application[]>([]);
  const [subs, setSubs] = useState<{ voter_id: string; voted_for_ids: string[] }[]>([]);
  const [matches, setMatches] = useState<{
    id: string; user1_id: string; user2_id: string;
    calculated_at: string; user1_response: string; user2_response: string;
  }[]>([]);
  const [settings, setSettings] = useState<{
    is_open: boolean; is_closed: boolean; closed_at?: string;
    male_open: boolean; female_open: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [gFilter, setGFilter] = useState<GenderFilter>("전체");
  const [sFilter, setSFilter] = useState<StatusFilter>("전체");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string[] | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [smsModal, setSmsModal] = useState<Application | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const refresh = async () => {
    const [appsRaw, subsRaw, matchesRaw, settingsRaw] = await Promise.all([
      adminApi.listApplicants(),
      adminApi.getVoteResults(),
      adminApi.getMatches(),
      adminApi.getVoteSettings(),
    ]);
    setApps(appsRaw.map((a: Record<string, unknown>) => ({
      id: a.id, name: a.name, gender: a.gender, age: a.age, nickname: a.nickname,
      mbti: a.mbti, contact: a.contact, job: a.job, jobDetail: a.job_detail,
      currentWork: a.current_work, lifeGoal: a.life_goal, hobbies: a.alone_time,
      instagram: a.instagram, idealType: a.ideal_type, charm: a.charm,
      celebrity: a.celebrity, photos: a.photos || [], voteProfilePhoto: a.vote_profile_photo,
      refundBank: a.refund_bank, refundAccount: a.refund_account,
      status: a.status, smsSent: a.sms_sent, submittedAt: a.submitted_at,
    })) as Application[]);
    setSubs(subsRaw);
    setMatches(matchesRaw);
    setSettings(settingsRaw);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const updateStatus = async (id: string, status: AppStatus) => {
    await adminApi.updateStatus(id, status);
    if (status === "approved") {
      const t = apps.find(a => a.id === id);
      if (t) setSmsModal(t);
    }
    refresh();
  };

  const markSmsSent = async (id: string) => {
    await adminApi.markSmsSent(id);
    refresh();
  };

  const toggleVoteOpen = async () => {
    if (!settings) return;
    await adminApi.toggleVoteOpen(!settings.is_open);
    refresh();
  };

  const toggleGenderOpen = async (gender: Gender) => {
    if (!settings) return;
    const current = gender === "남성" ? settings.male_open : settings.female_open;
    await adminApi.toggleGenderOpen(gender, !current);
    refresh();
  };

  const closeVoting = async () => {
    await adminApi.closeVoting();
    setCloseConfirm(false);
    refresh();
  };

  if (loading || !settings) {
    return <div className="max-w-md mx-auto pb-16 px-4 pt-12 text-center text-muted-foreground text-sm">불러오는 중...</div>;
  }

  const approved = apps.filter(a => a.status === "approved");
  const submittedCount = subs.length;
  const statusColor: Record<AppStatus, string> = { pending: "text-amber-400 bg-amber-400/10 border-amber-400/30", approved: "text-green-400 bg-green-400/10 border-green-400/30", rejected: "text-destructive bg-destructive/10 border-destructive/30" };
  const statusLabel: Record<AppStatus, string> = { pending: "대기", approved: "승인", rejected: "거절" };
  const cnt = (g: GenderFilter, s: AppStatus | "all") => apps.filter(a => (g === "전체" || a.gender === g) && (s === "all" || a.status === s)).length;
  const filteredApps = apps.filter(a => (gFilter === "전체" || a.gender === gFilter) && (sFilter === "전체" || a.status === sFilter));

  const getMatchStatusFromRow = (m: { user1_response: string; user2_response: string }): "pending" | "success" | "closed" => {
    if (m.user1_response === "not_going" || m.user2_response === "not_going") return "closed";
    if (m.user1_response === "going" && m.user2_response === "going") return "success";
    return "pending";
  };

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-4 pt-6 pb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">관리자 대시보드</h2>
        <button onClick={() => { adminApi.logout(); go("home"); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><LogOut className="w-3.5 h-3.5" /> 나가기</button>
      </div>

      <div className="px-4 flex gap-1.5 mb-4">
        {([["apps", "신청 목록"], ["vote", "투표 관리"], ["matching", "매칭 현황"]] as [AdminTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${tab === t ? "bg-primary/15 border-primary/40 text-primary" : "bg-[#131313] border-[rgba(240,168,190,0.30)] text-[#888888]"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "apps" && (
        <div className="px-4">
          <div className="flex gap-2 mb-3">
            {([["all","전체","text-foreground"],["pending","대기","text-amber-400"],["approved","승인","text-green-400"],["rejected","거절","text-destructive"]] as const).map(([k,l,c]) => (
              <div key={k} className="flex-1 bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl px-2 py-2.5 text-center">
                <p className={`text-lg font-bold leading-none ${c}`}>{cnt("전체", k)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{l}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">남{cnt("남성",k)} / 여{cnt("여성",k)}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mb-2.5">
            {(["전체","남성","여성"] as GenderFilter[]).map(g => <button key={g} onClick={() => setGFilter(g)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${gFilter===g?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>{g}</button>)}
          </div>
          <div className="flex gap-2 mb-4">
            {(["전체","pending","approved","rejected"] as StatusFilter[]).map(s => {
              const lbl: Record<StatusFilter,string>={전체:"전체",pending:"대기",approved:"승인",rejected:"거절"};
              return <button key={s} onClick={() => setSFilter(s)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${sFilter===s?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>{lbl[s]}</button>;
            })}
          </div>
          <div className="space-y-2">
            {!filteredApps.length && <p className="text-center text-muted-foreground text-sm py-12">신청서가 없습니다.</p>}
            {filteredApps.map((a) => {
              const open = expanded === a.id;
              return (
                <div key={a.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
                  <button onClick={() => setExpanded(open ? null : a.id)} className="w-full px-4 py-3.5 flex items-center gap-3 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{a.name}</span>
                        <span className="text-xs text-muted-foreground">({a.nickname})</span>
                        {a.smsSent && <MessageSquare className="w-3 h-3 text-green-400" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.gender} · {a.age}세 · {a.job}{a.jobDetail?` (${a.jobDetail})`:""}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border shrink-0 ${statusColor[a.status]}`}>{statusLabel[a.status]}</span>
                    {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {open && (
                    <div className="border-t border-border px-4 py-4 space-y-4">
                      {!!a.photos?.length && (
                        <div>
                          <div className="grid grid-cols-3 gap-2">
                            {a.photos.map((p,i) => <button key={i} onClick={() => { setPhotoModal(a.photos); setPhotoIdx(i); }} className="aspect-square"><img src={p} alt="" className="w-full h-full object-cover rounded-lg" /></button>)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5 text-center">탭하여 크게 보기</p>
                        </div>
                      )}
                      <div className="space-y-2 text-sm">
                        {([["MBTI",a.mbti],["연락처",a.contact],["인스타그램","@"+a.instagram],["닮은꼴",a.celebrity]] as [string,string][]).map(([l,v])=>(
                          <div key={l} className="flex justify-between gap-4"><span className="text-muted-foreground shrink-0">{l}</span><span className="text-right break-all">{v}</span></div>
                        ))}
                      </div>
                      {([["요즘 삶",a.currentWork],["이루고 싶은 삶",a.lifeGoal],["혼자 있을 때",a.hobbies],["끌리는 사람",a.idealType],["나의 장점",a.charm]] as [string,string][]).map(([l,v])=>(
                        <div key={l}><p className="text-xs text-muted-foreground mb-1">{l}</p><p className="text-sm leading-relaxed">{v}</p></div>
                      ))}
                      <div className="text-xs text-muted-foreground border-t border-border pt-3">환불: {a.refundBank} {a.refundAccount}</div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => updateStatus(a.id,"approved")} disabled={a.status==="approved"} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-green-500/40 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-40">승인</button>
                        <button onClick={() => updateStatus(a.id,"rejected")} disabled={a.status==="rejected"} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40">거절</button>
                        <button onClick={() => updateStatus(a.id,"pending")} disabled={a.status==="pending"} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-40">대기</button>
                      </div>
                      {a.status === "approved" && (
                        <button onClick={() => setSmsModal(a)} className={`w-full py-2.5 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-colors ${a.smsSent?"border-green-500/40 text-green-400":"border-primary/40 text-primary hover:bg-primary/8"}`}>
                          <MessageSquare className="w-4 h-4" />{a.smsSent ? "SMS 발송 완료" : "SMS 발송하기"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "vote" && (
        <div className="px-4 space-y-4">
          <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-semibold text-sm">남성 신청 접수</p>
                <p className="text-xs text-muted-foreground mt-0.5">{settings.male_open ? "접수 중" : "마감됨"}</p>
              </div>
              <button onClick={() => toggleGenderOpen("남성")}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.male_open ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.male_open ? "left-7" : "left-1"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">여성 신청 접수</p>
                <p className="text-xs text-muted-foreground mt-0.5">{settings.female_open ? "접수 중" : "마감됨"}</p>
              </div>
              <button onClick={() => toggleGenderOpen("여성")}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.female_open ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.female_open ? "left-7" : "left-1"}`} />
              </button>
            </div>
          </div>

          <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">투표 오픈</p>
                <p className="text-xs text-muted-foreground mt-0.5">{settings.is_open ? "참가자들이 투표할 수 있습니다" : "투표가 닫혀 있습니다"}</p>
              </div>
              <button onClick={toggleVoteOpen} disabled={settings.is_closed}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_open ? "bg-primary" : "bg-muted"} disabled:opacity-40`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_open ? "left-7" : "left-1"}`} />
              </button>
            </div>
          </div>

          <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">투표 현황</p>
            <div className="flex gap-4">
              <div className="text-center flex-1"><p className="text-2xl font-bold text-primary">{submittedCount}</p><p className="text-xs text-muted-foreground mt-1">제출 완료</p></div>
              <div className="w-px bg-border" />
              <div className="text-center flex-1"><p className="text-2xl font-bold text-foreground">{approved.length}</p><p className="text-xs text-muted-foreground mt-1">총 승인 인원</p></div>
            </div>
          </div>

          {!settings.is_closed ? (
            <button onClick={() => setCloseConfirm(true)} disabled={!settings.is_open && submittedCount === 0}
              className="w-full py-3.5 rounded-2xl text-sm font-semibold border border-destructive/40 text-destructive hover:bg-destructive/8 transition-colors disabled:opacity-40">
              투표 마감 및 매칭 계산
            </button>
          ) : (
            <div className="bg-muted/40 border border-border rounded-2xl p-4 text-center">
              <p className="text-sm font-medium">투표가 마감되었습니다.</p>
              {settings.closed_at && <p className="text-xs text-muted-foreground mt-1">{new Date(settings.closed_at).toLocaleString("ko-KR")}</p>}
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">투표 결과</p>
            <div className="space-y-2">
              {approved
                .map(a => ({ ...a, count: subs.filter(s => s.voted_for_ids.includes(a.id)).length, voters: subs.filter(s => s.voted_for_ids.includes(a.id)).map(s => apps.find(x => x.id === s.voter_id)?.nickname || "알 수 없음") }))
                .sort((a,b) => b.count - a.count)
                .map((a,i) => (
                  <div key={a.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl p-3.5 flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i===0?"bg-primary/20 text-primary":i===1?"bg-slate-400/20 text-slate-400":i===2?"bg-orange-600/20 text-orange-500":"bg-muted text-muted-foreground"}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{a.nickname}</p>
                      {a.voters.length > 0 && <p className="text-xs text-muted-foreground truncate">{a.voters.join(", ")}님이 투표</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0"><Heart className="w-3.5 h-3.5 fill-primary text-primary" /><span className="font-bold text-sm text-primary">{a.count}</span></div>
                  </div>
                ))}
              {!approved.length && <p className="text-center text-muted-foreground text-sm py-6">승인된 참가자가 없습니다.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "matching" && (
        <div className="px-4 space-y-3">
          {!settings.is_closed && <div className="bg-muted/40 border border-border rounded-xl p-4 text-center"><p className="text-sm text-muted-foreground">투표 마감 후 매칭 결과가 계산됩니다.</p></div>}
          {matches.length === 0 && settings.is_closed && <p className="text-center text-muted-foreground text-sm py-12">매칭된 쌍이 없습니다.</p>}
          {matches.map((m) => {
            const u1 = apps.find(a => a.id === m.user1_id);
            const u2 = apps.find(a => a.id === m.user2_id);
            const st = getMatchStatusFromRow(m);
            const stLabel = { pending: "대기 중", success: "매칭 성사", closed: "종료" };
            const stColor = { pending: "text-amber-400", success: "text-green-400", closed: "text-muted-foreground" };
            return (
              <div key={m.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 text-center">
                    <div className="w-10 h-10 rounded-full bg-muted mx-auto overflow-hidden">{u1 && getProfilePhoto(u1) ? <img src={getProfilePhoto(u1)!} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted" />}</div>
                    <p className="text-xs font-medium mt-1">{u1?.nickname}</p>
                  </div>
                  <Heart className="w-4 h-4 fill-primary text-primary shrink-0" />
                  <div className="flex-1 text-center">
                    <div className="w-10 h-10 rounded-full bg-muted mx-auto overflow-hidden">{u2 && getProfilePhoto(u2) ? <img src={getProfilePhoto(u2)!} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted" />}</div>
                    <p className="text-xs font-medium mt-1">{u2?.nickname}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs border-t border-border pt-3">
                  <span className="text-muted-foreground">응답: {m.user1_response === "going" ? "간다" : m.user1_response === "not_going" ? "안 간다" : "대기"} / {m.user2_response === "going" ? "간다" : m.user2_response === "not_going" ? "안 간다" : "대기"}</span>
                  <span className={`font-medium ${stColor[st]}`}>{stLabel[st]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {photoModal && (
        <div className="fixed inset-0 bg-black/92 z-50 flex flex-col items-center justify-center p-4" onClick={() => setPhotoModal(null)}>
          <img src={photoModal[photoIdx]} alt="" className="max-w-full max-h-[75vh] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
          {photoModal.length > 1 && <div className="flex gap-2 mt-4" onClick={e => e.stopPropagation()}>{photoModal.map((_,i)=><button key={i} onClick={()=>setPhotoIdx(i)} className={`w-2.5 h-2.5 rounded-full transition-all ${i===photoIdx?"bg-primary":"bg-white/30"}`}/>)}</div>}
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center" onClick={() => setPhotoModal(null)}><X className="w-5 h-5 text-white" /></button>
        </div>
      )}

      {smsModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={() => setSmsModal(null)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">SMS 발송</h3>
            <p className="text-xs text-muted-foreground mb-4">{smsModal.name} ({smsModal.nickname})님에게 승인 문자를 발송합니다.</p>
            <div className="bg-secondary rounded-xl p-4 mb-4 space-y-2 text-sm">
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">수신자</span><span>{smsModal.contact}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">내용</span><span>{SMS_TEXT}</span></div>
            </div>
            <div className="flex gap-2">
              <a href={`sms:${smsModal.contact}?body=${encodeURIComponent(SMS_TEXT)}`} onClick={() => { markSmsSent(smsModal.id); setSmsModal(null); }} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground text-center hover:opacity-90 transition-opacity">문자 앱 열기</a>
              <button onClick={() => setSmsModal(null)} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}

      {closeConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setCloseConfirm(false)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">투표를 마감하시겠습니까?</h3>
            <p className="text-sm text-muted-foreground mb-5">마감 후에는 다시 열 수 없으며, 즉시 매칭이 계산됩니다.</p>
            <div className="flex gap-2">
              <button onClick={closeVoting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-white hover:opacity-90 transition-opacity">마감 확인</button>
              <button onClick={() => setCloseConfirm(false)} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── PC ADMIN ─── */
function PCAdminPage({ go }: { go: (v: View) => void }) {
  const [section, setSection] = useState<PCSection>("applications");
  const [apps, setApps] = useState<Application[]>([]);
  const [subs, setSubs] = useState<{ voter_id: string; voted_for_ids: string[] }[]>([]);
  const [matches, setMatches] = useState<{
    id: string; user1_id: string; user2_id: string;
    calculated_at: string; user1_response: string; user2_response: string;
  }[]>([]);
  const [settings, setSettings] = useState<{
    is_open: boolean; is_closed: boolean; closed_at?: string;
    male_open: boolean; female_open: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [gFilter, setGFilter] = useState<GenderFilter>("전체");
  const [sFilter, setSFilter] = useState<StatusFilter>("전체");
  const [sortBy, setSortBy] = useState<string>("submittedAt");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [selected, setSelected] = useState<Application | null>(null);
  const [smsModal, setSmsModal] = useState<Application | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [photoModal, setPhotoModal] = useState<string[] | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);

  const refresh = async () => {
    const [appsRaw, subsRaw, matchesRaw, settingsRaw] = await Promise.all([
      adminApi.listApplicants(),
      adminApi.getVoteResults(),
      adminApi.getMatches(),
      adminApi.getVoteSettings(),
    ]);
    setApps(appsRaw.map((a: Record<string, unknown>) => ({
      id: a.id, name: a.name, gender: a.gender, age: a.age, nickname: a.nickname,
      mbti: a.mbti, contact: a.contact, job: a.job, jobDetail: a.job_detail,
      currentWork: a.current_work, lifeGoal: a.life_goal, hobbies: a.alone_time,
      instagram: a.instagram, idealType: a.ideal_type, charm: a.charm,
      celebrity: a.celebrity, photos: a.photos || [], voteProfilePhoto: a.vote_profile_photo,
      refundBank: a.refund_bank, refundAccount: a.refund_account,
      status: a.status, smsSent: a.sms_sent, submittedAt: a.submitted_at,
    })) as Application[]);
    setSubs(subsRaw);
    setMatches(matchesRaw);
    setSettings(settingsRaw);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const updateStatus = async (id: string, status: AppStatus) => {
    await adminApi.updateStatus(id, status);
    if (selected?.id === id) setSelected(u => u ? { ...u, status } : u);
    if (status === "approved") {
      const t = apps.find(a => a.id === id);
      if (t) setSmsModal(t);
    }
    refresh();
  };

  const markSmsSent = async (id: string) => {
    await adminApi.markSmsSent(id);
    if (selected?.id === id) setSelected(s => s ? { ...s, smsSent: true } : s);
    refresh();
  };

  const toggleVoteOpen = async () => {
    if (!settings) return;
    await adminApi.toggleVoteOpen(!settings.is_open);
    refresh();
  };

  const toggleGenderOpen = async (gender: Gender) => {
    if (!settings) return;
    const current = gender === "남성" ? settings.male_open : settings.female_open;
    await adminApi.toggleGenderOpen(gender, !current);
    refresh();
  };

  const closeVoting = async () => {
    await adminApi.closeVoting();
    setCloseConfirm(false);
    refresh();
  };

  if (loading || !settings) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">불러오는 중...</div>;
  }

  const approved = apps.filter(a => a.status === "approved");
  const statusLabel: Record<AppStatus, string> = { pending: "대기", approved: "승인", rejected: "거절" };
  const statusBg: Record<AppStatus, string> = { pending: "bg-amber-400/10 border-amber-400/30 text-amber-400", approved: "bg-green-400/10 border-green-400/30 text-green-400", rejected: "bg-destructive/10 border-destructive/30 text-destructive" };

  const filteredApps = apps
    .filter(a => (gFilter === "전체" || a.gender === gFilter) && (sFilter === "전체" || a.status === sFilter))
    .sort((a, b) => {
      const va = (a as Record<string,any>)[sortBy] || "";
      const vb = (b as Record<string,any>)[sortBy] || "";
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

  const toggleSort = (field: string) => { if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortBy(field); setSortDir("asc"); } };
  const SortIcon = ({ field }: { field: string }) => <span className="ml-1 text-muted-foreground/60">{sortBy === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>;

  const getMatchStatusFromRow = (m: { user1_response: string; user2_response: string }): "pending" | "success" | "closed" => {
    if (m.user1_response === "not_going" || m.user2_response === "not_going") return "closed";
    if (m.user1_response === "going" && m.user2_response === "going") return "success";
    return "pending";
  };

  const navItems: [PCSection, string][] = [["applications","신청 관리"],["vote-management","투표 관리"],["matching","매칭 현황"]];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="w-52 shrink-0 border-r border-border flex flex-col bg-[#131313]">
        <div className="p-5 border-b border-border">
          <p className="text-xs text-muted-foreground">솔로파티</p>
          <p className="font-bold mt-0.5">관리자</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(([s, label]) => (
            <button key={s} onClick={() => setSection(s)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${section === s ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button onClick={() => { adminApi.logout(); go("home"); }} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
            <LogOut className="w-4 h-4" /> 나가기
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {section === "applications" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="text-base font-semibold">신청 목록 ({filteredApps.length}명)</h2>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    {(["전체","남성","여성"] as GenderFilter[]).map(g => <button key={g} onClick={() => setGFilter(g)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${gFilter===g?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>{g}</button>)}
                  </div>
                  <div className="flex gap-1.5">
                    {(["전체","pending","approved","rejected"] as StatusFilter[]).map(s => {
                      const l: Record<StatusFilter,string>={전체:"전체",pending:"대기",approved:"승인",rejected:"거절"};
                      return <button key={s} onClick={() => setSFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${sFilter===s?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>{l[s]}</button>;
                    })}
                  </div>
                  <button onClick={() => downloadCSV(filteredApps)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all">
                    <Download className="w-3.5 h-3.5" /> CSV 내보내기
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#131313] border-b border-[rgba(240,168,190,0.20)]">
                    <tr>
                      {([["name","이름"],["gender","성별"],["age","나이"],["nickname","닉네임"],["contact","연락처"],["job","직업"]] as [string,string][]).map(([f,l]) => (
                        <th key={f} onClick={() => toggleSort(f)} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none">
                          {l}<SortIcon field={f} />
                        </th>
                      ))}
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">상태</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">SMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((a) => (
                      <tr key={a.id} onClick={() => setSelected(a)}
                        className={`border-b border-border cursor-pointer transition-colors hover:bg-secondary/50 ${selected?.id === a.id ? "bg-primary/8" : ""}`}>
                        <td className="px-4 py-3 font-medium">{a.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.gender}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.age}세</td>
                        <td className="px-4 py-3">{a.nickname}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.contact}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{a.job}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusBg[a.status]}`}>{statusLabel[a.status]}</span></td>
                        <td className="px-4 py-3">{a.smsSent ? <span className="text-green-400 text-xs">발송</span> : <span className="text-muted-foreground text-xs">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredApps.length && <p className="text-center text-muted-foreground text-sm py-12">신청서가 없습니다.</p>}
              </div>
            </div>

            {selected && (
              <div className="w-80 border-l border-border flex flex-col overflow-hidden shrink-0">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="font-semibold text-sm">{selected.name}</h3>
                  <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                  {!!selected.photos?.length && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {selected.photos.map((p,i) => <button key={i} onClick={() => { setPhotoModal(selected.photos); setPhotoIdx(i); }} className="aspect-square"><img src={p} alt="" className="w-full h-full object-cover rounded-lg" /></button>)}
                    </div>
                  )}
                  <div className="space-y-2">
                    {([["성별",selected.gender],["나이",selected.age+"세"],["MBTI",selected.mbti],["닉네임",selected.nickname],["연락처",selected.contact],["인스타",`@${selected.instagram}`],["닮은꼴",selected.celebrity]] as [string,string][]).map(([l,v])=>(
                      <div key={l} className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">{l}</span><span className="text-right break-all">{v}</span></div>
                    ))}
                  </div>
                  {([["요즘 삶",selected.currentWork],["이루고 싶은 삶",selected.lifeGoal],["혼자 있을 때",selected.hobbies],["끌리는 사람",selected.idealType],["나의 장점",selected.charm]] as [string,string][]).map(([l,v])=>(
                    <div key={l}><p className="text-xs text-muted-foreground mb-1">{l}</p><p className="text-xs leading-relaxed">{v}</p></div>
                  ))}
                  <p className="text-xs text-muted-foreground">환불: {selected.refundBank} {selected.refundAccount}</p>
                </div>
                <div className="p-4 border-t border-border space-y-2">
                  <div className="flex gap-2">
                    <button onClick={() => updateStatus(selected.id,"approved")} disabled={selected.status==="approved"} className="flex-1 py-2 rounded-lg text-xs font-medium border border-green-500/40 text-green-400 hover:bg-green-400/10 disabled:opacity-40">승인</button>
                    <button onClick={() => updateStatus(selected.id,"rejected")} disabled={selected.status==="rejected"} className="flex-1 py-2 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40">거절</button>
                    <button onClick={() => updateStatus(selected.id,"pending")} disabled={selected.status==="pending"} className="flex-1 py-2 rounded-lg text-xs font-medium border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 disabled:opacity-40">대기</button>
                  </div>
                  {selected.status === "approved" && (
                    <button onClick={() => setSmsModal(selected)} className={`w-full py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 ${selected.smsSent?"border-green-500/40 text-green-400":"border-primary/40 text-primary hover:bg-primary/8"}`}>
                      <MessageSquare className="w-3.5 h-3.5" />{selected.smsSent?"SMS 완료":"SMS 발송"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {section === "vote-management" && (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-base font-semibold mb-5">투표 관리</h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">남성 신청 접수</p>
                  <button onClick={() => toggleGenderOpen("남성")}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.male_open ? "bg-primary" : "bg-muted"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.male_open ? "left-7" : "left-1"}`} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{settings.male_open ? "접수 중" : "마감됨"}</p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">여성 신청 접수</p>
                  <button onClick={() => toggleGenderOpen("여성")}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.female_open ? "bg-primary" : "bg-muted"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.female_open ? "left-7" : "left-1"}`} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{settings.female_open ? "접수 중" : "마감됨"}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-sm">투표 오픈</p>
                  <button onClick={toggleVoteOpen} disabled={settings.is_closed}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_open?"bg-primary":"bg-muted"} disabled:opacity-40`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_open?"left-7":"left-1"}`} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{settings.is_closed ? "투표 마감됨" : settings.is_open ? "투표 진행 중" : "투표 대기 중"}</p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <p className="text-2xl font-bold text-primary">{subs.length} <span className="text-sm font-normal text-muted-foreground">/ {approved.length}</span></p>
                <p className="text-xs text-muted-foreground mt-1">투표 제출 현황</p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <p className="text-2xl font-bold text-primary">{matches.length}</p>
                <p className="text-xs text-muted-foreground mt-1">매칭 쌍</p>
              </div>
            </div>

            {!settings.is_closed ? (
              <button onClick={() => setCloseConfirm(true)} className="mb-6 px-5 py-2.5 rounded-xl text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/8 transition-colors">
                투표 마감 및 매칭 계산
              </button>
            ) : (
              <div className="mb-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-sm text-muted-foreground">
                투표 마감 완료 {settings.closed_at && `· ${new Date(settings.closed_at).toLocaleString("ko-KR")}`}
              </div>
            )}

            <h3 className="text-sm font-semibold mb-3">투표 결과</h3>
            <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">순위</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">닉네임</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">성별</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">득표수</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">투표자</th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map(a => ({ ...a, count: subs.filter(s => s.voted_for_ids.includes(a.id)).length, voters: subs.filter(s => s.voted_for_ids.includes(a.id)).map(s => apps.find(x => x.id === s.voter_id)?.nickname || "?") }))
                    .sort((a,b) => b.count - a.count)
                    .map((a,i) => (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-muted-foreground">{i+1}</td>
                        <td className="px-4 py-3 font-medium">{a.nickname}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.gender}</td>
                        <td className="px-4 py-3"><span className="text-primary font-semibold">{a.count}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{a.voters.join(", ") || "-"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!approved.length && <p className="text-center text-muted-foreground text-sm py-6">승인된 참가자가 없습니다.</p>}
            </div>
          </div>
        )}

        {section === "matching" && (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-base font-semibold mb-5">매칭 현황 ({matches.length}쌍)</h2>
            {!settings.is_closed && <div className="bg-muted/40 border border-border rounded-xl p-4 mb-4"><p className="text-sm text-muted-foreground">투표 마감 후 매칭 결과가 계산됩니다.</p></div>}
            <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">참가자 1</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">참가자 2</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">응답 1</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">응답 2</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">상태</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">계산 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(m => {
                    const u1 = apps.find(a => a.id === m.user1_id);
                    const u2 = apps.find(a => a.id === m.user2_id);
                    const st = getMatchStatusFromRow(m);
                    const rLabel: Record<string,string> = { pending: "-", going: "간다", not_going: "안 간다" };
                    const stEl = { pending: <span className="text-amber-400 text-xs font-medium">대기 중</span>, success: <span className="text-green-400 text-xs font-medium">매칭 성사</span>, closed: <span className="text-muted-foreground text-xs">종료</span> };
                    return (
                      <tr key={m.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">{u1?.nickname || "-"}</td>
                        <td className="px-4 py-3">{u2?.nickname || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{rLabel[m.user1_response]}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{rLabel[m.user2_response]}</td>
                        <td className="px-4 py-3">{stEl[st]}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(m.calculated_at).toLocaleString("ko-KR")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!matches.length && <p className="text-center text-muted-foreground text-sm py-8">매칭 데이터가 없습니다.</p>}
            </div>
          </div>
        )}
      </div>

      {photoModal && (
        <div className="fixed inset-0 bg-black/92 z-50 flex flex-col items-center justify-center p-4" onClick={() => setPhotoModal(null)}>
          <img src={photoModal[photoIdx]} alt="" className="max-w-full max-h-[80vh] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
          {photoModal.length > 1 && <div className="flex gap-2 mt-4" onClick={e => e.stopPropagation()}>{photoModal.map((_,i)=><button key={i} onClick={()=>setPhotoIdx(i)} className={`w-2.5 h-2.5 rounded-full ${i===photoIdx?"bg-primary":"bg-white/30"}`}/>)}</div>}
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center" onClick={() => setPhotoModal(null)}><X className="w-5 h-5 text-white" /></button>
        </div>
      )}

      {smsModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSmsModal(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">SMS 발송</h3>
            <p className="text-xs text-muted-foreground mb-4">{smsModal.name} ({smsModal.nickname})님에게 발송합니다.</p>
            <div className="bg-secondary rounded-xl p-4 mb-4 space-y-2 text-sm">
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">수신자</span><span>{smsModal.contact}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">내용</span><span>{SMS_TEXT}</span></div>
            </div>
            <div className="flex gap-2">
              <a href={`sms:${smsModal.contact}?body=${encodeURIComponent(SMS_TEXT)}`} onClick={() => { markSmsSent(smsModal.id); setSmsModal(null); }} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground text-center hover:opacity-90">문자 앱 열기</a>
              <button onClick={() => setSmsModal(null)} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground">닫기</button>
            </div>
          </div>
        </div>
      )}

      {closeConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setCloseConfirm(false)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">투표를 마감하시겠습니까?</h3>
            <p className="text-sm text-muted-foreground mb-5">마감 후에는 다시 열 수 없으며, 즉시 매칭이 계산됩니다.</p>
            <div className="flex gap-2">
              <button onClick={closeVoting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-white hover:opacity-90">마감 확인</button>
              <button onClick={() => setCloseConfirm(false)} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground">취소</button>
            </div>
          </div>
        </div>
      )}
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
    <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${
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

function FInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input { ...props} className={`w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors ${className}`} />;
}

function FTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea { ...props} rows={3} className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors resize-none" />;
}

function FSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select { ...props} className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground outline-none focus:border-primary transition-colors appearance-none">{children}</select>;
}