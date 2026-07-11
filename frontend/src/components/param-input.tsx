"use client";

// 숫자 파라미터 공용 입력 — 타이핑 필터(숫자·점) + blur 정규화 + duration 표시 스왑(포커스 중 raw, 아니면 1h30m).
// 인스펙터·노드 요약 모달·SP 지정 모달이 공유한다 (design 2026-07-11 SP §4).
import { useState } from "react";

import { formatDurationHm, normalizeDuration, normalizeNumericParam } from "@/lib/duration";
import type { ParamField } from "@/lib/params";

export function ParamInput({ field, value, disabled, dataId, className, ariaLabel, onCommit }: {
  field: ParamField;
  value: string;
  disabled?: boolean;
  dataId?: string;
  className?: string;
  ariaLabel?: string;
  onCommit: (next: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const display = !focused && field === "duration" ? formatDurationHm(value) : value;
  return (
    <input
      data-id={dataId}
      inputMode="decimal"
      className={className}
      value={display}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        if (/^\d*\.?\d*$/.test(e.target.value)) onCommit(e.target.value);
      }}
      onBlur={(e) => {
        const raw = e.target.value.replace(/\.$/, "");
        const normalized = field === "duration" ? normalizeDuration(raw) : normalizeNumericParam(raw);
        onCommit(normalized ?? "");
        setFocused(false);
      }}
    />
  );
}
