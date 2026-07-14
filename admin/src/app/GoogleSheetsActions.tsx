import React, { useEffect, useState } from "react";
import { ExternalLink, Sheet } from "lucide-react";
import type { Application } from "./types";
import {
  getGoogleSheetsOpenUrl,
  getGoogleSheetsSecret,
  getGoogleSheetsUrl,
  isGoogleSheetsConfigured,
  setGoogleSheetsUrl,
  syncApplicationsToGoogleSheets,
  type SyncResult,
} from "./googleSheets";

export function GoogleSheetsActions({
  apps,
  compact = false,
}: {
  apps: Application[];
  compact?: boolean;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [openUrlInput, setOpenUrlInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [configured, setConfigured] = useState(isGoogleSheetsConfigured);

  useEffect(() => {
    if (setupOpen) {
      setUrlInput(getGoogleSheetsUrl());
      setOpenUrlInput(getGoogleSheetsOpenUrl());
      setSecretInput(getGoogleSheetsSecret());
    }
  }, [setupOpen]);

  const saveUrl = () => {
    if (!urlInput.trim()) {
      setResult({ ok: false, message: "웹 앱 URL을 입력해 주세요." });
      return;
    }
    if (!urlInput.includes("script.google.com")) {
      setResult({ ok: false, message: "script.google.com 으로 시작하는 웹 앱 URL을 입력해 주세요." });
      return;
    }
    if (!secretInput.trim()) {
      setResult({ ok: false, message: "Apps Script SHARED_SECRET과 동일한 시크릿을 입력해 주세요." });
      return;
    }
    setGoogleSheetsUrl(urlInput, openUrlInput, secretInput);
    setConfigured(isGoogleSheetsConfigured());
    setSetupOpen(false);
    setResult({ ok: true, message: "구글 시트 URL이 저장되었습니다. 이제 동기화를 눌러 보세요." });
  };

  const sync = async () => {
    if (!configured) {
      setSetupOpen(true);
      return;
    }
    if (!apps.length) {
      setResult({ ok: false, message: "동기화할 신청자가 없습니다. 신청 목록에 데이터가 있는지 확인해 주세요." });
      return;
    }
    setSyncing(true);
    setResult(null);
    const syncResult = await syncApplicationsToGoogleSheets(apps);
    setSyncing(false);
    setResult(syncResult);
  };

  const btnClass = compact
    ? "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all disabled:opacity-50"
    : "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all disabled:opacity-50";

  return (
    <>
      <div className={compact ? "flex gap-2 mb-4" : "flex items-center gap-2"}>
        <button onClick={sync} disabled={syncing} className={btnClass}>
          <Sheet className="w-3.5 h-3.5" />
          {syncing ? "동기화 중..." : "구글 시트 동기화"}
        </button>
        <button
          onClick={() => setSetupOpen(true)}
          className={compact ? btnClass : `${btnClass} ${configured ? "" : "border-primary/40 text-primary"}`}
        >
          시트 연결
        </button>
      </div>

      {result && !setupOpen && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setResult(null)}>
          <div className="w-full max-w-sm bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className={`font-semibold mb-2 ${result.ok ? "text-green-400" : "text-destructive"}`}>
              {result.ok ? "동기화 완료" : "동기화 실패"}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{result.message}</p>
            <div className="flex gap-2">
              {result.openUrl && (
                <a
                  href={result.openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {result.ok ? "시트 열기" : "URL 열기"}
                </a>
              )}
              <button onClick={() => setResult(null)} className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {setupOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSetupOpen(false)}>
          <div className="w-full max-w-lg bg-[#131313] border border-[rgba(240,168,190,0.30)] rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">구글 시트 연결</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              배포 후 받은 <strong className="text-foreground/90">웹 앱 URL</strong>을 입력하세요. 반드시 <code className="text-foreground/80">/exec</code>로 끝나야 합니다.
            </p>
            <label className="block text-xs text-muted-foreground mb-1.5">웹 앱 URL (필수)</label>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors mb-4"
            />
            <label className="block text-xs text-muted-foreground mb-1.5">스프레드시트 주소 (선택 — 동기화 후 바로 열기용)</label>
            <input
              value={openUrlInput}
              onChange={(e) => setOpenUrlInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors mb-4"
            />
            <label className="block text-xs text-muted-foreground mb-1.5">SHARED_SECRET (필수)</label>
            <input
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder="Apps Script 스크립트 속성과 동일"
              className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors mb-4"
            />
            <p className="text-xs text-amber-400/90 mb-4">
              Apps Script에 새 코드를 붙여넣은 뒤 재배포하고, 웹 앱 URL을 새 탭에서 한 번 열어 「액세스 허용」을 눌러 주세요.
            </p>
            <div className="flex gap-2">
              <button onClick={saveUrl} className="flex-1 py-3 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">
                저장
              </button>
              <button onClick={() => setSetupOpen(false)} className="px-4 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
