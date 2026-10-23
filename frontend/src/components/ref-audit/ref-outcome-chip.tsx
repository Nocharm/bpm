// 고아 참조 결과 칩 한 개 — 히어로 범례·카드 집계·상세 창 줄/적용 예고가 공유한다(톤·아이콘은 OUTCOME_META).
"use client";

import type { RefOutcome } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { OUTCOME_META, type OutcomeMeta } from "@/lib/ref-audit";
import { getOutcomeLabelKey } from "@/lib/ref-audit-view";

const TONE_CLASS: Record<OutcomeMeta["tone"], string> = {
  ok: "border-added/30 bg-added/10 text-added",
  accent: "border-accent-tint-border bg-accent-tint text-accent",
  warn: "border-warn/30 bg-warn/10 text-warn",
  mute: "border-hairline bg-surface-alt text-ink-tertiary",
  pend: "border-dashed border-accent-tint-border bg-surface text-accent",
};

interface RefOutcomeChipProps {
  outcome: RefOutcome;
  count?: number;          // 적용 예고·집계에서 곳 수를 라벨 뒤에 붙인다
  recipient?: string;      // 알림 수신자 이름 — "오너에게 알림 · 이름"
  role?: "owner" | "holder"; // 알림 수신자 역할(notify_to.role) — 라벨이 오너/점유자로 갈린다
}

export function RefOutcomeChip({ outcome, count, recipient, role }: RefOutcomeChipProps) {
  const { t } = useI18n();
  const { icon: Icon, tone } = OUTCOME_META[outcome];
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-fine ${TONE_CLASS[tone]}`}
    >
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {t(getOutcomeLabelKey(outcome, role))}
      {recipient ? <span>{`· ${recipient}`}</span> : null}
      {count != null ? <span className="font-semibold tabular-nums">{count}</span> : null}
    </span>
  );
}
