// 섹션 덮개 — 반투명 흰 레이어로 본문을 덮고 가운데에 아이콘·제목·설명을 띄운다. 임포트 리포트(적용 완료·적용 중·드라이런 중)와
// 홈 대시보드 지연 이동 대기(NavPendingOverlay)가 공유. onClick을 주면 레이어 전체가 클릭 대상(취소 등)이 된다.
"use client";

import type { ReactNode } from "react";

interface SectionOverlayProps {
  dataId: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  onClick?: () => void;
  compact?: boolean; // 타일처럼 작은 영역 — 아이콘 원·글자·간격을 줄여 두 줄에 맞춘다
  children?: ReactNode; // 제목·설명 아래 추가 슬롯(data-id가 필요한 문구 등)
}

export function SectionOverlay({ dataId, icon, title, sub, onClick, compact = false, children }: SectionOverlayProps) {
  return (
    <div
      data-id={dataId}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      data-compact={compact ? "" : undefined}
      className={`absolute inset-0 z-[2] flex items-center justify-center rounded-[inherit] bg-surface/70 backdrop-blur-[1px] ${
        compact ? "px-2" : "px-4"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className={`flex max-w-[36ch] flex-col items-center text-center ${compact ? "gap-0.5" : "gap-1.5"}`}>
        <span
          className={`inline-grid place-items-center rounded-full border border-accent-tint-border bg-surface text-accent shadow-sm ${
            compact ? "h-6 w-6" : "h-9 w-9"
          }`}
        >
          {icon}
        </span>
        <span className={`truncate ${compact ? "max-w-full text-fine font-semibold text-ink" : "text-caption-strong text-ink"}`}>{title}</span>
        {sub && <span className={`break-keep text-balance text-ink-tertiary ${compact ? "text-[10px]" : "text-fine"}`}>{sub}</span>}
        {children}
      </div>
    </div>
  );
}
