"use client";

// 2열 임포트 리포트의 섹션 셸 — 헤더(아이콘·제목·카운트/필터 필·i 설명) + 최대 높이 내부 스크롤 본문 + 빈 상태.
// 좌측 4섹션(확인 필요·외부 L6·관리자·거버넌스)과 우측 매칭 실패 묶음이 공유한다.

import type { LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { InfoTip } from "@/components/info-tip";

interface ReportSectionProps {
  dataId: string;
  title: string;
  Icon?: LucideIcon;
  pills?: ReactNode; // 제목 옆 카운트·필터 필
  tip: string;
  isEmpty?: boolean;
  emptyText?: string;
  emptyDataId?: string; // 빈 상태 data-id 재지정 — 기존 스모크가 보는 id(import-governance-none)를 유지할 때
  bodyRef?: RefObject<HTMLDivElement | null>;
  bodyClassName?: string; // 본문 최대 높이 — 기본 max-h-64
  footer?: ReactNode;
  children?: ReactNode;
}

export function ReportSection({
  dataId,
  title,
  Icon,
  pills,
  tip,
  isEmpty = false,
  emptyText,
  emptyDataId,
  bodyRef,
  bodyClassName = "max-h-64",
  footer,
  children,
}: ReportSectionProps) {
  return (
    <section data-id={dataId} className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      <header className="flex items-center gap-2 border-b border-divider bg-surface-alt px-2.5 py-1.5">
        {Icon && <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
        <span className="shrink-0 text-caption-strong text-ink">{title}</span>
        {pills}
        <InfoTip text={tip} dataId={`${dataId}-info`} />
      </header>
      {isEmpty ? (
        <p data-id={emptyDataId ?? `${dataId}-empty`} className="flex items-center gap-2 px-3 py-3 text-fine text-ink-tertiary">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline text-ink-muted">
            ·
          </span>
          {emptyText}
        </p>
      ) : (
        <div ref={bodyRef} className={`scroll-soft overflow-y-auto ${bodyClassName}`}>
          {children}
        </div>
      )}
      {footer}
    </section>
  );
}
