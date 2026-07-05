import { useEffect, useState } from "react";
import type { Application } from "./types";

export const SMS_TEXT = "승인문자";

export function getProfilePhoto(app: Partial<Application>): string | null {
  return app.voteProfilePhoto || app.photos?.[0] || null;
}

export function useIsPC() {
  const [isPC, setIsPC] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);
  useEffect(() => {
    const h = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isPC;
}
