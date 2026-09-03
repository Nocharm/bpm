"use client";

// 필드 타일 — 2열 그리드의 단추. 아이콘 + 라벨(작고 톤다운) + 값(우측 강조).
// 값을 표시할 자리가 모자랄 때만 라벨을 생략한다(실측, 사용자 피드백 2026-09-03).
// 클릭한 마우스 좌표를 넘겨 입력 팝오버가 그 자리에 뜬다 (design 2026-09-03 followups §5).
// wide: 두 열을 가로지르는 슬림한 행 타일 — 라벨 좌·값 우, 긴 값도 줄바꿈으로 다 보인다(부서·담당자,
// 사용자 결정 2026-09-03). readOnly: 클릭 없이 값만 보여주는 정적 타일(뷰어·잠금·게시본).

import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface SpFieldTileProps {
  dataId: string;
  icon: LucideIcon;
  label: string;
  // 표시용 값 — 비어 있으면 라벨만 보인다
  value: string;
  // 값 앞 장식(색 견본·부서 필 등) — 값 문자열과 함께 표시. 값 문자열이 비어도 filled로 친다
  valueNode?: ReactNode;
  // 아이콘 자리 교체(예: 호버 시 원문 메모 아이콘으로 바뀌는 FallbackHint) — 타일 루트는 `group`
  iconSlot?: ReactNode;
  disabled?: boolean;
  disabledHint?: string;
  active?: boolean;
  wide?: boolean;
  readOnly?: boolean;
  onOpen?: (at: { x: number; y: number }) => void;
}

// 아이콘 16 + 간격 8×2 + 좌우 패딩 10×2 — 라벨은 최소 이만큼은 보여야 의미가 있다
const FIXED_WIDTH = 16 + 16 + 20;
const MIN_LABEL_WIDTH = 44;

export function SpFieldTile({
  dataId, icon: Icon, label, value, valueNode, iconSlot, disabled, disabledHint, active, wide, readOnly, onOpen,
}: SpFieldTileProps) {
  const filled = value.trim() !== "" || valueNode != null;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const [hideLabel, setHideLabel] = useState(false);

  // 값의 실제 폭(scrollWidth)이 라벨 최소 폭까지 잡아먹으면 라벨 생략 — 리사이즈에도 재판정.
  // wide 타일은 라벨을 항상 그린다(값이 줄바꿈으로 내려간다)
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const valueEl = valueRef.current;
    if (!button || !valueEl || !filled || wide) {
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
  }, [filled, value, wide]);

  const tone = readOnly
    ? filled
      ? "border-accent-tint-border bg-accent-tint/40"
      : "border-hairline bg-surface"
    : active
      ? "border-accent bg-accent-tint"
      : filled
        ? "border-accent-tint-border bg-accent-tint/40 hover:bg-accent-tint"
        : "border-hairline bg-surface hover:bg-surface-alt";
  // 값은 잘리지 않는다 — 좁으면 라벨이 먼저 줄고, 그래도 모자라면 라벨을 생략(hideLabel)한 뒤에야 값이 잘린다.
  // wide 타일은 라벨을 자연폭으로 고정하고 값이 줄바꿈으로 내려간다(부서 경로처럼 긴 값)
  const body = filled ? (
    <>
      {(wide || !hideLabel) && (
        <span className={`text-fine text-ink-tertiary ${wide ? "shrink-0" : "min-w-0 truncate"}`}>{label}</span>
      )}
      <span
        ref={valueRef}
        className={`ml-auto inline-flex items-center gap-1.5 text-caption font-semibold text-ink ${
          wide ? "min-w-0 justify-end text-right break-keep" : hideLabel ? "min-w-0 truncate" : "shrink-0"
        }`}
      >
        {valueNode}
        {value.trim() !== "" && <span className={wide || hideLabel ? "min-w-0 truncate" : ""}>{value}</span>}
      </span>
    </>
  ) : (
    <span className="min-w-0 truncate text-caption text-ink-secondary">{label}</span>
  );

  const layout = `group flex min-w-0 items-center gap-2 rounded-sm border px-2.5 text-left transition-colors duration-150 ${
    wide ? "col-span-2 py-1.5" : "py-2"
  } ${tone}`;
  const title = filled ? `${label}: ${value}`.trim().replace(/:$/, "") : label;
  const icon = iconSlot ?? (
    <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled ? "text-accent" : "text-ink-tertiary"}`} />
  );

  if (readOnly) {
    return (
      <div data-id={dataId} data-filled={filled ? "true" : "false"} title={title} className={layout}>
        {icon}
        {body}
      </div>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      data-id={dataId}
      data-filled={filled ? "true" : "false"}
      disabled={disabled}
      title={disabled && disabledHint ? disabledHint : title}
      aria-label={label}
      onClick={(e) => onOpen?.({ x: e.clientX, y: e.clientY })}
      className={`${layout} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
      {body}
    </button>
  );
}
