"use client";

// 관리자 패널 아코디언 섹션 — 헤더(아이콘·제목·건수 배지·힌트·우측 액션 슬롯) + 0fr→1fr 그리드 전환 본문.
// 열림 상태는 섹션 id별 localStorage에 남는다(펼침 취향 유지). Framework 탭(캠페인 진입·진행 중 세션·인터뷰 임포트)이 쓴다.

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface AdminSectionProps {
  id: string;  // localStorage 키(bpm.adminSection.<id>)와 data-id 접미
  title: string;
  hint?: string;
  icon?: ReactNode;
  badge?: ReactNode;  // 건수 등 — 접힌 상태에서도 보인다
  actions?: ReactNode;  // 헤더 우측(복사 버튼 등) — 클릭이 토글로 새지 않게 감싼다
  defaultOpen?: boolean;  // 기본 접힘(사용자 지시 2026-09-21) — 펼침 취향은 localStorage가 이어받는다
  tone?: "pearl" | "plain";
  // 본문 최대 높이(px) — 넘치면 섹션 안에서 스크롤한다(페이지가 끝없이 길어지지 않게)
  maxHeight?: number;
  children: ReactNode;
}

function readOpen(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(`bpm.adminSection.${id}`);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export function AdminSection({ id, title, hint, icon, badge, actions, defaultOpen = false, tone = "plain", maxHeight = 520, children }: AdminSectionProps) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(`bpm.adminSection.${id}`, next ? "1" : "0");
      } catch {
        // 저장 실패는 치명적이지 않다 — 펼침 취향만 복원 안 될 뿐
      }
      return next;
    });
  }
  return (
    <section
      data-id={`admin-section-${id}`}
      data-open={open}
      className={`flex flex-col overflow-hidden rounded-md border border-hairline ${tone === "pearl" ? "bg-surface-pearl" : "bg-surface"}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          data-id={`admin-section-toggle-${id}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:bg-surface-alt"
          onClick={toggle}
        >
          <ChevronRight size={14} strokeWidth={1.5} className={`shrink-0 text-ink-tertiary motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${open ? "rotate-90" : ""}`} />
          {icon && <span className="shrink-0 text-accent">{icon}</span>}
          {/* 제목은 잘리지 않는다 — 접힌 상태의 힌트가 남는 폭만 쓰고 먼저 잘린다 */}
          <span className="shrink-0 text-caption-strong text-ink">{title}</span>
          {badge !== undefined && badge !== null && (
            <span className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary tabular-nums" data-id={`admin-section-badge-${id}`}>{badge}</span>
          )}
          {hint && !open && <span className="min-w-0 truncate text-fine text-ink-tertiary">{hint}</span>}
        </button>
        {actions && <span className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions}</span>}
      </div>
      {/* 0fr→1fr 전환 — 래퍼는 항상 두어 첫 열림도 애니메이션된다(interview-import-report-wrap과 같은 규칙) */}
      <div className={`grid transition-[grid-template-rows] duration-350 ease-smooth ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          {/* 본문은 상한 높이 안에서 내부 스크롤 — 긴 목록(세션·파일)이 페이지를 밀어내지 않는다 */}
          <div className="scroll-soft flex flex-col gap-3 overflow-y-auto px-3 pb-3" style={{ maxHeight }} data-id={`admin-section-body-${id}`}>
            {hint && open && <p className="text-fine text-ink-tertiary">{hint}</p>}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
