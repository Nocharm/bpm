// 마우스/앵커 위치 메뉴 — 대시보드 타일·링크가 다른 탭(인박스·피드백)으로 넘어가기 전에 마우스 위치에 "…로 이동" 항목을
// 먼저 띄운다(실수 이탈 방지, 사용자 지시 2026-09-11). 바깥 mousedown·Esc로 닫힘. z 1200(컨텍스트 메뉴 단).
"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getViewportOverflow } from "@/lib/clamp-viewport";

export interface GoToItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode; // 기본 ArrowUpRight(페이지 이동). 선택형 메뉴는 자체 아이콘/체크
  active?: boolean; // 현재 선택 항목 강조
}

interface GoToMenuProps {
  x: number;
  y: number;
  items: GoToItem[];
  onClose: () => void;
}

export function GoToMenu({ x, y, items, onClose }: GoToMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 마우스 위치에 붙인 뒤 실측으로 화면 안에 밀어 넣는다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const { dx, dy } = getViewportOverflow(el);
    el.style.left = `${x + dx}px`;
    el.style.top = `${y + dy}px`;
    el.style.visibility = "visible";
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      data-id="go-to-menu"
      role="menu"
      style={{ visibility: "hidden" }}
      className="fixed z-[1200] min-w-40 rounded-md border border-hairline bg-surface py-1 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={(e) => { e.stopPropagation(); onClose(); it.onSelect(); }}
          aria-current={it.active || undefined}
          // 현재 선택은 무채색 강조(부서 범위 피커, 사용자 지시 2026-09-11) — 액센트는 페이지 이동 항목에 쓰지 않는다
          className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-caption hover:bg-surface-alt ${
            it.active ? "bg-surface-pearl font-semibold text-ink" : "text-ink"
          }`}
        >
          <span className="inline-flex shrink-0 text-ink-tertiary">{it.icon ?? <ArrowUpRight size={14} strokeWidth={1.5} />}</span>
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

// 소비자 훅 — 클릭 이벤트 좌표로 메뉴를 연다. 반환한 menu 노드를 렌더 트리에 둔다.
export function useGoToMenu(): {
  menu: ReactNode;
  openAt: (e: { clientX: number; clientY: number }, items: GoToItem[]) => void;
} {
  const [state, setState] = useState<{ x: number; y: number; items: GoToItem[] } | null>(null);
  const openAt = (e: { clientX: number; clientY: number }, items: GoToItem[]) =>
    setState({ x: e.clientX, y: e.clientY, items });
  const menu = state ? <GoToMenu x={state.x} y={state.y} items={state.items} onClose={() => setState(null)} /> : null;
  return { menu, openAt };
}
