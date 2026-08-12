// 맵 카드 리스트 3.5개 높이 클램프 — 긴 목록은 3.5개만 보여 "더 있음"을 암시하고,
// 접힌 영역은 내부 스크롤(휠이 올라간 영역만 스크롤 — overscroll-contain으로 바깥 전파 차단),
// 아래 풀폭 쉐브론 버튼(Show all ⌄ / Collapse ⌃)으로 전체 펼침·재접힘을 토글한다.
// 홈 부서 목록(org-accordion)과 업무 체계 목록(framework-tree)이 공유. 펼침 상태 영속은 호출부 책임.
"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

// 클램프 발동 임계 — 이 개수 이하면 클램프도 버튼도 없다.
export const CLAMP_VISIBLE = 3;
// 3.5개 높이(px) — 카드 실측 h≈77px(1440 뷰포트, 2026-08-12) × 3.5 + 카드 간 gap-2(8px) × 3.
// 카드 높이가 바뀌면 함께 조정한다. 반 장이 잘려 보이는 것이 "더 있음"의 시각 단서다.
const CLAMP_MAX_HEIGHT_PX = 77 * 3.5 + 8 * 3;

interface ClampedListProps {
  // 리스트의 맵 카드 수 — 노트/페이지네이션 행은 제외하고 센다(임계 판정 기준).
  count: number;
  expanded: boolean;
  onToggle: () => void;
  dataId: string;
  children: ReactNode;
}

export function ClampedList({ count, expanded, onToggle, dataId, children }: ClampedListProps) {
  const { t } = useI18n();
  if (count <= CLAMP_VISIBLE) return <>{children}</>;
  const clamped = !expanded;
  return (
    <div className="flex flex-col gap-1">
      <div
        data-id={`${dataId}-scroll`}
        className={clamped ? "overflow-y-auto overscroll-contain" : undefined}
        style={clamped ? { maxHeight: `${CLAMP_MAX_HEIGHT_PX}px` } : undefined}
      >
        {children}
      </div>
      <button
        type="button"
        data-id={dataId}
        aria-expanded={!clamped}
        onClick={(e) => {
          e.stopPropagation(); // 박스/행 클릭(선택 해제 등)으로 버블링 방지
          onToggle();
        }}
        className="flex w-full items-center justify-center gap-1 rounded-sm py-1 text-fine text-ink-tertiary hover:bg-divider hover:text-ink"
      >
        {clamped ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronUp size={14} strokeWidth={1.5} />}
        {clamped ? t("home.listShowAll", { n: count }) : t("home.listCollapse")}
      </button>
    </div>
  );
}
