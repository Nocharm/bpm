"use client";

// 메뉴 셀렉트 — 검색 없는 짧은 옵션 목록용 드롭다운(역할·GMP). 트리거와 같은 폭으로 바로 아래(간극 0)에
// 포털(z-1350) 메뉴를 펼치고 `.dropdown-in`으로 등장한다. 항목은 아이콘+라벨+(선택 체크), `tone="danger"`
// 항목은 빨간 계열 호버(협업자 Owner 이전 진입). 네이티브 <select> 대체 (2026-10-01).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface MenuSelectItem {
  value: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  /** 항목 우측 보조 글자(설명·힌트) */
  hint?: string;
}

interface MenuSelectProps {
  dataId: string;
  value: string;
  items: MenuSelectItem[];
  /** value가 어떤 항목과도 안 맞을 때 트리거에 보일 글자 */
  placeholder?: string;
  disabled?: boolean;
  /** 트리거 폭 — 기본은 내용 폭. 행 안 정렬용으로 고정 폭 클래스를 넘긴다 */
  className?: string;
  /** 선택 시 — 같은 값을 다시 고르면 호출하지 않는다 */
  onChange: (value: string, at: { x: number; y: number }) => void;
  /** 트리거 앞 장식(현재 값의 아이콘 등) */
  leading?: ReactNode;
}

const MARGIN = 8; // 뷰포트 가장자리 최소 여백

export function MenuSelect({
  dataId,
  value,
  items,
  placeholder = "",
  disabled = false,
  className = "",
  onChange,
  leading,
}: MenuSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // 열려 있는 동안 트리거 rect 추적 — 스크롤(내부 컨테이너 포함)·리사이즈에 재배치
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = rect.width;
      const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, window.innerWidth - MARGIN - width));
      setPos({ left, top: rect.bottom, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  const current = items.find((item) => item.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-id={dataId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center justify-between gap-1.5 rounded-sm border bg-surface px-2 py-0.5 text-fine text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-accent ring-2 ring-accent-tint" : "border-hairline hover:bg-surface-alt"
        } ${className}`}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close();
        }}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          {leading}
          <span className="truncate">{current?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          size={13}
          strokeWidth={1.5}
          className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[1340]" onMouseDown={close} />
            <div
              role="listbox"
              data-id={`${dataId}-menu`}
              className="dropdown-in fixed z-[1350] rounded-sm border p-0.5 glass glass-dense"
              style={{ left: pos.left, top: pos.top, width: pos.width }}
            >
              {items.map((item) => {
                const selected = item.value === value;
                const danger = item.tone === "danger";
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-id={`${dataId}-option-${item.value}`}
                    className={`flex w-full items-center gap-1.5 rounded-xs px-1.5 py-1 text-left text-fine transition-colors ${
                      danger
                        ? "text-error hover:bg-error/10"
                        : selected
                          ? "bg-accent-tint text-accent"
                          : "text-ink hover:bg-surface-alt"
                    }`}
                    onClick={(e) => {
                      close();
                      if (item.value !== value) onChange(item.value, { x: e.clientX, y: e.clientY });
                    }}
                  >
                    {item.icon && <span className="shrink-0">{item.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-[10px] text-ink-tertiary">{item.hint}</span>}
                    {selected && !danger && <Check size={13} strokeWidth={1.5} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
