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
  // 값이 없을 때 우측에 흐리게 보이는 안내("미입력") — 읽기 목록에서 누락 항목을 감추지 않기 위해
  placeholder?: string;
  // fallback: 대표값 대신 인터뷰 원문 메모를 값으로 보여줄 때 — 기울임·점선 보더·틴트 없음으로 임시값임을 드러낸다
  valueTone?: "default" | "fallback";
  // 값 글자 크기 — 문장이 들어오는 필드(시작·종료 조건)는 한 단계 작게 (사용자 피드백 2026-09-03)
  valueSize?: "caption" | "fine";
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
  dataId, icon: Icon, label, value, valueNode, iconSlot, placeholder, valueTone = "default", valueSize = "caption",
  disabled, disabledHint, active, wide, readOnly, onOpen,
}: SpFieldTileProps) {
  const filled = value.trim() !== "" || valueNode != null;
  const isFallback = filled && valueTone === "fallback";
  const buttonRef = useRef<HTMLDivElement | null>(null);
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

  // 호버 = 흰 배경 + 보더 강조(틴트를 걷어 행머리 메모 아이콘 스왑이 드러난다, 사용자 피드백 2026-09-03).
  // 읽기 타일은 메모 아이콘(iconSlot)이 있을 때만 호버 반응
  const interactive = !readOnly || iconSlot != null;
  const tone = isFallback
    ? `border-dashed border-accent-tint-border bg-surface ${interactive ? (active ? "border-accent" : "hover:border-accent") : ""}`
    : readOnly
      ? filled
        ? `border-accent-tint-border bg-accent-tint/40 ${interactive ? "hover:border-accent hover:bg-surface" : ""}`
        : "border-hairline bg-surface"
      : active
        ? "border-accent bg-accent-tint"
        : filled
          ? "border-accent-tint-border bg-accent-tint/40 hover:border-accent hover:bg-surface"
          : "border-hairline bg-surface hover:border-border-strong";
  // 값은 잘리지 않는다 — 좁으면 라벨이 먼저 줄고, 그래도 모자라면 라벨을 생략(hideLabel)한 뒤에야 값이 잘린다.
  // wide 타일은 라벨을 자연폭으로 고정하고 값이 줄바꿈으로 내려간다(부서 경로처럼 긴 값)
  const body = filled ? (
    <>
      {(wide || !hideLabel) && (
        <span className={`text-fine text-ink-tertiary ${wide ? "shrink-0" : "min-w-0 truncate"}`}>{label}</span>
      )}
      <span
        ref={valueRef}
        className={`ml-auto inline-flex items-center gap-1.5 ${valueSize === "fine" ? "text-fine" : "text-caption"} ${
          isFallback ? "font-normal italic text-ink-secondary" : "font-semibold text-ink"
        } ${wide ? "min-w-0 justify-end text-right break-keep" : hideLabel ? "min-w-0 truncate" : "shrink-0"}`}
      >
        {valueNode}
        {value.trim() !== "" && <span className={wide || hideLabel ? "min-w-0 truncate" : ""}>{value}</span>}
      </span>
    </>
  ) : placeholder ? (
    <>
      <span className={`text-fine text-ink-tertiary ${wide ? "shrink-0" : "min-w-0 truncate"}`}>{label}</span>
      <span className="ml-auto shrink-0 text-caption text-ink-muted">{placeholder}</span>
    </>
  ) : (
    <span className="min-w-0 truncate text-caption text-ink-secondary">{label}</span>
  );

  // overflow-hidden — 라벨 생략 판정이 끝나기 전 프레임이나 긴 라벨이 타일 밖으로 삐져나오지 않게
  const layout = `group flex min-w-0 items-center gap-2 overflow-hidden rounded-sm border px-2.5 text-left transition-[background-color,border-color,scale] duration-150 ${
    wide ? "col-span-2 py-1.5" : "py-2"
  } ${tone}`;
  const title = filled ? `${label}: ${value}`.trim().replace(/:$/, "") : label;
  const icon = iconSlot ?? (
    <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled && !isFallback ? "text-accent" : "text-ink-tertiary"}`} />
  );
  const filledAttr = isFallback ? "fallback" : filled ? "true" : "false";

  if (readOnly) {
    // ref — 읽기 타일도 라벨 생략 판정(긴 값이 타일을 넘지 않게)을 같이 받는다
    return (
      <div ref={buttonRef} data-id={dataId} data-filled={filledAttr} title={title} className={layout}>
        {icon}
        {body}
      </div>
    );
  }
  // 편집 타일은 button이 아니라 role=button div — 안에 부서 필·원문 메모 아이콘 같은 중첩 버튼이 들어간다
  // (button 안의 button은 무효 HTML). 커서·눌림 피드백은 전역 button base와 같게 직접 준다.
  return (
    <div
      ref={buttonRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      data-id={dataId}
      data-filled={filledAttr}
      aria-disabled={disabled || undefined}
      title={disabled && disabledHint ? disabledHint : title}
      aria-label={label}
      onClick={(e) => {
        if (disabled) return;
        // 중첩 요소가 띄운 포털(원문 메모 팝오버·조직 정보 모달) 안의 클릭은 React 트리로 여기까지 버블된다 —
        // DOM 포함 여부로 걸러 타일 팝오버가 덩달아 열리지 않게
        if (!e.currentTarget.contains(e.target as Node)) return;
        onOpen?.({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
        if (e.target !== e.currentTarget) return; // 중첩 버튼(필·메모)의 키 입력은 그쪽이 처리
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onOpen?.({ x: rect.left + rect.width / 2, y: rect.bottom });
      }}
      className={`${layout} ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer active:scale-[0.97]"}`}
    >
      {icon}
      {body}
    </div>
  );
}
