// 홈 대시보드 — 내 맵(오너/편집자)에서 최근 일어난 버전 이벤트 타임라인. 6행 상한. 알 수 없는 유형은 원문 표기.
"use client";

import { History } from "lucide-react";

import type { MeDashboardEvent } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { useAgo } from "@/lib/use-ago";
import { DashboardEmpty, DashboardSection } from "@/components/maps/dashboard-section";
import { SkeletonLine } from "@/components/skeleton";

const ROW_CAP = 6;

// 이벤트 유형 → 점 색·문장 키. 목록 밖 유형은 회색 점 + 원문 유형.
const EVENT_STYLE: Record<string, { dot: string; key: MessageKey }> = {
  created: { dot: "bg-surface-chip", key: "home.dash.event.created" },
  submitted: { dot: "bg-changed", key: "home.dash.event.submitted" },
  approved: { dot: "bg-accent", key: "home.dash.event.approved" },
  rejected: { dot: "bg-error", key: "home.dash.event.rejected" },
  published: { dot: "bg-added", key: "home.dash.event.published" },
  confirmed: { dot: "bg-accent-elevated", key: "home.dash.event.confirmed" },
  expired: { dot: "bg-ink-muted", key: "home.dash.event.expired" },
};

interface RecentEventsCardProps {
  events: MeDashboardEvent[] | null; // 도착 전 null
  onSelect: (mapId: number) => void;
}

export function RecentEventsCard({ events, onSelect }: RecentEventsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const dir = useDirectory();
  return (
    <DashboardSection dataId="home-recent-events" icon={<History size={16} strokeWidth={1.5} />} title={t("home.dash.recentChanges")}>
      {events === null ? (
        <div className="flex flex-col gap-2 border-t border-divider px-3 py-3">
          <SkeletonLine className="w-4/5" />
          <SkeletonLine className="w-3/5" />
        </div>
      ) : events.length === 0 ? (
        <DashboardEmpty icon={<History size={14} strokeWidth={1.5} />} text={t("home.dash.recentChangesEmpty")} />
      ) : (
        events.slice(0, ROW_CAP).map((e) => {
          const style = EVENT_STYLE[e.event_type];
          const actor = e.actor_name ?? dir.get(e.actor)?.name ?? e.actor;
          const version = e.version_number != null ? `v${e.version_number}` : e.version_label;
          return (
            <button
              key={`${e.version_id}-${e.event_type}-${e.created_at}`}
              type="button"
              onClick={(ev) => { ev.stopPropagation(); onSelect(e.map_id); }}
              className="grid w-full grid-cols-[8px_1fr_auto] items-baseline gap-2 border-t border-divider px-3 py-1.5 text-left hover:bg-surface-pearl"
            >
              <span className={`mt-1 h-2 w-2 self-center rounded-full ${style?.dot ?? "bg-ink-tertiary"}`} />
              <span className="min-w-0 truncate text-[13px] text-ink-secondary">
                {style ? (
                  t(style.key, { actor, map: e.map_name, version })
                ) : (
                  <>
                    <b className="font-semibold text-ink">{e.map_name}</b> {version} · {e.event_type}
                  </>
                )}
                {e.note && <span className="text-ink-tertiary"> — “{e.note}”</span>}
              </span>
              <span className="text-[11px] text-ink-tertiary">{ago(e.created_at)}</span>
            </button>
          );
        })
      )}
    </DashboardSection>
  );
}
