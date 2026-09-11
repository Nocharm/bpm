// 홈 대시보드 — 내 맵(오너/편집자)에서 최근 일어난 버전 이벤트 타임라인. 6행 상한. 알 수 없는 유형은 원문 표기.
// 문장 속 유저·맵·버전은 각각 필/굵은 이름/버전 칩으로 구분해 스캔되게 하고, 이벤트 종류 아이콘은 행 끝(시각 뒤)에 둔다
// (아이콘·칩 색은 버전 타임라인 version-timeline.tsx의 이벤트 칩과 같은 톤).
"use client";

import { BadgeCheck, Check, GitCommit, History, Plus, Send, TimerOff, Upload, User, X } from "lucide-react";
import type { ReactNode } from "react";

import type { MeDashboardEvent } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { useAgo } from "@/lib/use-ago";
import { HoverLinkedRow } from "@/components/maps/dashboard-hover-row";
import { DashboardEmpty, DashboardSection } from "@/components/maps/dashboard-section";
import { SkeletonLine } from "@/components/skeleton";
import { Tooltip } from "@/components/tooltip";

const ROW_CAP = 6;

// 이벤트 유형 → 행 끝 아이콘 칩(색·아이콘)·문장 키. 목록 밖 유형은 중립 칩 + 원문 유형.
const EVENT_STYLE: Record<string, { chip: string; icon: ReactNode; key: MessageKey }> = {
  created: { chip: "border-hairline bg-surface-alt text-ink-secondary", icon: <Plus size={11} strokeWidth={1.8} />, key: "home.dash.event.created" },
  submitted: { chip: "border-accent-tint-border bg-accent-tint text-accent", icon: <Send size={11} strokeWidth={1.8} />, key: "home.dash.event.submitted" },
  approved: { chip: "border-added/40 bg-added/10 text-added", icon: <Check size={11} strokeWidth={1.8} />, key: "home.dash.event.approved" },
  rejected: { chip: "border-error/40 bg-error/10 text-error", icon: <X size={11} strokeWidth={1.8} />, key: "home.dash.event.rejected" },
  published: { chip: "border-added/40 bg-added/10 text-added", icon: <Upload size={11} strokeWidth={1.8} />, key: "home.dash.event.published" },
  confirmed: { chip: "border-accent-tint-border bg-accent-tint text-accent", icon: <BadgeCheck size={11} strokeWidth={1.8} />, key: "home.dash.event.confirmed" },
  expired: { chip: "border-hairline bg-surface-alt text-ink-muted", icon: <TimerOff size={11} strokeWidth={1.8} />, key: "home.dash.event.expired" },
};
const UNKNOWN_CHIP = "border-hairline bg-surface text-ink-tertiary";

// "{actor} ... {map} {version}" 템플릿을 토큰 자리마다 노드로 치환 — 언어별 어순은 메시지가 정하고, 스타일은 여기서 입힌다.
// 행이 flex(items-center)라 글자 조각도 항목으로 감싼다 — 필·칩과 세로 중앙이 맞고, 맵 이름만 말줄임된다
function renderTemplate(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{actor\}|\{map\}|\{version\})/).map((seg, i) => {
    const token = seg.startsWith("{") ? seg.slice(1, -1) : null;
    if (token && token in parts) return <span key={i} className="contents">{parts[token]}</span>;
    const text = seg.trim();
    return text === "" ? null : <span key={i} className="shrink-0 whitespace-nowrap">{text}</span>;
  });
}

interface RecentEventsCardProps {
  events: MeDashboardEvent[] | null; // 도착 전 null
  onSelect: (mapId: number) => void;
}

export function RecentEventsCard({ events, onSelect }: RecentEventsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const dir = useDirectory();
  return (
    <DashboardSection
      dataId="home-recent-events"
      icon={<History size={16} strokeWidth={1.5} />}
      title={t("home.dash.recentChanges")}
      empty={events !== null && events.length === 0 ? <DashboardEmpty icon={<History size={14} strokeWidth={1.5} />} text={t("home.dash.recentChangesEmpty")} /> : undefined}
    >
      {events === null ? (
        <div className="flex flex-col gap-2 border-t border-divider px-3 py-3">
          <SkeletonLine className="w-4/5" />
          <SkeletonLine className="w-3/5" />
        </div>
      ) : events.length === 0 ? null : (
        events.slice(0, ROW_CAP).map((e) => {
          const style = EVENT_STYLE[e.event_type];
          const actorName = e.actor_name ?? dir.get(e.actor)?.name ?? e.actor;
          const versionText = e.version_number != null ? `v${e.version_number}` : e.version_label;
          const parts: Record<string, ReactNode> = {
            actor: (
              <span data-id="dashboard-event-actor" className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-full bg-surface-alt px-1.5 text-[11px] font-semibold text-ink-secondary">
                <User size={10} strokeWidth={2} />
                {actorName}
              </span>
            ),
            map: <b data-id="dashboard-event-map" className="min-w-0 truncate font-semibold text-ink">{e.map_name}</b>,
            version: (
              // 라벨형 버전("Release 6 …")은 칩 안에서 자르고 뒤의 동사는 남긴다
              <span data-id="dashboard-event-version" title={versionText} className="inline-flex h-[18px] max-w-24 shrink-0 items-center rounded-[4px] border border-hairline bg-surface px-1 text-[11px] tabular-nums text-ink-tertiary">
                {/* 말줄임은 안쪽 span에 — flex 컨테이너 자체엔 text-overflow가 안 먹는다 */}
                <span className="truncate">{versionText}</span>
              </span>
            ),
          };
          return (
            <HoverLinkedRow
              key={`${e.version_id}-${e.event_type}-${e.created_at}`}
              mapId={e.map_id}
              dataId="dashboard-event-row"
              extraData={{ "data-event": e.event_type }}
              onClick={() => onSelect(e.map_id)}
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-divider px-3 py-1.5 text-left"
            >
              {/* 조각(필·이름·칩·글자)을 한 줄 flex로 세로 중앙 정렬 — 이름만 말줄임, 메모는 남는 폭에서 말줄임 */}
              <span className="flex min-w-0 items-center gap-1 text-[13px] leading-5 text-ink-secondary">
                {style ? (
                  renderTemplate(t(style.key), parts)
                ) : (
                  <>
                    {parts.map}
                    {parts.version}
                    <span className="shrink-0">· {e.event_type}</span>
                  </>
                )}
                {e.note && <span className="min-w-0 truncate text-ink-tertiary">— “{e.note}”</span>}
              </span>
              <span className="text-[11px] text-ink-tertiary">{ago(e.created_at)}</span>
              {/* 이벤트 종류 — 행 끝 아이콘 칩(사용자 지시 2026-09-11: 액션 아이콘은 내용 끝단) */}
              <Tooltip label={e.event_type}>
                <span data-id="dashboard-event-icon" className={`inline-grid h-[18px] w-[18px] place-items-center rounded-[5px] border ${style?.chip ?? UNKNOWN_CHIP}`}>
                  {style?.icon ?? <GitCommit size={11} strokeWidth={1.8} />}
                </span>
              </Tooltip>
            </HoverLinkedRow>
          );
        })
      )}
    </DashboardSection>
  );
}
