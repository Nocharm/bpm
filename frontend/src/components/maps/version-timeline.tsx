"use client";

// 버전 히스토리 — 좌측 타임라인 노드 + 버전 카드(상태·현재·시각). 평소 이벤트 칩 2줄,
// 박스 클릭 시 칩 대신 이벤트별 상세 행(단계 필·이름·아이디·시간)으로 펼침. 여러 개 동시 펼침 가능 (H3).
// 펼침 상태는 부모(map-detail-card)가 보유 — '모두 접기' 공유.

import { Check, Clock, GitCommit, type LucideIcon, Plus, Send, Undo2, Upload, X } from "lucide-react";

import type { VersionDetail, VersionEvent } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { formatVersionMarker } from "@/lib/version-name";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

const EVENT_LABEL: Record<string, MessageKey> = {
  created: "home.verEvent.created",
  submitted: "home.verEvent.submitted",
  approved: "home.verEvent.approved",
  rejected: "home.verEvent.rejected",
  published: "home.verEvent.published",
  withdrawn: "home.verEvent.withdrawn",
};

// 이벤트 칩/단계 아이콘 / icon per event type.
function EventIcon({ type }: { type: string }) {
  if (type === "created") return <Plus size={12} strokeWidth={1.7} />;
  if (type === "submitted") return <Send size={12} strokeWidth={1.7} />;
  if (type === "approved") return <Check size={12} strokeWidth={1.7} />;
  if (type === "rejected") return <X size={12} strokeWidth={1.7} />;
  if (type === "published") return <Upload size={12} strokeWidth={1.7} />;
  if (type === "withdrawn") return <Undo2 size={12} strokeWidth={1.7} />;
  return <GitCommit size={12} strokeWidth={1.7} />;
}

// 이벤트 칩/단계 필 색 — 생성=중립 · 승인요청=accent · 승인/게시=green · 반려=red.
const EVENT_CHIP: Record<string, string> = {
  created: "border-hairline bg-surface-alt text-ink-secondary",
  submitted: "border-accent-tint-border bg-accent-tint text-accent",
  approved: "border-added/40 bg-added/10 text-added",
  published: "border-added/40 bg-added/10 text-added",
  rejected: "border-error/40 bg-error/10 text-error",
  withdrawn: "border-changed/40 bg-changed/10 text-changed",
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
    case "withdrawn":
      return { cls: "border-changed bg-surface text-changed", Icon: Undo2 };
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
        // 회수는 백엔드에서 조건부 기록(승인 1건 이상일 때만) — 남아 있으면 그대로 표시.
        const events: VersionEvent[] = [...version.events].reverse();
        // 상세행 — 날짜/시각 분리. 같은 날짜 연속이면 날짜 박스 1개가 그 행들 높이만큼 span(rowspan), 날짜 윗 정렬 (H3)
        const rawRows = events.map((evt) => {
          const full = formatStamp(evt.created_at);
          const sep = full.indexOf(" ");
          return {
            evt,
            date: sep >= 0 ? full.slice(0, sep) : full,
            time: sep >= 0 ? full.slice(sep + 1) : "",
          };
        });
        const detailRows = rawRows.map((r, i) => {
          if (i > 0 && rawRows[i - 1]?.date === r.date) return { ...r, dateSpan: 0 };
          let span = 1;
          while (i + span < rawRows.length && rawRows[i + span]?.date === r.date) span += 1;
          return { ...r, dateSpan: span };
        });
        const node = nodeFor(events[0]?.event_type);
        const NodeIcon = node.Icon;
        const open = expandedIds.has(version.id);
        // sticky 1열 배경 = 카드 배경(현재 카드 연보라)에 맞춤 — 흰 열로 튀지 않게, hover도 동기화
        const cardBg =
          idx === 0
            ? "bg-accent-tint/30 group-hover:bg-accent-tint/50"
            : "bg-surface group-hover:bg-surface-alt";
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
              className={`group min-w-0 flex-1 cursor-pointer rounded-md border p-2.5 transition-colors ${
                idx === 0
                  ? "border-accent-tint-border bg-accent-tint/30 hover:bg-accent-tint/50"
                  : "border-hairline bg-surface hover:bg-surface-alt"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {/* 버전 마커 + 이름 — 버전 필과 동일(번호 작게 회색·이름 강조). 좁아지면 이름 말줄임. */}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-fine text-ink-tertiary">{formatVersionMarker(version, versions)}</span>{" "}
                    <span className="text-caption-strong text-ink">{version.label}</span>
                  </span>
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
                  {/* 평소: 이벤트 칩 2줄 — 펼치면 접힘(상세 펼침과 동시 전환 → 높이가 줄었다 커지지 않음) / chips collapse as detail expands */}
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="mt-1.5 flex max-h-12 flex-wrap gap-1.5">
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
                    </div>
                  </div>

                  {/* 펼침: 이벤트별 상세 행(단계 필·이름·아이디·시간) — 칩이 접히는 만큼 동시에 펼침 / detail expands as chips collapse */}
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      {/* 좁은 사이드바 대응 — 가로 스크롤(스크롤바 숨김), 1열(단계 필) sticky 고정으로 시간대 확인.
                          넓은 폭(홈 상세)에선 w-full로 채워 이름 열이 늘어나 날짜/시간이 우측 정렬. */}
                      <div className="mt-1.5 overflow-x-auto scrollbar-hidden">
                      <table className="w-full min-w-max border-separate border-spacing-x-2 border-spacing-y-1 text-fine">
                        <tbody>
                          {detailRows.map(({ evt, date, time, dateSpan }) => (
                            <tr key={evt.id} className="align-top">
                              <td className={`sticky left-0 z-[1] w-24 ${cardBg}`}>
                                <span
                                  className={`inline-flex w-24 items-center justify-center gap-1 rounded-sm border px-1.5 py-0.5 ${
                                    EVENT_CHIP[evt.event_type] ?? "border-hairline bg-surface-alt text-ink-secondary"
                                  }`}
                                >
                                  <EventIcon type={evt.event_type} />
                                  {EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                                </span>
                              </td>
                              <td className="w-full whitespace-nowrap text-ink">{nameOf(evt.actor)}</td>
                              <td className="whitespace-nowrap text-ink-tertiary">{evt.actor}</td>
                              {dateSpan > 0 && (
                                <td
                                  rowSpan={dateSpan}
                                  className="min-w-[5.25rem] rounded-xs border border-divider px-1.5 py-0.5 text-center align-top text-ink-tertiary"
                                >
                                  {/* 박스 = td 자체(테두리) → rowspan 만큼 높이 증가(2일=2배·3일=3배), 날짜 윗 정렬 (H3) */}
                                  {date}
                                </td>
                              )}
                              <td className="whitespace-nowrap text-right">
                                <span className="rounded-xs border border-hairline px-1.5 py-0.5 text-ink-tertiary">
                                  {time}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
