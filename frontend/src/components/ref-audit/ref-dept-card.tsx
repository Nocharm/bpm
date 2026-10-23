// 고아 참조 부서 카드 — 4:3 가로형(윗변 띠·각진 점선 타일·이름·상위 경로·곳 수·걸린 맵 2줄·결과 막대·집계). 설정 > 점검 > 고아 참조 페이지의 부서 그리드가 쓴다.
// 4:3은 최소 비율이다 - overflow를 숨기지 않아야 aspect-ratio의 자동 최소 높이가 내용 높이가 되어, 긴 이름이 줄바꿈해도 잘리지 않고 같은 행 카드와 함께 자란다.
"use client";

import { Building2, ChevronRight, FolderTree, Group, Map as MapIcon, type LucideIcon } from "lucide-react";

import { RefCardCount } from "@/components/ref-audit/ref-card-count";
import { RefCardFoot } from "@/components/ref-audit/ref-card-foot";
import type { RefCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { OUTCOME_META, type Bucket } from "@/lib/ref-audit";
import { getDeptCardView, getMapRowKind, type MapRowKind } from "@/lib/ref-audit-view";

const MAP_ROW_ICON: Record<MapRowKind, LucideIcon> = {
  map: MapIcon,
  group: Group,
  category: FolderTree,
  more: MapIcon,
};

// 결과 막대 조각 색 — 게시 대기는 사선 줄무늬(토큰만)
const BAR_CLASS: Record<Bucket, string> = {
  fix: "bg-added",
  notify: "bg-warn/85",
  lock: "bg-border-strong",
  pend: "bg-[repeating-linear-gradient(135deg,var(--color-accent)_0_3px,var(--color-accent-tint-border)_3px_6px)]",
};

interface RefDeptCardProps {
  card: RefCard;
  onOpen: (card: RefCard) => void;
}

export function RefDeptCard({ card, onOpen }: RefDeptCardProps) {
  const { t } = useI18n();
  const view = getDeptCardView(card, (rest) => t("refAudit.moreMaps", { n: rest }));
  const isPend = view.isPendingOnly;
  const { icon: PendingIcon } = OUTCOME_META.pending; // 게시 대기 표식은 곳 수 자리의 모래시계와 같은 아이콘
  return (
    <button
      type="button"
      data-id={`ref-card-dept-${card.key}`}
      aria-haspopup="dialog"
      aria-label={t("refAudit.card.open", { name: card.label })}
      onClick={() => onOpen(card)}
      className={`relative flex aspect-[4/3] min-w-0 flex-col gap-1 rounded-md border border-t-[3px] border-hairline bg-surface px-3.5 pb-3 pt-2.5 text-left transition-[border-color,box-shadow,translate] duration-350 ease-overshoot hover:-translate-y-0.5 hover:border-x-accent-tint-border hover:border-b-accent-tint-border hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${isPend ? "border-t-accent-tint-border" : "border-t-warn/40"}`}
    >
      <span className="flex items-start gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-sm border border-dashed ${isPend ? "border-accent-tint-border bg-accent-tint text-accent" : "border-warn/40 bg-warn/10 text-warn"}`}
        >
          {isPend ? <PendingIcon size={16} strokeWidth={1.5} aria-hidden /> : <Building2 size={16} strokeWidth={1.5} aria-hidden />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] font-semibold leading-[1.3] text-ink [overflow-wrap:anywhere]">
            {card.label}
          </span>
          {view.parentPath ? (
            <span className="flex min-w-0 items-center gap-[3px]">
              <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
              <span className="truncate text-fine text-ink-tertiary">{view.parentPath}</span>
            </span>
          ) : null}
        </span>
        <RefCardCount countText={view.countText} size={17} />
      </span>

      <span className="mt-1 flex flex-col gap-0.5 border-t border-dashed border-hairline pt-2">
        {view.mapRows.map((row) => {
          const RowIcon = MAP_ROW_ICON[getMapRowKind(row)];
          return (
            <span
              key={row.key}
              className={`flex h-[18px] min-w-0 items-center gap-1.5 text-fine ${row.isMore ? "text-ink-tertiary" : "text-ink-secondary"}`}
            >
              <RowIcon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <b className="font-semibold tabular-nums">{row.count}</b>
            </span>
          );
        })}
      </span>

      <span className="mt-auto flex w-full flex-col gap-[7px]">
        <span className="flex h-[5px] gap-0.5 overflow-hidden rounded-full bg-divider">
          {view.bar.map((segment) => (
            <span
              key={segment.bucket}
              className={`block h-full ${BAR_CLASS[segment.bucket]}`}
              style={{ flex: segment.weight }}
            />
          ))}
        </span>
        <RefCardFoot items={view.foot} />
      </span>
    </button>
  );
}
