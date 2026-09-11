// 홈 대시보드 섹션 셸 — 제목(아이콘·건수 칩·헤더 우측 슬롯·더보기 링크) + 본문, 빈 상태 한 줄, 하단 링크아웃 행. 대시보드 카드 6종이 공유.
// 높이는 SECTION_CAP으로 고정 상한(넘치는 본문은 숨김 + 하단 페이드) — 넘칠 때만 헤더에 펼침 토글이 나타나 전체를 연다(사용자 지시 2026-09-11).
"use client";

import { ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

// 접힌 섹션 높이(px) — 6행 카드(헤더 40 + 행 34×6)가 딱 들어가는 값. 2열 그리드의 좌우가 같은 높이로 맞춰진다.
export const SECTION_CAP = 272;

interface DashboardSectionProps {
  dataId: string;
  icon: ReactNode;
  title: string;
  count?: number | null; // null/undefined면 칩 생략
  countHot?: boolean; // 내 결정이 필요한 건수 등 강조
  aside?: ReactNode; // 헤더 우측 슬롯(범위 드롭다운 등) — more보다 앞
  more?: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }; // 이벤트 = 이동 메뉴 앵커 좌표
  children: ReactNode;
}

export function DashboardSection({ dataId, icon, title, count, countHot, aside, more, children }: DashboardSectionProps) {
  const { t } = useI18n();
  const innerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  // 본문 자연 높이를 관찰 — 상한을 넘을 때만 토글·페이드를 보이고, 펼침 애니메이션의 목표 높이로 쓴다
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const overflows = contentHeight > SECTION_CAP;
  const showToggle = overflows || expanded;
  return (
    <section
      data-id={dataId}
      data-expanded={expanded || undefined}
      style={{ maxHeight: expanded ? Math.max(contentHeight, SECTION_CAP) : SECTION_CAP }}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-sm border border-hairline bg-surface transition-[max-height] duration-350 ease-smooth"
    >
      <div ref={innerRef} className="flex flex-col">
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
          <span className="ml-auto flex min-w-0 items-center gap-2">
            {aside}
            {more && (
              <button
                type="button"
                data-id={`${dataId}-more`}
                onClick={(e) => { e.stopPropagation(); more.onClick(e); }}
                className="inline-flex items-center gap-0.5 text-fine text-ink-tertiary hover:text-accent"
              >
                {more.label}
                <ChevronRight size={14} strokeWidth={1.5} />
              </button>
            )}
            {showToggle && (
              <button
                type="button"
                data-id={`${dataId}-expand`}
                aria-expanded={expanded}
                title={expanded ? t("home.dash.collapse") : t("home.dash.expand")}
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="inline-grid h-5 w-5 place-items-center rounded-sm text-ink-tertiary hover:bg-surface-alt hover:text-accent"
              >
                <ChevronDown size={14} strokeWidth={1.5} className={`transition-transform duration-350 ease-smooth ${expanded ? "rotate-180" : ""}`} />
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-col">{children}</div>
      </div>
      {/* 접힌 채 넘칠 때 하단 페이드 — 잘린 행이 "끊긴" 게 아니라 "더 있음"으로 읽히게 */}
      {overflows && !expanded && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" />
      )}
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
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

// 하단 링크아웃 행 — 행 상한(5~6)을 넘는 나머지는 목록/탭으로 보낸다(과다 유저 대응).
export function DashboardFoot({ label, onClick }: DashboardFootProps) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className="inline-flex items-center gap-1 border-t border-divider px-3 py-2 text-left text-fine text-ink-tertiary hover:text-accent"
    >
      <ArrowRight size={14} strokeWidth={1.5} />
      {label}
    </button>
  );
}
