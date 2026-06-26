"use client";

// 버전 git-log 타임라인 — 버전별 생애주기 이벤트(누가·언제)를 커밋 점+세로선으로 / version history as a git log.

import { Check, GitCommit, Info, Send, Upload, X } from "lucide-react";

import type { VersionDetail, VersionEvent } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

// event_type → 아이콘 / icon per event type.
function EventIcon({ type }: { type: string }) {
  if (type === "submitted") return <Send size={14} strokeWidth={1.5} />;
  if (type === "approved") return <Check size={14} strokeWidth={1.5} />;
  if (type === "rejected") return <X size={14} strokeWidth={1.5} />;
  if (type === "published") return <Upload size={14} strokeWidth={1.5} />;
  return <GitCommit size={14} strokeWidth={1.5} />;
}

const EVENT_LABEL: Record<string, MessageKey> = {
  created: "home.verEvent.created",
  submitted: "home.verEvent.submitted",
  approved: "home.verEvent.approved",
  rejected: "home.verEvent.rejected",
  published: "home.verEvent.published",
};

// created_at(ISO) → "MM-DD HH:mm" KST 절대 표기 / compact absolute timestamp (KST).
const formatStamp = formatKstShort;

export function VersionTimeline({ versions }: { versions: VersionDetail[] }) {
  const { t } = useI18n();

  return (
    <div data-id="version-timeline" className="flex flex-col gap-4">
      {versions.map((version) => {
        // 최신이 위로 — created_at 오름차순 응답을 역순 렌더 / newest first.
        const events: VersionEvent[] = [...version.events].reverse();
        return (
          <div key={version.id} className="group flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 truncate text-caption-strong text-ink">
                {version.label}
                {events.length > 0 && (
                  <Info
                    size={12}
                    strokeWidth={1.5}
                    className="shrink-0 text-ink-tertiary transition-opacity group-hover:opacity-0"
                  />
                )}
              </span>
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
              >
                {t(VERSION_STATUS_LABEL[version.status])}
              </span>
            </div>

            {events.length === 0 ? null : (
              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[200ms] ease-smooth group-hover:grid-rows-[1fr]">
                <div className="overflow-hidden">
                  <ol className="flex flex-col pt-1">
                {events.map((evt, i) => (
                  <li
                    key={evt.id}
                    data-id={`version-event-${evt.id}`}
                    className="relative flex gap-2 pb-2 pl-1"
                  >
                    {/* 세로 연결선 (마지막 행 제외) / connecting line */}
                    {i < events.length - 1 && (
                      <span className="absolute left-[0.69rem] top-5 h-full w-px bg-divider" />
                    )}
                    <span className="z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-ink-tertiary ring-1 ring-hairline">
                      <EventIcon type={evt.event_type} />
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-1.5 text-caption text-ink">
                      <span className="text-ink-secondary">
                        {EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                      </span>
                      <span className="text-ink">{evt.actor}</span>
                      <span className="text-fine text-ink-tertiary">{formatStamp(evt.created_at)}</span>
                      {evt.note && (
                        <span className="basis-full text-fine text-ink-tertiary">“{evt.note}”</span>
                      )}
                    </span>
                  </li>
                ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
