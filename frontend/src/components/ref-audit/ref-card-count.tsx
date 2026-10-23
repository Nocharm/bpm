// 고아 참조 카드 오른쪽 위 곳 수 — 단위 글자 없는 숫자, 게시 대기만이면 모래시계 표식. 부서·사용자 카드가 공유한다.
"use client";

import { useI18n } from "@/lib/i18n";
import { OUTCOME_META } from "@/lib/ref-audit";

const SIZE_CLASS = { 15: "text-[15px]", 17: "text-[17px]" } as const;

interface RefCardCountProps {
  countText: string | null; // null = 전부 게시 대기라 숫자 대신 표식
  size: keyof typeof SIZE_CLASS;
}

export function RefCardCount({ countText, size }: RefCardCountProps) {
  const { t } = useI18n();
  if (countText === null) {
    const { icon: PendingIcon } = OUTCOME_META.pending;
    const label = t(OUTCOME_META.pending.labelKey);
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="grid size-[22px] shrink-0 place-items-center rounded-full border border-dashed border-accent-tint-border bg-surface text-accent"
      >
        <PendingIcon size={12} strokeWidth={1.5} aria-hidden />
      </span>
    );
  }
  return (
    <b className={`shrink-0 font-semibold leading-none tabular-nums text-ink ${SIZE_CLASS[size]}`}>{countText}</b>
  );
}
