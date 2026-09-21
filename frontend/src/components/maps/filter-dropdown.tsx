"use client";

// 홈 목록 필터용 멀티셀렉트 드롭다운 — 버튼(아이콘+라벨+선택수) + 체크 목록(옵션별 아이콘) /
// multi-select filter dropdown with leading icons.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FilterX } from "lucide-react";

import type { FilterDisplayMode } from "@/lib/filter-display";

interface FilterOption {
  value: string;
  label: string;
  // 옵션별 선행 아이콘(상태 색 점·역할 아이콘 등) / per-option leading icon.
  icon?: ReactNode;
  // 현재 선택과 배타(교집합 없음)라 고를 수 없는 옵션 — 흐리게 두고 클릭 무시 (Type 필, 2026-09-21)
  disabled?: boolean;
  disabledHint?: string;
}

export function FilterDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
  dataId,
  display = "full",
  stretch = false,
  clearable = true,
  clearLabel = "Clear",
}: {
  label: string;
  // 버튼 선행 아이콘 / button leading icon.
  icon?: ReactNode;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  dataId?: string;
  // 버튼 표시 단계 — full(아이콘+라벨) / label(라벨만) / icon(아이콘만, title로 라벨 보완). 기본 full(기존 동작 유지).
  display?: FilterDisplayMode;
  // 행을 채우되 내용 폭에 비례해 차등 분배(flex-auto, 사용자 지시 2026-09-21). 내용 좌측·쉐브론 우측 정렬. 측정 복제는 미지정
  stretch?: boolean;
  // 목록 맨 아래 "이 필 지우기" 항목(선택된 값을 모두 토글 해제). 단일 선택 필(정렬)은 false
  clearable?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = selected.size;

  // 바깥 클릭 닫기 — 전체화면 오버레이(`fixed inset-0`)는 페이지 호버를 가로채므로 document 리스너로 대체
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className={stretch ? "relative min-w-0 flex-auto" : "relative shrink-0"}>
      <button
        type="button"
        data-id={dataId}
        aria-expanded={open}
        title={label}
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2.5 py-1 text-caption transition-colors ${
          stretch ? "w-full" : ""
        } ${
          count > 0
            ? "border-accent-tint-border bg-accent-tint text-accent"
            : "border-hairline text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {display !== "label" && icon}
        <span className={stretch ? "min-w-0 flex-1 truncate text-left" : ""}>
          {display !== "icon" ? (count > 0 ? `${label} · ${count}` : label) : count > 0 ? `· ${count}` : null}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`shrink-0 ${stretch ? "ml-auto" : ""} ${open ? "rotate-180 transition-transform" : "transition-transform"}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 z-[1001] mt-1 min-w-[10rem] rounded-md border border-hairline bg-surface py-1 shadow-lg">
          {options.map((o) => {
            const on = selected.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                aria-disabled={o.disabled || undefined}
                title={o.disabled ? o.disabledHint : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-ink ${
                  o.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-surface-alt"
                }`}
                onClick={() => onToggle(o.value)}
              >
                {o.icon}
                <span className="flex-1 truncate">{o.label}</span>
                {on && <Check size={14} strokeWidth={1.7} className="shrink-0 text-accent" />}
              </button>
            );
          })}
          {/* 이 필 지우기 — 선택이 있을 때만 목록 맨 아래에 아코디언 펼침(accordion-open)으로 등장 (2026-09-21) */}
          {clearable && count > 0 && (
            <div className="accordion-open">
              <div className="mt-1 border-t border-hairline pt-1">
                <button
                  type="button"
                  data-id={dataId ? `${dataId}-clear` : undefined}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-error hover:bg-error/10"
                  onClick={() => {
                    for (const v of [...selected]) onToggle(v);
                  }}
                >
                  <FilterX size={13} strokeWidth={1.5} className="shrink-0" />
                  <span className="flex-1 truncate">{clearLabel}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
