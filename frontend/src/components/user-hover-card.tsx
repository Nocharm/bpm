"use client";

// 유저 호버 카드 — 앵커를 1초 이상 호버하면 유저 정보 팝오버. 맵 상세 '허용 인원' 확장 카드 디자인을 미러
// (아바타+이름 · 아이디/직급/부서 레벨 필). portal+fixed라 컨테이너 overflow에 안 잘림.

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { DirectoryUser } from "@/lib/api";

// 호버 후 카드가 뜨기까지 지연(ms) — 요청: 1초 경과
const HOVER_DELAY_MS = 1000;

// org_path(루트/…/리프) → 리프→루트 레벨 배열 (맵 상세 카드와 동일)
function orgLevels(path: string): string[] {
  return path.split("/").filter(Boolean).reverse();
}

export function UserHoverCard({
  user,
  loginId,
  children,
}: {
  user?: DirectoryUser;
  loginId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const name = user?.name ?? loginId;
  const title = user?.title ?? "";
  const levels = orgLevels(user?.org_path ?? "");

  const scheduleShow = () => {
    const el = ref.current;
    if (!el) return;
    timer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.bottom });
    }, HOVER_DELAY_MS);
  };
  const hide = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPos(null);
  };

  return (
    <span ref={ref} className="inline-flex min-w-0" onMouseEnter={scheduleShow} onMouseLeave={hide}>
      {children}
      {pos !== null &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1400] flex w-56 flex-col gap-2 rounded-sm border border-hairline bg-surface p-3 shadow-lg"
            style={{ left: pos.x, top: pos.y + 6 }}
          >
            {/* 아바타 + 이름 */}
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine text-accent">
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-caption-strong text-ink">{name}</span>
            </span>
            {/* 아이디 · 직급 · 부서 레벨(리프→루트) 필 */}
            <span className="flex flex-col items-start gap-1">
              <span className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-secondary">
                {loginId}
              </span>
              {title && (
                <span className="rounded-xs border border-accent-tint-border px-1.5 py-0.5 text-fine text-accent">
                  {title}
                </span>
              )}
              {levels.map((lv) => (
                <span
                  key={lv}
                  className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-tertiary"
                >
                  {lv}
                </span>
              ))}
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
