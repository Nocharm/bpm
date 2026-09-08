"use client";

// 외부 L6 참조(인터뷰 0.5) — 헤더의 상태 필이 필터 토글(해당 없는 행은 제거 대신 흐림+무채색), 행 호버=홈 L5 파일 강조.
// 맵 포커스에서는 무관 행만 흐리고(강조 없음), L5 포커스에서는 관련 행을 강조한다 (사용자 결정 2026-09-08).
// 조치 필요(출처 없음·모호·자리표)가 먼저, 연결된 것은 뒤 — 순서는 뷰모델(externalRefs)이 정한다.

import { AlertTriangle, Link2 } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "@/lib/i18n";
import type { ExternalRefEntry, ExternalRefState, ExternalRefSummary, ReportRelations } from "@/lib/interview-report";
import {
  orderByRelation,
  relationClass,
  type RelatedTags,
  type ReportFocus,
} from "@/lib/interview-report-focus";
import { useFlipOrder } from "@/lib/use-flip-order";

import { EXTERNAL_STATE_TONE, ExternalStatePill, PILL_BASE, ROW_STATE_CLASS } from "./report-bits";
import { ReportSection } from "./report-section";

const FILTER_ORDER: ExternalRefState[] = ["linked", "placeholder", "ambiguous", "unknown-origin"];

export function tagsOfExternal(ref: ExternalRefEntry, relations: ReportRelations): RelatedTags {
  const file = relations.fileOfCanvas.get(ref.canvasCode);
  return { maps: [], files: file === undefined ? [] : [file] };
}

export function externalRefKey(ref: ExternalRefEntry): string {
  return `${ref.canvasCode}|${ref.l5Code}|${ref.title}`;
}

interface ExternalSectionProps {
  refs: ExternalRefEntry[];
  summary: ExternalRefSummary;
  relations: ReportRelations;
  focus: ReportFocus | null;
  filter: ReadonlySet<ExternalRefState>;
  onToggleFilter: (state: ExternalRefState) => void;
  onHover: (tags: RelatedTags | null) => void;
}

export function ExternalSection({
  refs,
  summary,
  relations,
  focus,
  filter,
  onToggleFilter,
  onHover,
}: ExternalSectionProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const ordered = orderByRelation(refs, (ref) => tagsOfExternal(ref, relations), focus);
  useFlipOrder(bodyRef, ordered.map(externalRefKey).join("|"));
  const counts: Record<ExternalRefState, number> = {
    linked: summary.linked,
    placeholder: summary.placeholder,
    ambiguous: summary.ambiguous,
    "unknown-origin": summary.unknownOrigin,
  };
  const stateLabel = (state: ExternalRefState): string =>
    state === "linked"
      ? t("framework.importExternalStateLinked")
      : state === "placeholder"
        ? t("framework.importExternalStatePlaceholder")
        : state === "ambiguous"
          ? t("framework.importExternalStateAmbiguousShort")
          : t("framework.importExternalStateUnknown");
  const filtering = filter.size > 0;
  const needsAction = summary.placeholder + summary.ambiguous + summary.unknownOrigin;

  return (
    <ReportSection
      dataId="interview-import-external"
      title={t("framework.importExternalTitle")}
      Icon={Link2}
      pills={
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {FILTER_ORDER.filter((state) => counts[state] > 0).map((state) => {
            const pressed = filter.has(state);
            return (
              <button
                key={state}
                type="button"
                data-id={`interview-external-filter-${state}`}
                aria-pressed={pressed}
                title={t("framework.report.externalFilterTip")}
                className={`${PILL_BASE} cursor-pointer tabular-nums transition-[opacity,box-shadow] duration-150 ${
                  EXTERNAL_STATE_TONE[state]
                } ${pressed ? "font-semibold ring-2 ring-accent/35" : filtering ? "opacity-45" : "hover:ring-2 hover:ring-accent/20"}`}
                onClick={() => onToggleFilter(state)}
              >
                {stateLabel(state)} {counts[state]}
              </button>
            );
          })}
          {summary.resolved > 0 && (
            <span
              data-id="interview-external-chip-resolved"
              className={`${PILL_BASE} border-added/40 bg-added/10 text-added tabular-nums`}
            >
              {t("framework.importExternalResolved", { count: summary.resolved })}
            </span>
          )}
        </span>
      }
      tip={t("framework.report.externalTip")}
      isEmpty={refs.length === 0}
      emptyText={t("framework.report.externalEmpty")}
      bodyRef={bodyRef}
      footer={
        needsAction > 0 ? (
          <p
            data-id="interview-external-hint"
            className="flex items-center gap-1.5 border-t border-divider px-2.5 py-1.5 text-fine text-ink-tertiary"
          >
            <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0 text-changed" />
            {t("framework.importExternalHint")}
          </p>
        ) : null
      }
    >
      <ul className="flex flex-col">
        {ordered.map((ref) => {
          const index = refs.indexOf(ref);
          const tags = tagsOfExternal(ref, relations);
          const state = relationClass(tags, focus, false);
          const off = filtering && !filter.has(ref.state);
          return (
            <li
              key={externalRefKey(ref)}
              data-flip-key={externalRefKey(ref)}
              data-id={`interview-external-row-${index}`}
              data-state={ref.state}
              data-filtered={off ? "out" : "in"}
              className={`flex items-center gap-2 border-b border-divider px-2.5 py-1.5 transition-[background-color,opacity,filter] duration-350 ease-smooth last:border-b-0 ${
                ROW_STATE_CLASS[state]
              } ${off ? "opacity-35 grayscale" : ""}`}
              onMouseEnter={() => onHover(tags)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-caption text-ink">{ref.title || "—"}</span>
                <span className="truncate text-fine text-ink-tertiary">
                  <span className="font-mono">{ref.l5Code === "unknown" ? "—" : ref.l5Code}</span>
                  {ref.canvasName ? ` · ${ref.canvasName}` : ""}
                  {ref.state === "linked" && ref.mapId !== null
                    ? ` → ${t("framework.report.linkedMap", { id: ref.mapId })}`
                    : ""}
                </span>
              </span>
              <ExternalStatePill state={ref.state} sameNameCount={ref.sameNameCount} />
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}
