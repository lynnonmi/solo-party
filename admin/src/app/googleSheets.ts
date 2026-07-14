import type { Application } from "./types";
import {
  EXPORT_HEADERS,
  EXPORT_IMAGE_COLUMNS,
  applicationsToExportRows,
} from "./exportData";

const URL_KEY = "sp_google_sheets_url";
const OPEN_KEY = "sp_google_sheets_open_url";
const SECRET_KEY = "sp_google_sheets_secret";

export function normalizeGasUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  url = url.replace(/\/dev(\?.*)?$/, "/exec$1");
  if (url.includes("/macros/s/") && !url.endsWith("/exec") && !url.includes("/exec?")) {
    url = url.replace(/\/$/, "") + "/exec";
  }
  return url;
}

export function getGoogleSheetsUrl(): string {
  const raw =
    (import.meta.env.VITE_GOOGLE_SHEETS_URL as string | undefined) ||
    (typeof window !== "undefined" ? localStorage.getItem(URL_KEY) : null) ||
    "";
  return normalizeGasUrl(raw);
}

export function getGoogleSheetsOpenUrl(): string {
  return (
    (typeof window !== "undefined" ? localStorage.getItem(OPEN_KEY) : null) ||
    "https://sheets.google.com"
  );
}

export function getGoogleSheetsSecret(): string {
  return (
    ((import.meta.env.VITE_GOOGLE_SHEETS_SECRET as string | undefined) || "").trim() ||
    (typeof window !== "undefined" ? localStorage.getItem(SECRET_KEY)?.trim() || "" : "")
  );
}

export function setGoogleSheetsUrl(scriptUrl: string, openUrl?: string, secret?: string): void {
  localStorage.setItem(URL_KEY, normalizeGasUrl(scriptUrl));
  if (openUrl?.trim()) {
    localStorage.setItem(OPEN_KEY, openUrl.trim());
  }
  if (secret !== undefined) {
    const s = secret.trim();
    if (s) localStorage.setItem(SECRET_KEY, s);
    else localStorage.removeItem(SECRET_KEY);
  }
}

export function isGoogleSheetsConfigured(): boolean {
  const url = getGoogleSheetsUrl();
  return url.includes("script.google.com") && url.includes("/exec");
}

export interface SyncResult {
  ok: boolean;
  message: string;
  openUrl?: string;
}

function isHtmlResponse(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head>");
}

export async function syncApplicationsToGoogleSheets(
  apps: Application[],
  options?: { replace?: boolean },
): Promise<SyncResult> {
  const url = getGoogleSheetsUrl();
  const openUrl = getGoogleSheetsOpenUrl();
  const secret = getGoogleSheetsSecret();

  if (!isGoogleSheetsConfigured()) {
    return {
      ok: false,
      message: "웹 앱 URL이 올바르지 않습니다. 「시트 연결」에서 .../exec 로 끝나는 URL을 입력해 주세요.",
    };
  }

  if (!secret) {
    return {
      ok: false,
      message:
        "시트 시크릿이 없습니다. 「시트 연결」에서 SHARED_SECRET과 동일한 값을 입력하거나 VITE_GOOGLE_SHEETS_SECRET을 설정하세요.",
    };
  }

  const payload = {
    secret,
    replace: options?.replace ?? true,
    headers: [...EXPORT_HEADERS],
    rows: applicationsToExportRows(apps),
    imageColumns: EXPORT_IMAGE_COLUMNS,
  };

  const body = JSON.stringify(payload);

  const parseResult = (text: string): SyncResult | null => {
    if (!text || isHtmlResponse(text)) {
      return {
        ok: false,
        message:
          "구글 승인이 필요할 수 있습니다. 웹 앱 URL을 새 탭에서 한 번 열고 「액세스 허용」한 뒤 다시 시도해 주세요.",
        openUrl: url,
      };
    }
    try {
      const data = JSON.parse(text) as { ok?: boolean; error?: string };
      if (data.ok === false) {
        return { ok: false, message: data.error || "시트 동기화에 실패했습니다." };
      }
      return {
        ok: true,
        message: `${apps.length}명의 신청 데이터를 구글 시트 「신청자」 탭에 반영했습니다.`,
        openUrl,
      };
    } catch {
      return null;
    }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });

    const text = await res.text();
    const parsed = parseResult(text);
    if (parsed) return parsed;

    if (!res.ok) {
      return { ok: false, message: `시트 동기화 실패 (HTTP ${res.status})` };
    }

    return {
      ok: true,
      message: `${apps.length}명의 신청 데이터를 전송했습니다. 구글 시트를 새로고침해 확인해 주세요.`,
      openUrl,
    };
  } catch {
    // CORS로 응답을 못 읽어도 POST는 도착하는 경우가 많음 → no-cors 재시도
    try {
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      return {
        ok: true,
        message: `${apps.length}명 데이터를 전송했습니다. 구글 시트에서 「신청자」 탭을 새로고침(F5)해 확인해 주세요.`,
        openUrl,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      return {
        ok: false,
        message: `시트에 연결할 수 없습니다. URL·배포(모든 사용자) 설정을 확인해 주세요. (${msg})`,
        openUrl: url,
      };
    }
  }
}
