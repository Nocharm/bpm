"use client";

// 우측 L5 파일 카드 — 헤더(Lv5 필·이름 / 계보 브레드크럼+업무체계 탐색 아이콘 / 맵·노트 수, 우측 외부 L6 필+파일명) +
// 캔버스 행 + 항상 펼친 L6 맵 목록(4행 노출·숨은 스크롤·5개 이상이면 모두 보기) + 행별 미리보기(한 번에 하나).
// 헤더 클릭=L5 포커스, 행 클릭=맵 포커스, 좌측 항목 호버 시 해당 행/헤더가 peer로 밝아진다 (사용자 승인 목업 2026-09-08).

import { AlertTriangle, ChevronRight, Eye, FolderTree, Workflow } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";

import type { InterviewFileReport } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ExternalCanvasCounts, IndexedFile, ReportGroup, ReportMapEntry } from "@/lib/interview-report";
import type { RelatedTags, ReportFocus } from "@/lib/interview-report-focus";
import { Tooltip } from "@/components/tooltip";

import { ImportMapPreview } from "./map-preview";
import {
  EXTERNAL_STATE_TONE,
  KeyIcon,
  OUTCOME_LABEL,
  OUTCOME_PILL,
  PILL_BASE,
  ROW_PEER_CLASS,
  type Describe,
} from "./report-bits";

const VISIBLE_ROWS = 4;
const FOCUS_ROW_CLASS = "bg-accent-tint shadow-[inset_3px_0_0_var(--color-accent)]";

function isControlTarget(event: MouseEvent | KeyboardEvent): boolean {
  return event.target instanceof HTMLElement && event.target.closest("button, [data-stop]") !== null;
}

interface ImportMapRowProps {
  entry: ReportMapEntry;
  focused: boolean;
  fileFocused: boolean;
  peer: boolean;
  previewing: boolean;
  row: unknown; // 미리보기용 원문 행(rows[i]) — 없으면 미리보기 불가 문구
  describe: Describe;
  onFocus: () => void;
  onTogglePreview: () => void;
}

/** 맵 1행 = [결과 배지][이름][Preview(호버)·버전·경고 수(호버=문구)·고유키(#)] + 열린 미리보기. 매칭 실패 묶음도 재사용. */
export function ImportMapRow({
  entry,
  focused,
  fileFocused,
  peer,
  previewing,
  row,
  describe,
  onFocus,
  onTogglePreview,
}: ImportMapRowProps) {
  const { t } = useI18n();
  const hasError = entry.messages.some((m) => m.severity === "error");
  const tone = focused
    ? FOCUS_ROW_CLASS
    : peer
      ? ROW_PEER_CLASS
      : fileFocused
        ? "bg-accent-tint/30"
        : "hover:bg-surface-alt/70";
  return (
    <li
      data-id={`interview-map-${entry.code}`}
      data-focused={focused ? "true" : undefined}
      className={`group border-t border-divider transition-colors duration-150 first:border-t-0 ${tone}`}
    >
      <div
        role="button"
        tabIndex={0}
        className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5"
        onClick={(event) => {
          if (!isControlTarget(event)) onFocus();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !isControlTarget(event)) {
            event.preventDefault();
            onFocus();
          }
        }}
      >
        <span className={`${PILL_BASE} ${OUTCOME_PILL[entry.outcome ?? "unchanged"]}`}>
          {t(OUTCOME_LABEL[entry.outcome ?? "unchanged"])}
        </span>
        <span className="truncate text-caption text-ink">{entry.name}</span>
        <span className="flex items-center gap-2 text-fine text-ink-tertiary">
          <button
            type="button"
            data-id={`interview-map-preview-btn-${entry.code}`}
            aria-pressed={previewing}
            className={`inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-surface px-1.5 py-px text-fine text-accent transition-opacity duration-150 hover:bg-accent-tint ${
              previewing ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePreview();
            }}
          >
            <Eye size={12} strokeWidth={1.5} />
            {t("framework.report.preview")}
          </button>
          {entry.version !== null && (
            <span className={`${PILL_BASE} border-hairline bg-surface-alt text-ink-tertiary`}>v{entry.version}</span>
          )}
          {entry.messages.length > 0 && (
            <Tooltip
              content={
                <span className="flex w-60 flex-col gap-1">
                  {entry.messages.map((msg, i) => (
                    <span key={i} className="text-fine text-ink">
                      {describe(msg.kind, msg.subject, msg.raw)}
                    </span>
                  ))}
                </span>
              }
            >
              <span
                data-id={`interview-map-warnings-${entry.code}`}
                aria-label={t("framework.report.mapWarnings", { count: entry.messages.length })}
                className={`inline-flex cursor-help items-center gap-0.5 ${hasError ? "text-error" : "text-changed"}`}
              >
                <AlertTriangle size={12} strokeWidth={1.5} />
                {entry.messages.length}
              </span>
            </Tooltip>
          )}
          <KeyIcon
            entries={[
              [t("framework.importIdTask"), entry.code],
              [t("framework.importIdUnit"), entry.unitId],
              [t("framework.importIdDept"), entry.department],
              [t("framework.importIdRole"), entry.ownerRole],
            ]}
            dataId={`interview-map-key-${entry.code}`}
          />
        </span>
      </div>
      {previewing && (
        <div className="px-2.5 pb-2" data-stop>
          <ImportMapPreview row={row} dataId={`interview-map-preview-${entry.code}`} onClose={onTogglePreview} />
        </div>
      )}
    </li>
  );
}

interface ImportFileCardProps {
  index: number;
  file: InterviewFileReport;
  indexed: IndexedFile | undefined; // 업로드 JSON 색인(계보·L5 이름) — 파일명이 맞을 때만
  group: ReportGroup | undefined; // 리포트 뷰모델의 파일 그룹(캔버스·맵) — 파일명이 맞을 때만
  extCounts: ExternalCanvasCounts | undefined;
  focus: ReportFocus | null;
  hover: RelatedTags | null;
  expanded: boolean; // "모두 보기" 상태
  previewCode: string | null;
  browseBusy: boolean;
  rowOf: (code: string) => unknown;
  describe: Describe;
  onFocusFile: () => void;
  onFocusMap: (code: string) => void;
  onToggleExpanded: () => void;
  onTogglePreview: (code: string) => void;
  onBrowse: () => void;
}

export function ImportFileCard({
  index,
  file,
  indexed,
  group,
  extCounts,
  focus,
  hover,
  expanded,
  previewCode,
  browseBusy,
  rowOf,
  describe,
  onFocusFile,
  onFocusMap,
  onToggleExpanded,
  onTogglePreview,
  onBrowse,
}: ImportFileCardProps) {
  const { t } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);
  const maps = group?.maps ?? [];
  const capped = maps.length > VISIBLE_ROWS && !expanded;

  // 4행 높이로 자른다 — 행 높이는 미리보기 열림에 따라 달라지므로 실측(레이아웃 이펙트, DOM 직접 지정)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (!capped) {
      list.style.maxHeight = "";
      return;
    }
    const rows = Array.from(list.children).slice(0, VISIBLE_ROWS);
    const height = rows.reduce((sum, el) => sum + (el instanceof HTMLElement ? el.offsetHeight : 0), 0);
    list.style.maxHeight = `${height}px`;
  }, [capped, previewCode, maps.length]);

  const fileFocused = focus?.kind === "file" && focus.fileIndex === index;
  const filePeer = hover?.files.includes(index) ?? false;
  const title = indexed?.l5Name || group?.canvas?.name || file.name;
  const crumbs = indexed ? indexed.chain.slice(0, -1) : [];
  const canvas = group?.canvas ?? null;
  const canvasMessages = canvas?.messages.filter((m) => !m.kind.startsWith("external-")) ?? [];
  const review = (extCounts?.ambiguous ?? 0) + (extCounts?.unknownOrigin ?? 0);
  const extTotal = (extCounts?.linked ?? 0) + (extCounts?.placeholder ?? 0) + review;
  const extParts = [
    (extCounts?.linked ?? 0) > 0 ? t("framework.importExternalCountLinked", { count: extCounts?.linked ?? 0 }) : "",
    (extCounts?.placeholder ?? 0) > 0
      ? t("framework.importExternalCountPlaceholder", { count: extCounts?.placeholder ?? 0 })
      : "",
    review > 0 ? t("framework.report.pillReview", { count: review }) : "",
  ].filter(Boolean);
  const headTone = fileFocused ? FOCUS_ROW_CLASS : filePeer ? ROW_PEER_CLASS : "hover:bg-surface-alt/70";

  return (
    <li data-id={`interview-file-card-${index}`} className="overflow-hidden rounded-md border border-hairline bg-surface">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={fileFocused}
        data-id={`interview-file-toggle-${index}`}
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-2.5 py-2 transition-colors duration-150 ${headTone}`}
        onClick={(event) => {
          if (!isControlTarget(event)) onFocusFile();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !isControlTarget(event)) {
            event.preventDefault();
            onFocusFile();
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Tooltip label={file.ok ? t("framework.report.lv5Ok") : t("framework.report.lv5Error")}>
            <span
              data-id={`interview-file-lv5-${index}`}
              data-state={file.ok ? "ok" : "error"}
              className={`${PILL_BASE} font-semibold tracking-wide ${
                file.ok ? "border-added/40 bg-added/10 text-added" : "border-error/40 bg-error/10 text-error"
              }`}
            >
              {t("framework.report.lv5")}
            </span>
          </Tooltip>
          <span className="truncate text-caption-strong text-ink">{title}</span>
        </div>
        <div className="row-span-2 flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-1">
            {(extCounts?.linked ?? 0) > 0 && (
              <span className={`${PILL_BASE} ${EXTERNAL_STATE_TONE.linked}`}>
                {t("framework.importExternalCountLinked", { count: extCounts?.linked ?? 0 })}
              </span>
            )}
            {(extCounts?.placeholder ?? 0) > 0 && (
              <span className={`${PILL_BASE} ${EXTERNAL_STATE_TONE.placeholder}`}>
                {t("framework.importExternalCountPlaceholder", { count: extCounts?.placeholder ?? 0 })}
              </span>
            )}
            {review > 0 && (
              <span className={`${PILL_BASE} ${EXTERNAL_STATE_TONE.ambiguous}`}>
                {t("framework.report.pillReview", { count: review })}
              </span>
            )}
          </div>
          <span className="max-w-56 truncate font-mono text-fine text-ink-tertiary" title={file.name}>
            {file.name}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-0.5">
          {crumbs.map((step, i) => (
            <Fragment key={step.code}>
              {i > 0 && <ChevronRight size={10} strokeWidth={1.5} className="shrink-0 text-ink-muted" />}
              <span
                className="rounded-sm border border-hairline bg-surface-alt px-1.5 text-fine leading-4 text-ink-secondary"
                title={step.code}
              >
                {step.name}
              </span>
            </Fragment>
          ))}
          <Tooltip label={t("framework.report.browseFramework")}>
            <button
              type="button"
              data-id={`interview-file-browse-${index}`}
              aria-label={t("framework.report.browseFramework")}
              disabled={browseBusy}
              className="ml-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm border border-hairline bg-surface text-accent hover:border-accent/40 hover:bg-accent-tint disabled:opacity-40"
              onClick={(event) => {
                event.stopPropagation();
                onBrowse();
              }}
            >
              <FolderTree size={12} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
        <span className="col-span-2 text-fine text-ink-tertiary">
          {t("framework.report.fileCounts", { maps: file.map_count, notes: file.note_count })}
        </span>
      </div>

      {file.issues.length > 0 && (
        <div className="scroll-soft max-h-40 overflow-y-auto border-t border-divider">
          <table className="w-full text-fine">
            <thead className="sticky top-0 z-[1]">
              <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                <th className="px-2 py-1">{t("framework.interviewIssueColSeverity")}</th>
                <th className="px-2 py-1">{t("framework.interviewIssueColPath")}</th>
                <th className="px-2 py-1">{t("framework.interviewIssueColMessage")}</th>
              </tr>
            </thead>
            <tbody>
              {file.issues.map((issue, j) => (
                <tr
                  key={j}
                  className={`border-b border-divider last:border-0 ${
                    issue.severity === "error" ? "bg-error/10" : "bg-changed/10"
                  }`}
                >
                  <td className={`px-2 py-1 ${issue.severity === "error" ? "text-error" : "text-changed"}`}>
                    {issue.severity}
                  </td>
                  <td className="px-2 py-1 font-mono text-ink-secondary">{issue.path}</td>
                  <td className="px-2 py-1 text-ink-tertiary">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canvas && (
        <div
          data-id={`interview-file-canvas-${index}`}
          className="flex items-center gap-2 border-t border-divider bg-surface-pearl px-2.5 py-1 text-fine"
        >
          <Workflow size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <span className="min-w-0 truncate text-ink-secondary">
            {t("framework.importCanvas")}
            {canvasMessages.map((msg, j) => (
              <span key={j} className={msg.severity === "info" ? "" : "text-changed"}>
                {" · "}
                {describe(msg.kind, msg.subject, msg.raw)}
                {msg.kind === "canvas" && (msg.numbers[1] ?? 0) > 0
                  ? ` · ${t("framework.importNodesEdges", { count: msg.numbers[1] })}`
                  : ""}
              </span>
            ))}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {extTotal > 0 && (
              <span
                data-id={`interview-canvas-external-${index}`}
                className={extTotal - (extCounts?.linked ?? 0) > 0 ? "text-error" : "text-ink-tertiary"}
              >
                {t("framework.importExternalColTask")} · {extParts.join(" · ")}
              </span>
            )}
            <KeyIcon
              entries={[
                [t("framework.importIdCategory"), canvas.code],
                [t("framework.importIdPath"), canvas.path],
              ]}
              dataId={`interview-canvas-key-${index}`}
            />
          </span>
        </div>
      )}

      {maps.length > 0 ? (
        <>
          <ul
            ref={listRef}
            data-id={`interview-file-maps-${index}`}
            data-capped={capped ? "true" : undefined}
            className={`border-t border-divider transition-[max-height] duration-350 ease-smooth ${
              capped ? "scrollbar-hidden overflow-y-auto" : ""
            }`}
          >
            {maps.map((entry) => (
              <ImportMapRow
                key={entry.code}
                entry={entry}
                focused={focus?.kind === "map" && focus.code === entry.code}
                fileFocused={fileFocused}
                peer={filePeer || (hover?.maps.includes(entry.code) ?? false)}
                previewing={previewCode === entry.code}
                row={rowOf(entry.code)}
                describe={describe}
                onFocus={() => onFocusMap(entry.code)}
                onTogglePreview={() => onTogglePreview(entry.code)}
              />
            ))}
          </ul>
          {maps.length > VISIBLE_ROWS && (
            <button
              type="button"
              data-id={`interview-file-more-${index}`}
              aria-expanded={expanded}
              className="flex w-full items-center justify-center gap-1.5 border-t border-divider bg-surface-alt px-2 py-1 text-fine text-accent hover:bg-accent-tint"
              onClick={onToggleExpanded}
            >
              {expanded ? (
                <>
                  {t("framework.report.showFirst", { count: VISIBLE_ROWS })}
                  <span className="text-ink-tertiary">{t("framework.report.showFirstOf", { count: maps.length })}</span>
                </>
              ) : (
                <>
                  {t("framework.report.showAll", { count: maps.length })}
                  <span className="text-ink-tertiary">
                    {t("framework.report.showAllMore", { count: maps.length - VISIBLE_ROWS })}
                  </span>
                </>
              )}
            </button>
          )}
        </>
      ) : (
        <p className="border-t border-divider px-2.5 py-1.5 text-fine text-ink-tertiary">
          {file.issues.length > 0 ? t("framework.importNoMaps") : t("framework.interviewNoIssues")}
        </p>
      )}
    </li>
  );
}
