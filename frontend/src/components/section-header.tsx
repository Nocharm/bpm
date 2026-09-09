"use client";

// 섹션 헤더 — 체브론(접기/펼치기) + 아이콘 + 제목 + 건수 + 우측 슬롯. 홈 맵 상세 카드의 설명·서브프로세스 정보·
// 노트 세 섹션이 같은 머리 모양을 갖게 하는 공용 조각 (사용자 결정 2026-09-09). 아이콘은 선택 — 에디터 맵 탭의
// 노트 헤더처럼 기존 모양을 유지하는 표면은 생략한다. data-acc-toggle은 인스펙터 아코디언 상태 보존이 읽는다.

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface SectionHeaderProps {
  dataId: string;
  title: string;
  icon?: LucideIcon;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  right?: ReactNode;
  // 톤다운 — 비활성 느낌의 섹션(SP 미지정 맵의 서브프로세스 정보)
  muted?: boolean;
}

export function SectionHeader({ dataId, title, icon: Icon, count, collapsed, onToggle, right, muted }: SectionHeaderProps) {
  return (
    <div className="flex h-5 shrink-0 items-center gap-1">
      <button
        type="button"
        data-id={dataId}
        data-acc-toggle
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={`flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold ${muted ? "text-ink-secondary" : "text-ink"}`}
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        {Icon && <Icon size={14} strokeWidth={1.5} className={`mr-0.5 shrink-0 ${muted ? "text-ink-tertiary" : "text-accent"}`} />}
        <span className="min-w-0 truncate">{title}</span>
        {count !== undefined && <span className="font-normal text-ink-tertiary">({count})</span>}
      </button>
      {right}
    </div>
  );
}
