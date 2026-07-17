import React, { useEffect, useState } from "react";
import {
  ChevronDown, ChevronUp, Eye, EyeOff, Heart, LogOut, MessageSquare, Banknote, Trash2, X, RefreshCw,
} from "lucide-react";
import { adminApi } from "./adminApi";
import { FormField, FInput } from "./ui";
import {
  Application, AppStatus, Gender, GenderFilter, StatusFilter, AdminTab, PCSection,
} from "./types";
import { getSmsSubject, getSmsBody, getSmsKindLabel, getProfilePhoto, useIsPC, statusLabel, formatAge, buildVoteLeaderboard } from "./utils";
import { LoungeEntryCheck } from "./LoungeEntryCheck";

type View = "login" | "admin";

export default function App() {
  const [view, setView] = useState<View>("login");

  useEffect(() => {
    if (adminApi.hasSession()) setView("admin");
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {view === "login" && <AdminLoginPage onLogin={() => setView("admin")} />}
      {view === "admin" && <AdminPage onLogout={() => setView("login")} />}
    </div>
  );
}

function AdminLoginPage({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (adminApi.hasSession()) onLogin();
  }, []);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        throw new Error("missing_env");
      }
      await adminApi.login(pw);
      onLogin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "missing_env") {
        setError("Supabase 설정이 없습니다. Vercel Environment Variables에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 넣고 Redeploy 해 주세요.");
      } else if (msg === "db_not_setup") {
        setError("Supabase DB가 아직 설정되지 않았습니다. SQL Editor에서 초기 스키마를 실행해 주세요.");
      } else if (msg === "db_fix_needed") {
        setError("DB 보안 설정을 한 번 더 실행해 주세요. (002_fix_pgcrypto.sql)");
      } else if (msg === "wrong password") {
        setError("비밀번호가 올바르지 않습니다.");
      } else if (/Invalid path/i.test(msg) || msg.includes("PGRST125")) {
        setError("Supabase URL이 잘못되었습니다. Vercel Env의 VITE_SUPABASE_URL은 https://xxxx.supabase.co 형태여야 하고, /rest/v1 은 빼 주세요. 수정 후 Redeploy 하세요.");
      } else {
        setError(msg || "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-16">
      <div className="pt-6 pb-10">
        <p className="text-xs text-muted-foreground mb-1">솔로파티</p>
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
function AdminPage({ onLogout }: { onLogout: () => void }) {
  const isPC = useIsPC();
  return isPC ? <PCAdminPage onLogout={onLogout} /> : <MobileAdminPage onLogout={onLogout} />;
}

/* ─── MOBILE ADMIN ─── */
function MobileAdminPage({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<AdminTab>("apps");
  const [apps, setApps] = useState<Application[]>([]);
  const [subs, setSubs] = useState<{ voter_id: string; voted_for_id: string; message: string }[]>([]);
  const [matches, setMatches] = useState<{
    id: string; user1_id: string; user2_id: string;
    user1_response: string; user2_response: string;
    lounge_entered: boolean;
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
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState("");
  const [smsForce, setSmsForce] = useState(false);
  const [smsInfo, setSmsInfo] = useState("");
  const [deleteModal, setDeleteModal] = useState<Application | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [rejectModal, setRejectModal] = useState<Application | null>(null);
  const [rejectError, setRejectError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [depositToggling, setDepositToggling] = useState(false);
  const [voteConfirm, setVoteConfirm] = useState<null | "open" | "close" | "unclose" | "clear">(null);
  const [voteActionError, setVoteActionError] = useState("");
  const [voteActing, setVoteActing] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundActing, setRefundActing] = useState(false);
  const [loungeTogglingId, setLoungeTogglingId] = useState<string | null>(null);

  const refresh = async () => {
    const ok = await adminApi.verifySession();
    if (!ok) {
      adminApi.logout();
      onLogout();
      return;
    }
    try {
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
        status: a.status, smsSent: !!a.sms_sent, feeConfirmed: !!a.fee_confirmed,
        depositConfirmed: !!a.deposit_confirmed, submittedAt: a.submitted_at,
      })) as Application[]);
      setSubs(subsRaw);
      setMatches(matchesRaw);
      setSettings(settingsRaw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const pull = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30000);
    return () => clearInterval(poll);
  }, []);

  const updateStatus = async (id: string, status: AppStatus) => {
    try {
      await adminApi.updateStatus(id, status);
      if (status === "approved" || status === "rejected") {
        const t = apps.find(a => a.id === id);
        if (t) {
          setSmsError("");
          setSmsInfo("");
          setSmsForce(false);
          setSmsModal({ ...t, status, smsSent: false });
        }
      }
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "상태 변경에 실패했습니다.";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setVoteActionError(msg);
    }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    setRejecting(true);
    setRejectError("");
    try {
      await adminApi.updateStatus(rejectModal.id, "rejected");
      setSmsError("");
      setSmsInfo("");
      setSmsForce(false);
      setSmsModal({ ...rejectModal, status: "rejected", smsSent: false });
      setRejectModal(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "거절 처리에 실패했습니다.";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setRejectError(msg);
    } finally {
      setRejecting(false);
    }
  };

  const toggleDeposit = async (id: string, confirmed: boolean) => {
    setDepositToggling(true);
    setDepositError("");
    try {
      await adminApi.toggleDepositConfirmed(id, confirmed);
      await refresh();
    } catch (e) {
      setDepositError(e instanceof Error ? e.message : "입금 확인 저장에 실패했습니다.");
    } finally {
      setDepositToggling(false);
    }
  };

  const markSmsSent = async (id: string) => {
    await adminApi.markSmsSent(id);
    refresh();
  };

  const sendSms = async () => {
    if (!smsModal) return;
    setSmsSending(true);
    setSmsError("");
    setSmsInfo("");
    try {
      const res = await adminApi.sendSms(
        smsModal.id,
        getSmsBody(smsModal.status),
        getSmsSubject(smsModal.status),
        { force: smsForce },
      );
      if (res.already_sent) {
        setSmsInfo("이미 발송된 문자입니다. 다시 보내려면 ‘강제 재발송’을 체크하세요.");
        return;
      }
      setSmsModal(null);
      setSmsForce(false);
      refresh();
    } catch (e) {
      setSmsError(e instanceof Error ? e.message : "문자 전송에 실패했습니다.");
    } finally {
      setSmsSending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await adminApi.deleteApplicant(deleteModal.id);
      if (expanded === deleteModal.id) setExpanded(null);
      setDeleteModal(null);
      refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const markRefundDone = async (id: string) => {
    setRefundActing(true);
    setRefundError("");
    try {
      await adminApi.markRefundCompleted(id);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "환불 완료 처리에 실패했습니다.";
      if (msg.includes("만료")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setRefundError(msg);
    } finally {
      setRefundActing(false);
    }
  };

  const toggleVoteOpen = () => {
    if (!settings) return;
    if (settings.is_open) {
      void (async () => {
        try {
          await adminApi.toggleVoteOpen(false);
          refresh();
        } catch (e) {
          setVoteActionError(e instanceof Error ? e.message : "투표 설정 실패");
        }
      })();
      return;
    }
    if (settings.male_open || settings.female_open) {
      setVoteActionError("남·여 신청 접수를 모두 마감한 뒤에만 투표를 열 수 있습니다.");
      return;
    }
    setVoteActionError("");
    setVoteConfirm("open");
  };

  const toggleGenderOpen = async (gender: Gender) => {
    if (!settings) return;
    const current = gender === "남성" ? settings.male_open : settings.female_open;
    await adminApi.toggleGenderOpen(gender, !current);
    refresh();
  };

  const toggleVoteClosed = () => {
    if (!settings) return;
    setVoteActionError("");
    setVoteConfirm(settings.is_closed ? "unclose" : "close");
  };

  const confirmVoteAction = async () => {
    if (!voteConfirm || !settings) return;
    setVoteActing(true);
    setVoteActionError("");
    try {
      if (voteConfirm === "open") {
        await adminApi.toggleVoteOpen(true);
      } else if (voteConfirm === "close") {
        await adminApi.toggleVoteClosed(true);
      } else if (voteConfirm === "unclose") {
        await adminApi.toggleVoteClosed(false);
      } else if (voteConfirm === "clear") {
        await adminApi.clearVoteData();
        // refresh 전에 즉시 비워서 이전 투표/쪽지/매칭이 화면에 남지 않게 함
        setSubs([]);
        setMatches([]);
      }
      setVoteConfirm(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "작업에 실패했습니다.";
      if (msg.includes("만료")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setVoteActionError(msg);
    } finally {
      setVoteActing(false);
    }
  };

  const toggleLoungeEntered = async (matchId: string, entered: boolean) => {
    setLoungeTogglingId(matchId);
    try {
      await adminApi.toggleMatchLoungeEntered(matchId, entered);
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, lounge_entered: entered } : m));
    } finally {
      setLoungeTogglingId(null);
    }
  };

  if (loading || !settings) {
    return <div className="max-w-md mx-auto pb-16 px-4 pt-12 text-center text-muted-foreground text-sm">불러오는 중...</div>;
  }

  const approved = apps.filter(a => a.status === "approved");
  const submittedCount = new Set(subs.map(s => s.voter_id)).size;
  const statusColor: Record<AppStatus, string> = {
    pending: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    approved: "text-green-400 bg-green-400/10 border-green-400/30",
    rejected: "text-destructive bg-destructive/10 border-destructive/30",
    refund_requested: "text-sky-400 bg-sky-400/10 border-sky-400/30",
    refunded: "text-muted-foreground bg-muted/40 border-border",
  };
  const cnt = (g: GenderFilter, s: AppStatus | "all" | "refund") =>
    apps.filter(a => {
      if (g !== "전체" && a.gender !== g) return false;
      if (s === "all") return true;
      if (s === "refund") return a.status === "refund_requested" || a.status === "refunded";
      return a.status === s;
    }).length;
  const filteredApps = apps.filter(a => {
    if (gFilter !== "전체" && a.gender !== gFilter) return false;
    if (sFilter === "전체") return true;
    if (sFilter === "refund") return a.status === "refund_requested" || a.status === "refunded";
    return a.status === sFilter;
  });

  const getMatchStatusFromRow = (m: { user1_response: string; user2_response: string }): "pending" | "success" | "closed" => {
    if (m.user1_response === "not_going" || m.user2_response === "not_going") return "closed";
    if (m.user1_response === "going" && m.user2_response === "going") return "success";
    return "pending";
  };

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-4 pt-6 pb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">관리자 대시보드</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { void pull(); }}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            aria-label="새로고침"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => { adminApi.logout(); onLogout(); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><LogOut className="w-3.5 h-3.5" /> 나가기</button>
        </div>
      </div>

      <div className="px-4 flex gap-1.5 mb-4">
        {([["apps", "신청"], ["vote", "투표"], ["matching", "매칭"]] as [AdminTab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${tab === t ? "bg-primary/15 border-primary/40 text-primary" : "bg-[#131313] border-[rgba(240,168,190,0.30)] text-[#888888]"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "apps" && (
        <div className="px-4">
          <div className="flex gap-2 mb-3">
            {([["all","전체","text-foreground"],["pending","대기","text-amber-400"],["approved","승인","text-green-400"],["rejected","거절","text-destructive"],["refund","환불","text-sky-400"]] as const).map(([k,l,c]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === "all") setSFilter("전체");
                  else if (k === "refund") setSFilter("refund");
                  else setSFilter(k);
                }}
                className="flex-1 min-w-0 bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl px-1 py-2.5 text-center"
              >
                <p className={`text-base font-bold leading-none ${c}`}>{cnt("전체", k)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{l}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">남{cnt("남성",k)} / 여{cnt("여성",k)}</p>
              </button>
            ))}
          </div>
          <div className="mb-3 space-y-2">
            <div className="rounded-xl border border-border bg-secondary/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground mb-1.5 tracking-wide">성별</p>
              <div className="flex gap-2">
                {(["전체","남성","여성"] as GenderFilter[]).map(g => (
                  <button key={g} onClick={() => setGFilter(g)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${gFilter===g?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/20 p-2.5">
              <p className="text-[10px] font-medium text-muted-foreground mb-1.5 tracking-wide">상태</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["전체", "전체"],
                  ["pending", "대기"],
                  ["approved", "승인"],
                  ["rejected", "거절"],
                  ["refund_requested", "환불요청"],
                  ["refunded", "환불완료"],
                ] as const).map(([s, label]) => (
                  <button key={s} onClick={() => setSFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${sFilter===s?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>
                    {label}
                    {s !== "전체" && (
                      <span className="ml-1 opacity-70">{cnt("전체", s)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
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
                        {a.smsSent
                          ? <MessageSquare className="w-3 h-3 text-green-400" />
                          : (a.status === "approved" || a.status === "rejected") && (
                            <span className="text-[10px] text-amber-400 font-medium">문자 미발송</span>
                          )}
                        {a.depositConfirmed && <Banknote className="w-3 h-3 text-green-400" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.gender} · {formatAge(a.age)} · {a.job}{a.jobDetail?` (${a.jobDetail})`:""}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border shrink-0 ${statusColor[a.status]}`}>{statusLabel(a.status)}</span>
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
                      <div className="text-xs text-muted-foreground border-t border-border pt-3 space-y-1">
                        <p>환불 계좌: {a.refundBank} {a.refundAccount}</p>
                        <p>입금 확인: {a.depositConfirmed ? "확인됨" : "미확인"}</p>
                        {a.status === "rejected" && (
                          <p className="text-destructive/90 pt-1">거절 · 전액 환불 자동 처리 — 위 계좌로 송금하세요.</p>
                        )}
                        {a.status === "refund_requested" && (
                          <p className="text-sky-400/90 pt-1">승인 후 본인 환불요청 — 송금 후 「환불 완료로 표시」를 눌러 주세요.</p>
                        )}
                      </div>
                      {depositError && <p className="text-xs text-destructive">{depositError}</p>}
                      {refundError && <p className="text-xs text-destructive">{refundError}</p>}
                      {a.status !== "rejected" && a.status !== "refunded" && (
                        <button
                          onClick={() => toggleDeposit(a.id, !a.depositConfirmed)}
                          disabled={depositToggling}
                          className={`w-full py-2.5 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                            a.depositConfirmed
                              ? "border-green-500/40 text-green-400 hover:bg-green-400/10"
                              : "border-primary/40 text-primary hover:bg-primary/8"
                          }`}>
                          <Banknote className="w-4 h-4" />
                          {depositToggling ? "저장 중..." : a.depositConfirmed ? "입금 확인 취소" : "입금 확인"}
                        </button>
                      )}
                      {a.status === "refund_requested" && (
                        <button
                          onClick={() => markRefundDone(a.id)}
                          disabled={refundActing}
                          className="w-full py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          {refundActing ? "처리 중..." : "환불 완료로 표시"}
                        </button>
                      )}
                      {(a.status === "pending" || a.status === "approved") && (
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => updateStatus(a.id,"approved")} disabled={a.status==="approved"} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-green-500/40 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-40">승인</button>
                          <button onClick={() => { setRejectError(""); setRejectModal(a); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors">거절</button>
                          <button onClick={() => updateStatus(a.id,"pending")} disabled={a.status==="pending"} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-40">대기</button>
                        </div>
                      )}
                      {(a.status === "approved" || a.status === "rejected") && (
                        a.smsSent ? (
                          <div className="w-full py-2.5 rounded-xl text-sm font-medium border border-green-500/40 text-green-400 flex items-center justify-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            {getSmsKindLabel(a.status)} 문자 발송됨
                          </div>
                        ) : (
                          <button
                            onClick={() => { setSmsError(""); setSmsInfo(""); setSmsForce(false); setSmsModal(a); }}
                            className="w-full py-2.5 rounded-xl text-sm font-medium border border-primary/40 text-primary hover:bg-primary/8 flex items-center justify-center gap-2 transition-colors"
                          >
                            <MessageSquare className="w-4 h-4" />
                            {getSmsKindLabel(a.status)} 문자 보내기
                          </button>
                        )
                      )}
                      <button onClick={() => { setDeleteError(""); setDeleteModal(a); }} className="w-full py-2.5 rounded-xl text-sm font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors flex items-center justify-center gap-2">
                        <Trash2 className="w-4 h-4" /> 신청자 삭제
                      </button>
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  {settings.is_open
                    ? "참가자들이 투표할 수 있습니다"
                    : settings.male_open || settings.female_open
                      ? "남·여 신청 접수 모두 마감 후 가능"
                      : "투표가 닫혀 있습니다"}
                </p>
              </div>
              <button onClick={toggleVoteOpen} disabled={settings.is_closed}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_open ? "bg-primary" : "bg-muted"} disabled:opacity-40`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_open ? "left-7" : "left-1"}`} />
              </button>
            </div>
          </div>

          <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">투표 마감 및 매칭</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {settings.is_closed
                    ? `마감됨 · 매칭 ${matches.length}쌍`
                    : "켜면 매칭이 계산되고 결과가 공개됩니다"}
                </p>
              </div>
              <button onClick={toggleVoteClosed}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_closed ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_closed ? "left-7" : "left-1"}`} />
              </button>
            </div>
            {settings.is_closed && settings.closed_at && (
              <p className="text-xs text-muted-foreground mt-2">{new Date(settings.closed_at).toLocaleString("ko-KR")} 마감</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => { setVoteActionError(""); setVoteConfirm("clear"); }}
            className="w-full py-3 rounded-2xl text-sm font-medium border border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            투표·쪽지 전체 초기화
          </button>
          {voteActionError && !voteConfirm && (
            <p className="text-xs text-destructive">{voteActionError}</p>
          )}

          <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">투표 현황</p>
            <div className="flex gap-4">
              <div className="text-center flex-1"><p className="text-2xl font-bold text-primary">{submittedCount}</p><p className="text-xs text-muted-foreground mt-1">투표 완료 인원</p></div>
              <div className="w-px bg-border" />
              <div className="text-center flex-1"><p className="text-2xl font-bold text-foreground">{approved.length}</p><p className="text-xs text-muted-foreground mt-1">총 승인 인원</p></div>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">투표 결과</p>
            <div className="space-y-2">
              {(() => {
                const board = buildVoteLeaderboard(approved, subs, apps, "알 수 없음");
                if (!approved.length) {
                  return <p className="text-center text-muted-foreground text-sm py-6">승인된 참가자가 없습니다.</p>;
                }
                if (!board.length) {
                  return <p className="text-center text-muted-foreground text-sm py-6">투표 결과가 없습니다.</p>;
                }
                return board.map((a, i) => (
                  <div key={a.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl p-3.5 flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i===0?"bg-primary/20 text-primary":i===1?"bg-slate-400/20 text-slate-400":i===2?"bg-orange-600/20 text-orange-500":"bg-muted text-muted-foreground"}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{a.nickname}</p>
                      {a.voters.length > 0 && <p className="text-xs text-muted-foreground truncate">{a.voters.join(", ")}님이 투표</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0"><Heart className="w-3.5 h-3.5 fill-primary text-primary" /><span className="font-bold text-sm text-primary">{a.count}</span></div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {tab === "matching" && (
        <div className="px-4">
          {!settings.is_closed && <div className="bg-muted/40 border border-border rounded-xl p-3 text-center mb-3"><p className="text-sm text-muted-foreground">투표 마감 후 매칭 결과가 계산됩니다.</p></div>}
          {matches.length === 0 && settings.is_closed && <p className="text-center text-muted-foreground text-sm py-12">매칭된 쌍이 없습니다.</p>}
          <div className="grid grid-cols-2 gap-2">
          {matches.map((m, idx) => {
            const u1 = apps.find(a => a.id === m.user1_id);
            const u2 = apps.find(a => a.id === m.user2_id);
            const maleApp = u1?.gender === "남성" ? u1 : u2;
            const femaleApp = u1?.gender === "여성" ? u1 : u2;
            const st = getMatchStatusFromRow(m);
            const stLabel = { pending: "대기", success: "성사", closed: "종료" };
            const stColor = { pending: "text-amber-400", success: "text-green-400", closed: "text-muted-foreground" };
            return (
              <div key={m.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl px-3 py-3.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate leading-tight">
                      {maleApp?.nickname || "-"} · {femaleApp?.nickname || "-"}
                    </p>
                    <LoungeEntryCheck
                      checked={m.lounge_entered}
                      disabled={loungeTogglingId === m.id}
                      onCheckedChange={(v) => { void toggleLoungeEntered(m.id, v); }}
                    />
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${stColor[st]}`}>{stLabel[st]}</span>
                </div>
              </div>
            );
          })}
          </div>
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
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={() => !smsSending && setSmsModal(null)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">{getSmsKindLabel(smsModal.status)} 문자를 보내시겠습니까?</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {smsModal.name} ({smsModal.nickname})님은 이미 {getSmsKindLabel(smsModal.status)} 처리되었습니다.
              문자를 보내려면 「문자 보내기」를, 문자 없이 마치려면 「닫기」를 눌러 주세요.
            </p>
            <div className="bg-secondary rounded-xl p-4 mb-4 space-y-2 text-sm max-h-64 overflow-y-auto">
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">수신자</span><span>{smsModal.contact}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">제목</span><span>{getSmsSubject(smsModal.status)}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">내용</span><span className="whitespace-pre-wrap text-left">{getSmsBody(smsModal.status)}</span></div>
            </div>
            {smsError && <p className="text-xs text-destructive mb-3">{smsError}</p>}
            {smsInfo && <p className="text-xs text-amber-400 mb-3">{smsInfo}</p>}
            <div className="flex gap-2">
              <button onClick={sendSms} disabled={smsSending} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                {smsSending ? "전송 중..." : "문자 보내기"}
              </button>
              <button onClick={() => { setSmsModal(null); setSmsError(""); setSmsInfo(""); setSmsForce(false); }} disabled={smsSending} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={() => !deleting && setDeleteModal(null)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">신청자 삭제</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              <span className="text-foreground font-medium">{deleteModal.name}</span> ({deleteModal.nickname})님을 목록에서 숨깁니다(소프트 삭제).
              세션·투표·매칭은 정리되며, 같은 연락처로 다시 신청할 수 있습니다.
            </p>
            {deleteError && <p className="text-xs text-destructive mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                {deleting ? "삭제 중..." : "삭제 확인"}
              </button>
              <button onClick={() => setDeleteModal(null)} disabled={deleting} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={() => !rejecting && setRejectModal(null)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">신청 거절</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              <span className="text-foreground font-medium">{rejectModal.name}</span> ({rejectModal.nickname})님을 거절합니다.
              세션이 끊기고 해당 참가자의 투표·받은 투표가 삭제됩니다. 투표가 진행 중이면 특히 주의하세요.
            </p>
            {rejectError && <p className="text-xs text-destructive mb-3">{rejectError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmReject} disabled={rejecting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
                {rejecting ? "처리 중..." : "거절 확인"}
              </button>
              <button onClick={() => setRejectModal(null)} disabled={rejecting} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {voteConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center p-4" onClick={() => !voteActing && setVoteConfirm(null)}>
          <div className="w-full max-w-md bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">
              {voteConfirm === "open" && "투표 오픈"}
              {voteConfirm === "close" && "투표 마감"}
              {voteConfirm === "unclose" && "마감 취소"}
              {voteConfirm === "clear" && "투표 데이터 초기화"}
            </h3>
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              {voteConfirm === "open" && (
                <>남·여 신청 접수가 모두 마감된 상태에서 투표를 엽니다. 기존 투표·쪽지 데이터는 유지됩니다. 처음부터 다시 하려면 「투표·쪽지 전체 초기화」를 사용하세요.</>
              )}
              {voteConfirm === "close" && <>마감하면 상호 투표로 매칭이 계산되고 결과가 공개됩니다. 투표 데이터는 유지됩니다.</>}
              {voteConfirm === "unclose" && <>마감을 취소합니다. 매칭·라운지 응답·입장 체크가 모두 지워집니다. 투표·쪽지 데이터는 유지됩니다.</>}
              {voteConfirm === "clear" && <>모든 투표·쪽지·매칭을 삭제합니다. 이 작업은 되돌릴 수 없습니다.</>}
            </p>
            {voteActionError && <p className="text-xs text-destructive mb-3">{voteActionError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmVoteAction} disabled={voteActing} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {voteActing ? "처리 중..." : "확인"}
              </button>
              <button onClick={() => setVoteConfirm(null)} disabled={voteActing} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ─── PC ADMIN ─── */
function PCAdminPage({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<PCSection>("applications");
  const [apps, setApps] = useState<Application[]>([]);
  const [subs, setSubs] = useState<{ voter_id: string; voted_for_id: string; message: string }[]>([]);
  const [matches, setMatches] = useState<{
    id: string; user1_id: string; user2_id: string;
    user1_response: string; user2_response: string;
    lounge_entered: boolean;
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
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState("");
  const [smsForce, setSmsForce] = useState(false);
  const [smsInfo, setSmsInfo] = useState("");
  const [deleteModal, setDeleteModal] = useState<Application | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [rejectModal, setRejectModal] = useState<Application | null>(null);
  const [rejectError, setRejectError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [depositToggling, setDepositToggling] = useState(false);
  const [photoModal, setPhotoModal] = useState<string[] | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [voteConfirm, setVoteConfirm] = useState<null | "open" | "close" | "unclose" | "clear">(null);
  const [voteActionError, setVoteActionError] = useState("");
  const [voteActing, setVoteActing] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundActing, setRefundActing] = useState(false);
  const [loungeTogglingId, setLoungeTogglingId] = useState<string | null>(null);

  const refresh = async () => {
    const ok = await adminApi.verifySession();
    if (!ok) {
      adminApi.logout();
      onLogout();
      return;
    }
    try {
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
        status: a.status, smsSent: !!a.sms_sent, feeConfirmed: !!a.fee_confirmed,
        depositConfirmed: !!a.deposit_confirmed, submittedAt: a.submitted_at,
      })) as Application[]);
      setSubs(subsRaw);
      setMatches(matchesRaw);
      setSettings(settingsRaw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const pull = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30000);
    return () => clearInterval(poll);
  }, []);

  const updateStatus = async (id: string, status: AppStatus) => {
    try {
      await adminApi.updateStatus(id, status);
      if (selected?.id === id) setSelected(u => u ? { ...u, status, smsSent: false } : u);
      if (status === "approved" || status === "rejected") {
        const t = apps.find(a => a.id === id);
        if (t) {
          setSmsError("");
          setSmsInfo("");
          setSmsForce(false);
          setSmsModal({ ...t, status, smsSent: false });
        }
      }
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
      }
    }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    setRejecting(true);
    setRejectError("");
    try {
      await adminApi.updateStatus(rejectModal.id, "rejected");
      if (selected?.id === rejectModal.id) setSelected(u => u ? { ...u, status: "rejected", smsSent: false } : u);
      setSmsError("");
      setSmsInfo("");
      setSmsForce(false);
      setSmsModal({ ...rejectModal, status: "rejected", smsSent: false });
      setRejectModal(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "거절 처리에 실패했습니다.";
      if (msg.includes("만료") || msg.includes("unauthorized")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setRejectError(msg);
    } finally {
      setRejecting(false);
    }
  };

  const toggleDeposit = async (id: string, confirmed: boolean) => {
    setDepositToggling(true);
    setDepositError("");
    try {
      await adminApi.toggleDepositConfirmed(id, confirmed);
      if (selected?.id === id) setSelected(s => s ? { ...s, depositConfirmed: confirmed } : s);
      await refresh();
    } catch (e) {
      setDepositError(e instanceof Error ? e.message : "입금 확인 저장에 실패했습니다.");
    } finally {
      setDepositToggling(false);
    }
  };

  const markSmsSent = async (id: string) => {
    await adminApi.markSmsSent(id);
    if (selected?.id === id) setSelected(s => s ? { ...s, smsSent: true } : s);
    refresh();
  };

  const sendSms = async () => {
    if (!smsModal) return;
    setSmsSending(true);
    setSmsError("");
    setSmsInfo("");
    try {
      const res = await adminApi.sendSms(
        smsModal.id,
        getSmsBody(smsModal.status),
        getSmsSubject(smsModal.status),
        { force: smsForce },
      );
      if (res.already_sent) {
        setSmsInfo("이미 발송된 문자입니다. 다시 보내려면 ‘강제 재발송’을 체크하세요.");
        return;
      }
      if (selected?.id === smsModal.id) setSelected(s => s ? { ...s, smsSent: true } : s);
      setSmsModal(null);
      setSmsForce(false);
      refresh();
    } catch (e) {
      setSmsError(e instanceof Error ? e.message : "문자 전송에 실패했습니다.");
    } finally {
      setSmsSending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await adminApi.deleteApplicant(deleteModal.id);
      if (selected?.id === deleteModal.id) setSelected(null);
      setDeleteModal(null);
      refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleVoteOpen = () => {
    if (!settings) return;
    if (settings.is_open) {
      void (async () => {
        try {
          await adminApi.toggleVoteOpen(false);
          refresh();
        } catch (e) {
          setVoteActionError(e instanceof Error ? e.message : "투표 설정 실패");
        }
      })();
      return;
    }
    if (settings.male_open || settings.female_open) {
      setVoteActionError("남·여 신청 접수를 모두 마감한 뒤에만 투표를 열 수 있습니다.");
      return;
    }
    setVoteActionError("");
    setVoteConfirm("open");
  };

  const toggleGenderOpen = async (gender: Gender) => {
    if (!settings) return;
    const current = gender === "남성" ? settings.male_open : settings.female_open;
    await adminApi.toggleGenderOpen(gender, !current);
    refresh();
  };

  const toggleVoteClosed = () => {
    if (!settings) return;
    setVoteActionError("");
    setVoteConfirm(settings.is_closed ? "unclose" : "close");
  };

  const confirmVoteAction = async () => {
    if (!voteConfirm || !settings) return;
    setVoteActing(true);
    setVoteActionError("");
    try {
      if (voteConfirm === "open") {
        await adminApi.toggleVoteOpen(true);
      } else if (voteConfirm === "close") {
        await adminApi.toggleVoteClosed(true);
      } else if (voteConfirm === "unclose") {
        await adminApi.toggleVoteClosed(false);
      } else if (voteConfirm === "clear") {
        await adminApi.clearVoteData();
        setSubs([]);
        setMatches([]);
      }
      setVoteConfirm(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "작업에 실패했습니다.";
      if (msg.includes("만료")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setVoteActionError(msg);
    } finally {
      setVoteActing(false);
    }
  };

  const markRefundDone = async (id: string) => {
    setRefundActing(true);
    setRefundError("");
    try {
      await adminApi.markRefundCompleted(id);
      if (selected?.id === id) setSelected(s => s ? { ...s, status: "refunded" } : s);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "환불 완료 처리에 실패했습니다.";
      if (msg.includes("만료")) {
        adminApi.logout();
        onLogout();
        return;
      }
      setRefundError(msg);
    } finally {
      setRefundActing(false);
    }
  };

  const toggleLoungeEntered = async (matchId: string, entered: boolean) => {
    setLoungeTogglingId(matchId);
    try {
      await adminApi.toggleMatchLoungeEntered(matchId, entered);
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, lounge_entered: entered } : m));
    } finally {
      setLoungeTogglingId(null);
    }
  };

  if (loading || !settings) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">불러오는 중...</div>;
  }

  const approved = apps.filter(a => a.status === "approved");
  const statusBg: Record<AppStatus, string> = {
    pending: "bg-amber-400/10 border-amber-400/30 text-amber-400",
    approved: "bg-green-400/10 border-green-400/30 text-green-400",
    rejected: "bg-destructive/10 border-destructive/30 text-destructive",
    refund_requested: "bg-sky-400/10 border-sky-400/30 text-sky-400",
    refunded: "bg-muted/40 border-border text-muted-foreground",
  };

  const filteredApps = apps
    .filter(a => {
      if (gFilter !== "전체" && a.gender !== gFilter) return false;
      if (sFilter === "전체") return true;
      if (sFilter === "refund") return a.status === "refund_requested" || a.status === "refunded";
      return a.status === sFilter;
    })
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

  const statusFilterCnt = (s: StatusFilter) => {
    if (s === "전체") return apps.length;
    if (s === "refund") return apps.filter(a => a.status === "refund_requested" || a.status === "refunded").length;
    return apps.filter(a => a.status === s).length;
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
          <button onClick={() => { adminApi.logout(); onLogout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
            <LogOut className="w-4 h-4" /> 나가기
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {section === "applications" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <h2 className="text-base font-semibold leading-none">신청 목록 ({filteredApps.length}명)</h2>
                  <button
                    type="button"
                    onClick={() => { void pull(); }}
                    disabled={refreshing}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                    aria-label="목록 새로고침"
                    title="새로고침"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground shrink-0">성별</span>
                    {(["전체","남성","여성"] as GenderFilter[]).map(g => (
                      <button key={g} onClick={() => setGFilter(g)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${gFilter===g?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>
                        {g}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-border shrink-0 hidden sm:block" aria-hidden />
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <span className="text-[10px] font-medium text-muted-foreground shrink-0">상태</span>
                    {([
                      ["전체", "전체"],
                      ["pending", "대기"],
                      ["approved", "승인"],
                      ["rejected", "거절"],
                      ["refund", "환불"],
                      ["refund_requested", "환불요청"],
                      ["refunded", "환불완료"],
                    ] as const).map(([s, label]) => (
                      <button key={s} onClick={() => setSFilter(s)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${sFilter===s?"border-primary bg-primary/12 text-primary":"border-border text-muted-foreground"}`}>
                        {label}
                        {s !== "전체" && <span className="ml-1 opacity-70">{statusFilterCnt(s)}</span>}
                      </button>
                    ))}
                  </div>
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
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">입금</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">SMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((a) => (
                      <tr key={a.id} onClick={() => setSelected(a)}
                        className={`border-b border-border cursor-pointer transition-colors hover:bg-secondary/50 ${selected?.id === a.id ? "bg-primary/8" : ""}`}>
                        <td className="px-4 py-3 font-medium">{a.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.gender}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatAge(a.age)}</td>
                        <td className="px-4 py-3">{a.nickname}</td>
                        <td className="px-4 py-3 text-muted-foreground">{a.contact}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{a.job}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusBg[a.status]}`}>{statusLabel(a.status)}</span></td>
                        <td className="px-4 py-3">
                          {a.depositConfirmed
                            ? <span className="text-green-400 text-xs font-medium">확인</span>
                            : <span className="text-amber-400 text-xs">미확인</span>}
                        </td>
                        <td className="px-4 py-3">
                          {a.status === "approved" || a.status === "rejected"
                            ? (a.smsSent
                              ? <span className="text-green-400 text-xs">발송</span>
                              : <span className="text-amber-400 text-xs">미발송</span>)
                            : <span className="text-muted-foreground text-xs">-</span>}
                        </td>
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
                    {([["성별",selected.gender],["나이",formatAge(selected.age)],["MBTI",selected.mbti],["닉네임",selected.nickname],["연락처",selected.contact],["인스타",`@${selected.instagram}`],["닮은꼴",selected.celebrity]] as [string,string][]).map(([l,v])=>(
                      <div key={l} className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">{l}</span><span className="text-right break-all">{v}</span></div>
                    ))}
                  </div>
                  {([["요즘 삶",selected.currentWork],["이루고 싶은 삶",selected.lifeGoal],["혼자 있을 때",selected.hobbies],["끌리는 사람",selected.idealType],["나의 장점",selected.charm]] as [string,string][]).map(([l,v])=>(
                    <div key={l}><p className="text-xs text-muted-foreground mb-1">{l}</p><p className="text-xs leading-relaxed">{v}</p></div>
                  ))}
                  <p className="text-xs text-muted-foreground">환불 계좌: {selected.refundBank} {selected.refundAccount}</p>
                  <div className="text-xs space-y-1 border-t border-border pt-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">입금 확인</span>
                      <span className={selected.depositConfirmed ? "text-green-400" : "text-amber-400"}>
                        {selected.depositConfirmed ? "확인됨" : "미확인"}
                      </span>
                    </div>
                    {selected.status === "rejected" && (
                      <p className="text-destructive/90 pt-1">거절 · 전액 환불 자동 처리 — 위 계좌로 송금하세요.</p>
                    )}
                    {selected.status === "refund_requested" && (
                      <p className="text-sky-400/90 pt-1">승인 후 본인 환불요청 — 송금 후 「환불 완료로 표시」를 눌러 주세요.</p>
                    )}
                  </div>
                </div>
                <div className="p-4 border-t border-border space-y-2">
                  {depositError && <p className="text-xs text-destructive">{depositError}</p>}
                  {refundError && <p className="text-xs text-destructive">{refundError}</p>}
                  {selected.status !== "rejected" && selected.status !== "refunded" && (
                    <button
                      onClick={() => toggleDeposit(selected.id, !selected.depositConfirmed)}
                      disabled={depositToggling}
                      className={`w-full py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                        selected.depositConfirmed
                          ? "border-green-500/40 text-green-400 hover:bg-green-400/10"
                          : "border-primary/40 text-primary hover:bg-primary/8"
                      }`}>
                      <Banknote className="w-3.5 h-3.5" />
                      {depositToggling ? "저장 중..." : selected.depositConfirmed ? "입금 확인 취소" : "입금 확인"}
                    </button>
                  )}
                  {selected.status === "refund_requested" && (
                    <button
                      onClick={() => markRefundDone(selected.id)}
                      disabled={refundActing}
                      className="w-full py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {refundActing ? "처리 중..." : "환불 완료로 표시"}
                    </button>
                  )}
                  {(selected.status === "pending" || selected.status === "approved") && (
                    <div className="flex gap-2">
                      <button onClick={() => updateStatus(selected.id,"approved")} disabled={selected.status==="approved"} className="flex-1 py-2 rounded-lg text-xs font-medium border border-green-500/40 text-green-400 hover:bg-green-400/10 disabled:opacity-40">승인</button>
                      <button onClick={() => { setRejectError(""); setRejectModal(selected); }} className="flex-1 py-2 rounded-lg text-xs font-medium border border-destructive/40 text-destructive hover:bg-destructive/10">거절</button>
                      <button onClick={() => updateStatus(selected.id,"pending")} disabled={selected.status==="pending"} className="flex-1 py-2 rounded-lg text-xs font-medium border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 disabled:opacity-40">대기</button>
                    </div>
                  )}
                  {(selected.status === "approved" || selected.status === "rejected") && (
                    selected.smsSent ? (
                      <div className="w-full py-2 rounded-lg text-xs font-medium border border-green-500/40 text-green-400 flex items-center justify-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {getSmsKindLabel(selected.status)} 문자 발송됨
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSmsError(""); setSmsInfo(""); setSmsForce(false); setSmsModal(selected); }}
                        className="w-full py-2 rounded-lg text-xs font-medium border border-primary/40 text-primary hover:bg-primary/8 flex items-center justify-center gap-1.5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {getSmsKindLabel(selected.status)} 문자 보내기
                      </button>
                    )
                  )}
                  <button onClick={() => { setDeleteError(""); setDeleteModal(selected); }} className="w-full py-2 rounded-lg text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> 신청자 삭제
                  </button>
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

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-sm">투표 오픈</p>
                  <button onClick={toggleVoteOpen} disabled={settings.is_closed}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_open?"bg-primary":"bg-muted"} disabled:opacity-40`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_open?"left-7":"left-1"}`} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings.is_closed
                    ? "투표 마감됨"
                    : settings.is_open
                      ? "투표 진행 중"
                      : settings.male_open || settings.female_open
                        ? "남·여 신청 접수 모두 마감 후 가능"
                        : "투표 대기 중"}
                </p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-sm">투표 마감 및 매칭</p>
                  <button onClick={toggleVoteClosed}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.is_closed?"bg-primary":"bg-muted"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${settings.is_closed?"left-7":"left-1"}`} />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings.is_closed ? `마감됨 · 매칭 ${matches.length}쌍` : "켜면 매칭 계산 및 결과 공개"}
                </p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <p className="text-2xl font-bold text-primary">{new Set(subs.map(s => s.voter_id)).size} <span className="text-sm font-normal text-muted-foreground">/ {approved.length}</span></p>
                <p className="text-xs text-muted-foreground mt-1">투표 제출 인원</p>
              </div>
              <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-4">
                <p className="text-2xl font-bold text-primary">{matches.length}</p>
                <p className="text-xs text-muted-foreground mt-1">매칭 쌍</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => { setVoteActionError(""); setVoteConfirm("clear"); }}
              className="mb-6 px-4 py-2.5 rounded-xl text-sm font-medium border border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              투표·쪽지 전체 초기화
            </button>
            {voteActionError && !voteConfirm && (
              <p className="text-xs text-destructive mb-4">{voteActionError}</p>
            )}

            <h3 className="text-sm font-semibold mb-3">투표 결과</h3>
            <div className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl overflow-hidden">
              {(() => {
                const board = buildVoteLeaderboard(approved, subs, apps);
                if (!approved.length) {
                  return <p className="text-center text-muted-foreground text-sm py-6">승인된 참가자가 없습니다.</p>;
                }
                if (!board.length) {
                  return <p className="text-center text-muted-foreground text-sm py-6">투표 결과가 없습니다.</p>;
                }
                return (
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
                      {board.map((a, i) => (
                        <tr key={a.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3 font-medium text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-3 font-medium">{a.nickname}</td>
                          <td className="px-4 py-3 text-muted-foreground">{a.gender}</td>
                          <td className="px-4 py-3"><span className="text-primary font-semibold">{a.count}</span></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{a.voters.join(", ") || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}

        {section === "matching" && (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-base font-semibold mb-4">매칭 현황 ({matches.length}쌍)</h2>
            {!settings.is_closed && <div className="bg-muted/40 border border-border rounded-xl p-3 mb-4"><p className="text-sm text-muted-foreground">투표 마감 후 매칭 결과가 계산됩니다.</p></div>}
            <div className="grid grid-cols-2 gap-3">
              {matches.map((m, idx) => {
                const u1 = apps.find(a => a.id === m.user1_id);
                const u2 = apps.find(a => a.id === m.user2_id);
                const maleApp = u1?.gender === "남성" ? u1 : u2;
                const femaleApp = u1?.gender === "여성" ? u1 : u2;
                const st = getMatchStatusFromRow(m);
                const stEl = { pending: <span className="text-amber-400 text-sm font-medium">대기</span>, success: <span className="text-green-400 text-sm font-medium">성사</span>, closed: <span className="text-muted-foreground text-sm">종료</span> };
                return (
                  <div key={m.id} className="bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-xl px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <p className="text-base font-semibold truncate leading-tight">
                          {maleApp?.nickname || "-"} · {femaleApp?.nickname || "-"}
                        </p>
                        <LoungeEntryCheck
                          checked={m.lounge_entered}
                          disabled={loungeTogglingId === m.id}
                          onCheckedChange={(v) => { void toggleLoungeEntered(m.id, v); }}
                        />
                      </div>
                      {stEl[st]}
                    </div>
                  </div>
                );
              })}
              {!matches.length && <p className="col-span-2 text-center text-muted-foreground text-sm py-8">매칭 데이터가 없습니다.</p>}
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
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !smsSending && setSmsModal(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">{getSmsKindLabel(smsModal.status)} 문자를 보내시겠습니까?</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {smsModal.name} ({smsModal.nickname})님은 이미 {getSmsKindLabel(smsModal.status)} 처리되었습니다.
              문자를 보내려면 「문자 보내기」를, 문자 없이 마치려면 「닫기」를 눌러 주세요.
            </p>
            <div className="bg-secondary rounded-xl p-4 mb-4 space-y-2 text-sm max-h-64 overflow-y-auto">
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">수신자</span><span>{smsModal.contact}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">제목</span><span>{getSmsSubject(smsModal.status)}</span></div>
              <div className="flex gap-3"><span className="text-muted-foreground shrink-0">내용</span><span className="whitespace-pre-wrap text-left">{getSmsBody(smsModal.status)}</span></div>
            </div>
            {smsError && <p className="text-xs text-destructive mb-3">{smsError}</p>}
            {smsInfo && <p className="text-xs text-amber-400 mb-3">{smsInfo}</p>}
            <div className="flex gap-2">
              <button onClick={sendSms} disabled={smsSending} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {smsSending ? "전송 중..." : "문자 보내기"}
              </button>
              <button onClick={() => { setSmsModal(null); setSmsError(""); setSmsInfo(""); setSmsForce(false); }} disabled={smsSending} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !deleting && setDeleteModal(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">신청자 삭제</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              <span className="text-foreground font-medium">{deleteModal.name}</span> ({deleteModal.nickname})님을 목록에서 숨깁니다(소프트 삭제).
              세션·투표·매칭은 정리되며, 같은 연락처로 다시 신청할 수 있습니다.
            </p>
            {deleteError && <p className="text-xs text-destructive mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                {deleting ? "삭제 중..." : "삭제 확인"}
              </button>
              <button onClick={() => setDeleteModal(null)} disabled={deleting} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !rejecting && setRejectModal(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">신청 거절</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              <span className="text-foreground font-medium">{rejectModal.name}</span> ({rejectModal.nickname})님을 거절합니다.
              세션이 끊기고 해당 참가자의 투표·받은 투표가 삭제됩니다. 투표가 진행 중이면 특히 주의하세요.
            </p>
            {rejectError && <p className="text-xs text-destructive mb-3">{rejectError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmReject} disabled={rejecting} className="flex-1 py-3 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                {rejecting ? "처리 중..." : "거절 확인"}
              </button>
              <button onClick={() => setRejectModal(null)} disabled={rejecting} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

      {voteConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !voteActing && setVoteConfirm(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">
              {voteConfirm === "open" && "투표 오픈"}
              {voteConfirm === "close" && "투표 마감"}
              {voteConfirm === "unclose" && "마감 취소"}
              {voteConfirm === "clear" && "투표 데이터 초기화"}
            </h3>
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              {voteConfirm === "open" && (
                <>남·여 신청 접수가 모두 마감된 상태에서 투표를 엽니다. 기존 투표·쪽지 데이터는 유지됩니다. 처음부터 다시 하려면 「투표·쪽지 전체 초기화」를 사용하세요.</>
              )}
              {voteConfirm === "close" && <>마감하면 상호 투표로 매칭이 계산되고 결과가 공개됩니다. 투표 데이터는 유지됩니다.</>}
              {voteConfirm === "unclose" && <>마감을 취소합니다. 매칭·라운지 응답·입장 체크가 모두 지워집니다. 투표·쪽지 데이터는 유지됩니다.</>}
              {voteConfirm === "clear" && <>모든 투표·쪽지·매칭을 삭제합니다. 이 작업은 되돌릴 수 없습니다.</>}
            </p>
            {voteActionError && <p className="text-xs text-destructive mb-3">{voteActionError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmVoteAction} disabled={voteActing} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {voteActing ? "처리 중..." : "확인"}
              </button>
              <button onClick={() => setVoteConfirm(null)} disabled={voteActing} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50">취소</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
