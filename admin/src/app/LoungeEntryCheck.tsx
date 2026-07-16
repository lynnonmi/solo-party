import { Check } from "lucide-react";

/** 매칭 현황: 운영자가 직접 토글하는 라운지 입장 체크 */
export function LoungeEntryCheck({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex items-center gap-1.5 disabled:opacity-50 transition-opacity hover:opacity-90"
      aria-checked={checked}
      role="checkbox"
    >
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          checked ? "bg-primary border-primary text-primary-foreground" : "border-border"
        }`}
      >
        {checked && <Check className="w-3 h-3" />}
      </div>
      <span className={`text-xs ${checked ? "text-primary" : "text-muted-foreground"}`}>
        {checked ? "입장 완료" : "미입장"}
      </span>
    </button>
  );
}
