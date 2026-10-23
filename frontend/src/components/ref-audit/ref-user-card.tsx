// 고아 참조 사용자 카드 — 정사각 가운데 정렬(결과 비율 링 아바타·이름·로그인·곳 수·집계). 설정 > 점검 > 고아 참조 페이지의 사용자 그리드가 쓴다.
"use client";

import { UserX } from "lucide-react";

import { RefCardCount } from "@/components/ref-audit/ref-card-count";
import { RefCardFoot } from "@/components/ref-audit/ref-card-foot";
import type { RefCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getUserCardView } from "@/lib/ref-audit-view";

// 링 두께 3px: 바깥 지름 36px 중 안쪽 반지름 15px까지는 비워 아바타(30px)가 들어앉는다
const RING_MASK = "radial-gradient(circle, transparent 14.5px, black 15px)";

interface RefUserCardProps {
  card: RefCard;
  onOpen: (card: RefCard) => void;
}

export function RefUserCard({ card, onOpen }: RefUserCardProps) {
  const { t } = useI18n();
  const view = getUserCardView(card);
  return (
    <button
      type="button"
      data-id={`ref-card-user-${card.key}`}
      aria-haspopup="dialog"
      aria-label={t("refAudit.card.open", { name: card.label })}
      onClick={() => onOpen(card)}
      className="relative flex aspect-square min-w-0 flex-col items-center gap-1 overflow-hidden rounded-md border border-hairline bg-surface p-3 text-center transition-[border-color,box-shadow,translate] duration-350 ease-overshoot hover:-translate-y-0.5 hover:border-accent-tint-border hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="absolute right-[11px] top-2.5">
        <RefCardCount countText={view.countText} size={15} />
      </span>
      <span className="relative mb-1.5 mt-1 size-9 shrink-0 rounded-full p-[3px]">
        <span
          aria-hidden
          data-id={`ref-card-user-ring-${card.key}`}
          className="absolute inset-0 rounded-full"
          style={{ background: view.ringGradient, maskImage: RING_MASK, WebkitMaskImage: RING_MASK }}
        />
        <span className="relative grid size-full place-items-center rounded-full border-[1.5px] border-dashed border-ink-muted bg-surface-alt text-caption-strong text-ink-tertiary">
          {view.initial}
          <span className="absolute -bottom-1 -right-1.5 grid size-3.5 place-items-center rounded-full border border-warn/40 bg-warn/10 text-warn">
            <UserX size={10} strokeWidth={1.5} aria-hidden />
          </span>
        </span>
      </span>
      <span className="line-clamp-2 text-caption-strong text-ink [overflow-wrap:anywhere]">{card.label}</span>
      {view.subKey ? (
        <span className="max-w-full truncate text-[11.5px] text-ink-tertiary">{t(view.subKey)}</span>
      ) : (
        <span className="max-w-full truncate font-mono text-[11px] text-ink-tertiary">{view.sub}</span>
      )}
      <span className="mt-auto w-full">
        <RefCardFoot items={view.foot} center />
      </span>
    </button>
  );
}
