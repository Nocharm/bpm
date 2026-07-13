"use client";

// 숫자 파라미터 공용 입력 — 타이핑 필터(숫자·점) + blur 정규화 + 표시 스왑(포커스 중 raw, 아니면
// duration은 1h30m·비용 2필드는 천단위 콤마). 비용 배타(disabled)는 호출부가 판단해 prop으로 넘긴다.
// 인스펙터·노드 요약 모달·SP 지정 모달이 공유한다 (design 2026-07-11 SP §4, 2026-07-13 §3.2).
import { useState } from "react";

import { formatDurationHm, formatThousands, normalizeDuration, normalizeNumericParam } from "@/lib/duration";
import { COST_FIELDS, type ParamField } from "@/lib/params";

const isCost = (field: ParamField): boolean => (COST_FIELDS as readonly string[]).includes(field);

export function ParamInput({ field, value, disabled, dataId, className, ariaLabel, placeholder, onCommit }: {
  field: ParamField;
  value: string;
  disabled?: boolean;
  dataId?: string;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  onCommit: (next: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value
    : field === "duration"
      ? formatDurationHm(value)
      : isCost(field)
        ? formatThousands(value)
        : value;
  return (
    <input
      data-id={dataId}
      inputMode="decimal"
      className={className}
      value={display}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
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
