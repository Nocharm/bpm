// 홈 대시보드 섹션 셸 — 제목(아이콘·건수 칩·더보기 링크) + 본문, 빈 상태 한 줄, 하단 링크아웃 행. 대시보드 카드 6종이 공유.
"use client";

import { ChevronRight, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

interface DashboardSectionProps {
  dataId: string;
  icon: ReactNode;
  title: string;
  count?: number | null; // null/undefined면 칩 생략
  countHot?: boolean; // 내 결정이 필요한 건수 등 강조
  more?: { label: string; onClick: () => void };
  children: ReactNode;
}

export function DashboardSection({ dataId, icon, title, count, countHot, more, children }: DashboardSectionProps) {
  return (
    <section data-id={dataId} className="flex min-w-0 flex-col rounded-sm border border-hairline bg-surface">
      <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-caption-strong text-ink">
          <span className="text-ink-tertiary">{icon}</span>
          {title}
        </span>
        {count != null && (
          <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${countHot ? "bg-accent-tint text-accent-elevated" : "bg-surface-alt text-ink-tertiary"}`}>
            {count}
          </span>
        )}
        {more && (
          <button
            type="button"
            data-id={`${dataId}-more`}
            onClick={(e) => { e.stopPropagation(); more.onClick(); }}
            className="ml-auto inline-flex items-center gap-0.5 text-fine text-ink-tertiary hover:text-accent"
          >
            {more.label}
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

interface DashboardEmptyProps {
  dataId?: string;
  icon: ReactNode;
  text: string;
  action?: { label: string; onClick: () => void };
}

// 빈 상태 — 섹션을 숨기지 않고 한 줄로 유지 + 다음 행동 링크 (빈약 유저도 구조가 같게 보이도록).
export function DashboardEmpty({ dataId, icon, text, action }: DashboardEmptyProps) {
  return (
    <div data-id={dataId} className="flex items-center gap-2.5 border-t border-divider px-3 py-3.5 text-[13px] text-ink-tertiary">
      <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-alt text-ink-muted">{icon}</span>
      <span className="min-w-0">{text}</span>
      {action && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); action.onClick(); }}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-fine font-semibold text-accent hover:text-accent-focus"
        >
          {action.label}
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

interface DashboardFootProps {
  label: string;
  onClick: () => void;
}

// 하단 링크아웃 행 — 행 상한(5~6)을 넘는 나머지는 목록/탭으로 보낸다(과다 유저 대응).
export function DashboardFoot({ label, onClick }: DashboardFootProps) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1 border-t border-divider px-3 py-2 text-left text-fine text-ink-tertiary hover:text-accent"
    >
      <ArrowRight size={14} strokeWidth={1.5} />
      {label}
    </button>
  );
}
