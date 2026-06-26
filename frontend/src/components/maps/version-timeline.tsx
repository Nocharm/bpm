"use client";

// 버전 히스토리 — 좌측 타임라인 노드 + 버전 카드(상태·현재·시각). 이벤트 칩은 2줄까지 보이고
// 박스 호버 시 전체로 펼침. 행위자는 이름으로 표시 (H3) / version history with hover-expand history.

import { Check, Clock, GitCommit, type LucideIcon, Plus, Send, Upload, X } from "lucide-react";

import type { VersionDetail, VersionEvent } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

const EVENT_LABEL: Record<string, MessageKey> = {
  created: "home.verEvent.created",
  submitted: "home.verEvent.submitted",
  approved: "home.verEvent.approved",
  rejected: "home.verEvent.rejected",
  published: "home.verEvent.published",
};

// 이벤트 칩 아이콘 / chip icon per event type.
function EventIcon({ type }: { type: string }) {
  if (type === "created") return <Plus size={12} strokeWidth={1.7} />;
  if (type === "submitted") return <Send size={12} strokeWidth={1.7} />;
  if (type === "approved") return <Check size={12} strokeWidth={1.7} />;
  if (type === "rejected") return <X size={12} strokeWidth={1.7} />;
  if (type === "published") return <Upload size={12} strokeWidth={1.7} />;
  return <GitCommit size={12} strokeWidth={1.7} />;
}

// 이벤트 칩 색 — 생성=중립 · 승인요청=accent · 승인/게시=green · 반려=red / chip color per event type.
const EVENT_CHIP: Record<string, string> = {
  created: "border-hairline bg-surface-alt text-ink-secondary",
  submitted: "border-accent-tint-border bg-accent-tint text-accent",
  approved: "border-added/40 bg-added/10 text-added",
  published: "border-added/40 bg-added/10 text-added",
  rejected: "border-error/40 bg-error/10 text-error",
};

// 타임라인 노드 — 최신 이벤트 기준 색·아이콘(승인/게시=채움 green) / node style by latest event.
function nodeFor(eventType: string | undefined): { cls: string; Icon: LucideIcon } {
  switch (eventType) {
    case "created":
      return { cls: "border-accent bg-surface text-accent", Icon: Plus };
    case "submitted":
      return { cls: "border-changed bg-surface text-changed", Icon: Clock };
    case "approved":
      return { cls: "border-added bg-added text-on-accent", Icon: Check };
    case "published":
      return { cls: "border-added bg-added text-on-accent", Icon: Upload };
    case "rejected":
      return { cls: "border-error bg-surface text-error", Icon: X };
    default:
      return { cls: "border-hairline bg-surface text-ink-tertiary", Icon: GitCommit };
  }
}

// created_at(ISO) → "MM-DD HH:mm" KST / compact absolute timestamp.
const formatStamp = formatKstShort;

export function VersionTimeline({
  versions,
  nameById,
}: {
  versions: VersionDetail[];
  // login_id → 표시명 — 칩에 아이디 대신 이름 표시 (H3) / id→name for chip labels.
  nameById?: Map<string, string>;
}) {
  const { t } = useI18n();

  return (
    <div data-id="version-timeline" className="relative flex flex-col gap-3">
      {/* 좌측 세로 연결선 / left timeline rail */}
      <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-hairline" />
      {versions.map((version, idx) => {
        // 최신 이벤트가 앞으로 — 노드는 최신 이벤트 기준 / events newest-first; node reflects the latest.
        const events: VersionEvent[] = [...version.events].reverse();
        const node = nodeFor(events[0]?.event_type);
        const NodeIcon = node.Icon;
        return (
          <div key={version.id} className="group relative flex gap-2.5">
            <span
              className={`z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${node.cls}`}
            >
              <NodeIcon size={13} strokeWidth={2} />
            </span>
            <div
              className={`min-w-0 flex-1 rounded-md border p-2.5 ${
                idx === 0 ? "border-accent-tint-border bg-accent-tint/30" : "border-hairline bg-surface"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-caption-strong text-ink">{version.label}</span>
                  <span
                    className={`shrink-0 rounded-xs border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
                  >
                    {t(VERSION_STATUS_LABEL[version.status])}
                  </span>
                  {idx === 0 && (
                    <span className="shrink-0 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
                      {t("home.verCurrent")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-fine text-ink-tertiary">{formatStamp(version.created_at)}</span>
              </div>
              {events.length > 0 && (
                // 2줄까지 보이고 박스 호버 시 전체로 펼침 (H3) / clamp to ~2 rows, expand on hover.
                <div className="mt-1.5 flex max-h-12 flex-wrap gap-1.5 overflow-hidden transition-[max-height] duration-[200ms] ease-smooth group-hover:max-h-48">
                  {events.map((evt) => (
                    <span
                      key={evt.id}
                      data-id={`version-event-${evt.id}`}
                      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                        EVENT_CHIP[evt.event_type] ?? "border-hairline bg-surface-alt text-ink-secondary"
                      }`}
                      title={EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                    >
                      <EventIcon type={evt.event_type} />
                      {nameById?.get(evt.actor) ?? evt.actor}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
