"use client";

// 버전 히스토리 — 좌측 타임라인 노드 + 버전 카드(상태·현재·시각). 평소 이벤트 칩 2줄,
// 박스 클릭 시 칩 대신 이벤트별 상세 행(단계 필·이름·아이디·시간)으로 펼침. 여러 개 동시 펼침 가능 (H3).
// 펼침 상태는 부모(map-detail-card)가 보유 — '모두 접기' 공유.

import { Fragment } from "react";
import { Check, Clock, GitCommit, type LucideIcon, Plus, Send, Upload, X } from "lucide-react";

import type { VersionDetail, VersionEvent } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
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

// 이벤트 칩/단계 필 색 — 생성=중립 · 승인요청=accent · 승인/게시=green · 반려=red.
const EVENT_CHIP: Record<string, string> = {
  created: "border-hairline bg-surface-alt text-ink-secondary",
  submitted: "border-accent-tint-border bg-accent-tint text-accent",
  approved: "border-added/40 bg-added/10 text-added",
  published: "border-added/40 bg-added/10 text-added",
  rejected: "border-error/40 bg-error/10 text-error",
};

// 타임라인 노드 — 최신 이벤트 기준 색·아이콘(승인/게시=채움 green).
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

// created_at(ISO) → "YYYY-MM-DD HH:mm" KST.
const formatStamp = formatKst;

export function VersionTimeline({
  versions,
  nameById,
  expandedIds,
  onToggle,
}: {
  versions: VersionDetail[];
  // login_id → 표시명 / id→name.
  nameById?: Map<string, string>;
  // 펼친 버전 id 집합(부모 보유) / expanded version ids (parent-owned).
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const { t } = useI18n();
  const nameOf = (id: string) => nameById?.get(id) ?? id;

  return (
    <div data-id="version-timeline" className="relative flex flex-col gap-3">
      {/* 좌측 세로 연결선 / left timeline rail */}
      <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-hairline" />
      {/* 최신 버전이 위로 — idx 0 = 최신 = Current / newest first. */}
      {[...versions].reverse().map((version, idx) => {
        // 최신 이벤트가 앞으로 — 노드는 최신 이벤트 기준 / events newest-first.
        const events: VersionEvent[] = [...version.events].reverse();
        const node = nodeFor(events[0]?.event_type);
        const NodeIcon = node.Icon;
        const open = expandedIds.has(version.id);
        return (
          <div key={version.id} className="relative flex gap-2.5">
            <span
              className={`z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${node.cls}`}
            >
              <NodeIcon size={13} strokeWidth={2} />
            </span>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => onToggle(version.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(version.id);
                }
              }}
              className={`min-w-0 flex-1 cursor-pointer rounded-md border p-2.5 transition-colors ${
                idx === 0
                  ? "border-accent-tint-border bg-accent-tint/30 hover:bg-accent-tint/50"
                  : "border-hairline bg-surface hover:bg-surface-alt"
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
                  {/* 평소: 이벤트 칩 2줄(이름) — 펼치면 숨김 / chips when collapsed */}
                  {!open && (
                    <div className="mt-1.5 flex max-h-12 flex-wrap gap-1.5 overflow-hidden">
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
                  )}

                  {/* 펼침: 이벤트별 상세 행(단계 필·이름·아이디·시간) — 그리드로 열 정렬 / detail rows in a grid */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 text-fine">
                        {events.map((evt) => (
                          <Fragment key={evt.id}>
                            <span
                              className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 ${
                                EVENT_CHIP[evt.event_type] ?? "border-hairline bg-surface-alt text-ink-secondary"
                              }`}
                            >
                              <EventIcon type={evt.event_type} />
                              {EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                            </span>
                            <span className="min-w-0 truncate text-ink">{nameOf(evt.actor)}</span>
                            <span className="text-ink-tertiary">{evt.actor}</span>
                            <span className="text-ink-tertiary">{formatStamp(evt.created_at)}</span>
                          </Fragment>
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
