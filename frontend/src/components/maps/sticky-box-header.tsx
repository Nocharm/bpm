// 틴트 박스 헤더의 스티키 래퍼 — 긴 목록을 스크롤해도 헤더(부서/카테고리명)가 컬럼 상단에 붙어
// 언제든 접을 수 있고, 리스트가 "전체 펼치기" 상태일 때만 우측에 다시 접기 버튼을 낸다.
// 홈 부서 목록·미지정·나의 부서·업무 체계 박스가 공유. 배경은 박스 틴트와 같은 색으로 카드 비침 차단.
"use client";

import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

interface StickyBoxHeaderProps {
  children: ReactNode; // 헤더 토글 버튼(기존 행 그대로)
  // 우측 다시 접기 버튼 노출 조건 — 리스트가 클램프를 넘겨 전체 펼침된 상태일 때만.
  showCollapse: boolean;
  onCollapse: () => void;
  dataId: string;
}

export function StickyBoxHeader({ children, showCollapse, onCollapse, dataId }: StickyBoxHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 z-[1] flex items-center rounded-t-sm bg-surface-alt pr-1">
      <div className="min-w-0 flex-1">{children}</div>
      {showCollapse && (
        <button
          type="button"
          data-id={dataId}
          className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-fine text-ink-tertiary hover:bg-divider hover:text-ink"
          onClick={(e) => {
            e.stopPropagation(); // 헤더 토글(박스 접기)로 버블링 방지
            onCollapse();
          }}
        >
          <ChevronUp size={14} strokeWidth={1.5} />
          {t("home.listCollapse")}
        </button>
      )}
    </div>
  );
}
