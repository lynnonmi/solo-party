import { Check } from "lucide-react";

/** 매칭 현황: 라운지 입장 여부 표시 (읽기 전용) */
export function LoungeEntryCheck({ response }: { response: string }) {
  const going = response === "going";
  const declined = response === "not_going";
  const label = going ? "입장" : declined ? "거절" : "대기";
  return (
    <div className="inline-flex items-center gap-1.5">
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          going ? "bg-primary border-primary text-primary-foreground" : "border-border"
        }`}
        aria-checked={going}
        role="checkbox"
      >
        {going && <Check className="w-3 h-3" />}
      </div>
      <span className={`text-xs ${going ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
    </div>
  );
}
