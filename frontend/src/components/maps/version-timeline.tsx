"use client";

// 버전 히스토리 — 좌측 타임라인 노드 + 버전 카드(상태·현재·시각). 평소 이벤트 칩 2줄,
// 박스 호버 시 칩이 사라지고 이벤트별 상세 행(단계·이름(아이디)·시간)으로 펼침 (H3).

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

// 이벤트 칩/단계 아이콘 / icon per event type.
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

// 상세 행 단계 텍스트 색 / stage text color per event type.
const STAGE_COLOR: Record<string, string> = {
  created: "text-ink-secondary",
  submitted: "text-accent",
  approved: "text-added",
  published: "text-added",
  rejected: "text-error",
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
  // login_id → 표시명 — 칩·상세 행에 아이디 대신 이름 (H3) / id→name.
  nameById?: Map<string, string>;
}) {
  const { t } = useI18n();
  const nameOf = (id: string) => nameById?.get(id) ?? id;

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
                <>
                  {/* 평소: 이벤트 칩 2줄(이름) — 호버 시 숨김 / chips, hidden on hover */}
                  <div className="mt-1.5 flex max-h-12 flex-wrap gap-1.5 overflow-hidden group-hover:hidden">
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
                        {nameOf(evt.actor)}
                      </span>
                    ))}
                  </div>

                  {/* 호버: 이벤트별 상세 행(단계 · 이름(아이디) · 시간) 펼침 / detailed rows on hover */}
                  <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[200ms] ease-smooth group-hover:grid-rows-[1fr]">
                    <div className="overflow-hidden">
                      <div className="mt-1.5 flex flex-col gap-1">
                        {events.map((evt) => (
                          <div key={evt.id} className="flex items-center gap-2 text-fine">
                            <span
                              className={`inline-flex w-16 shrink-0 items-center gap-1 ${
                                STAGE_COLOR[evt.event_type] ?? "text-ink-secondary"
                              }`}
                            >
                              <EventIcon type={evt.event_type} />
                              {EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-ink">
                              {nameOf(evt.actor)}
                              <span className="text-ink-tertiary"> ({evt.actor})</span>
                            </span>
                            <span className="shrink-0 text-ink-tertiary">{formatStamp(evt.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
