// 앱 공통 체크박스 — 네이티브 대신 rounded-sm·hairline→accent·Check 아이콘(framework-confirm-section.tsx
// 메이저 승급 토글, process-library-panel.tsx 필터 팝오버 3종이 공유).
"use client";

import { Check } from "lucide-react";

export interface CheckInputProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  id?: string;
  "data-id"?: string;
  "aria-label"?: string;
  className?: string; // 래퍼(span)에 얹는 추가 클래스 — 정렬 등 소비처별 차이(예: mt-0.5)
}

export function CheckInput({
  checked,
  onChange,
  disabled,
  id,
  className,
  "data-id": dataId,
  "aria-label": ariaLabel,
}: CheckInputProps) {
  return (
    <span className={`relative h-4 w-4 shrink-0 ${className ?? ""}`}>
      <input
        type="checkbox"
        id={id}
        data-id={dataId}
        aria-label={ariaLabel}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-sm border border-hairline bg-surface transition-colors duration-150 checked:border-accent checked:bg-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Check
        size={12}
        strokeWidth={2.5}
        className="pointer-events-none absolute left-0.5 top-0.5 text-on-accent opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
      />
    </span>
  );
}
