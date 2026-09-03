"use client";

// SP 지정 모달 필드 타일 — 2열 그리드의 단추. 아이콘 + 라벨(작고 톤다운) + 값(우측 강조).
// 값을 표시할 자리가 모자랄 때만 라벨을 생략한다(실측, 사용자 피드백 2026-09-03).
// 클릭한 마우스 좌표를 넘겨 입력 팝오버가 그 자리에 뜬다 (design 2026-09-03 followups §5).

import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

interface SpFieldTileProps {
  dataId: string;
  icon: LucideIcon;
  label: string;
  // 표시용 값 — 비어 있으면 라벨만 보인다
  value: string;
  disabled?: boolean;
  disabledHint?: string;
  active?: boolean;
  onOpen: (at: { x: number; y: number }) => void;
}

// 아이콘 16 + 간격 8×2 + 좌우 패딩 10×2 — 라벨은 최소 이만큼은 보여야 의미가 있다
const FIXED_WIDTH = 16 + 16 + 20;
const MIN_LABEL_WIDTH = 44;

export function SpFieldTile({ dataId, icon: Icon, label, value, disabled, disabledHint, active, onOpen }: SpFieldTileProps) {
  const filled = value.trim() !== "";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const [hideLabel, setHideLabel] = useState(false);

  // 값의 실제 폭(scrollWidth)이 라벨 최소 폭까지 잡아먹으면 라벨 생략 — 리사이즈에도 재판정
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const valueEl = valueRef.current;
    if (!button || !valueEl || !filled) {
      setHideLabel(false);
      return;
    }
    const measure = () => {
      const available = button.clientWidth - FIXED_WIDTH;
      setHideLabel(valueEl.scrollWidth + MIN_LABEL_WIDTH > available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    return () => observer.disconnect();
  }, [filled, value]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-id={dataId}
      data-filled={filled ? "true" : "false"}
      disabled={disabled}
      title={disabled && disabledHint ? disabledHint : filled ? `${label}: ${value}` : label}
      aria-label={label}
      onClick={(e) => onOpen({ x: e.clientX, y: e.clientY })}
      className={`flex min-w-0 items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent bg-accent-tint"
          : filled
            ? "border-accent-tint-border bg-accent-tint/40 hover:bg-accent-tint"
            : "border-hairline bg-surface hover:bg-surface-alt"
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled ? "text-accent" : "text-ink-tertiary"}`} />
      {filled ? (
        <>
          {!hideLabel && (
            <span className="min-w-0 truncate text-fine text-ink-tertiary">{label}</span>
          )}
          <span ref={valueRef} className="ml-auto min-w-0 truncate text-caption font-semibold text-ink">
            {value}
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate text-caption text-ink-secondary">{label}</span>
      )}
    </button>
  );
}
