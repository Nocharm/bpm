"use client";

// 섹션 헤더 오른쪽 끝의 i 아이콘 — 호버 시 섹션 설명을 리치 툴팁으로. 설명 문구는 호출부가 i18n으로 넘긴다.
// 임포트 리포트 섹션 공용(components/admin/import-report/).

import { Info } from "lucide-react";

import { Tooltip } from "@/components/tooltip";

export function InfoTip({ text, dataId }: { text: string; dataId?: string }) {
  return (
    <Tooltip content={<span className="block leading-snug">{text}</span>} wide className="ml-auto shrink-0">
      <span
        data-id={dataId}
        tabIndex={0}
        aria-label={text}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
      >
        <Info size={11} strokeWidth={1.5} />
      </span>
    </Tooltip>
  );
}
