"use client";

// 확인 필요 — 반복 경고를 종류별 한 줄로 접고, 펼치면 영향받은 맵 칩(클릭=그 맵 포커스). 행 호버=우측 해당 맵 강조,
// 칩 호버=그 맵만 강조(행 강조 대체). 포커스와 관련된 행이 먼저 오도록 FLIP 재정렬. 로그인 가변부는 사용자 필.

import { AlertTriangle, ChevronRight, XCircle } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "@/lib/i18n";
import type { DigestGroup, ReportRelations } from "@/lib/interview-report";
import {
  orderByRelation,
  relationClass,
  type RelatedTags,
  type ReportFocus,
} from "@/lib/interview-report-focus";
import { useFlipOrder } from "@/lib/use-flip-order";

import { PersonPill } from "./person-pill";
import { PILL_BASE, ROW_STATE_CLASS, type Describe } from "./report-bits";
import { ReportSection } from "./report-section";

// 가변부가 로그인 id인 종류 — 문구 뒤에 사용자 필로 붙인다
const PERSON_KINDS: ReadonlySet<DigestGroup["kind"]> = new Set(["owner-not-found", "approver-not-found"]);

/** 다이제스트 행이 가리키는 맵(맵 코드)과 파일(캔버스 코드 → 파일) 태그. */
export function tagsOfDigest(group: DigestGroup, relations: ReportRelations): RelatedTags {
  const maps: string[] = [];
  const files: number[] = [];
  for (const owner of group.maps) {
    if (relations.fileOfMap.has(owner.code)) {
      maps.push(owner.code);
      continue;
    }
    const file = relations.fileOfCanvas.get(owner.code);
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return { maps, files };
}

interface AttentionSectionProps {
  digest: DigestGroup[];
  relations: ReportRelations;
  focus: ReportFocus | null;
  expanded: ReadonlySet<string>;
  describe: Describe;
  onToggleExpand: (key: string) => void;
  onHover: (tags: RelatedTags | null) => void;
  onFocusCode: (code: string) => void; // 맵 코드 또는 캔버스(L5) 코드
}

export function AttentionSection({
  digest,
  relations,
  focus,
  expanded,
  describe,
  onToggleExpand,
  onHover,
  onFocusCode,
}: AttentionSectionProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const ordered = orderByRelation(digest, (group) => tagsOfDigest(group, relations), focus);
  useFlipOrder(bodyRef, ordered.map((g) => g.key).join("|"));
  const errorCount = digest.filter((g) => g.severity === "error").length;
  const hoverOwner = (code: string): RelatedTags => {
    if (relations.fileOfMap.has(code)) return { maps: [code], files: [] };
    const file = relations.fileOfCanvas.get(code);
    return { maps: [], files: file === undefined ? [] : [file] };
  };
  const countTone =
    errorCount > 0
      ? "border-error/40 bg-error/10 text-error"
      : digest.length > 0
        ? "border-changed/40 bg-changed/10 text-changed"
        : "border-hairline bg-surface-alt text-ink-secondary";

  return (
    <ReportSection
      dataId="interview-import-digest"
      title={t("framework.importAttention")}
      Icon={AlertTriangle}
      pills={
        <span data-id="interview-digest-count" className={`${PILL_BASE} tabular-nums ${countTone}`}>
          {digest.length}
        </span>
      }
      tip={t("framework.report.attentionTip")}
      isEmpty={digest.length === 0}
      emptyText={t("framework.report.attentionEmpty")}
      bodyRef={bodyRef}
    >
      <ul className="flex flex-col">
        {ordered.map((group) => {
          const tags = tagsOfDigest(group, relations);
          const state = relationClass(tags, focus, true);
          const open = expanded.has(group.key);
          const canvasOnly = tags.maps.length === 0 && tags.files.length > 0;
          const usesPills = PERSON_KINDS.has(group.kind);
          const subjects = group.subjects;
          // 가변부(승인자 id 등)는 3개까지만 — 나머지 수는 옆 배지가 전부 보여준다
          const text = usesPills
            ? describe(group.kind, "", group.raw).replace(/:\s*$/, "")
            : describe(
                group.kind,
                subjects.slice(0, 3).join(", ") + (subjects.length > 3 ? ` +${subjects.length - 3}` : ""),
                group.raw,
              );
          return (
            <li
              key={group.key}
              data-id={`interview-digest-${group.key}`}
              data-flip-key={group.key}
              className={`border-b border-divider transition-[background-color,opacity] duration-350 ease-smooth last:border-b-0 ${
                ROW_STATE_CLASS[state]
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                data-id={`interview-digest-toggle-${group.key}`}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-surface-alt/70"
                onClick={() => onToggleExpand(group.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleExpand(group.key);
                  }
                }}
                onMouseEnter={() => onHover(tags)}
                onMouseLeave={() => onHover(null)}
              >
                <ChevronRight
                  size={12}
                  strokeWidth={1.5}
                  className={`shrink-0 text-ink-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                />
                {group.severity === "error" ? (
                  <XCircle size={14} strokeWidth={1.5} className="shrink-0 text-error" />
                ) : (
                  <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 text-changed" />
                )}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-caption text-ink">
                  <span className="truncate" title={text}>
                    {text}
                  </span>
                  {usesPills && subjects.map((login) => <PersonPill key={login} login={login} />)}
                </span>
                <span className={`${PILL_BASE} border-hairline bg-surface-alt text-ink-secondary tabular-nums`}>
                  {canvasOnly
                    ? t("framework.report.affectedCanvas", { count: group.maps.length })
                    : t("framework.importAffectedMaps", { count: group.maps.length })}
                </span>
              </div>
              {open && (
                <div className="animate-item-in flex flex-wrap gap-1 px-2.5 pb-2 pl-9">
                  {group.maps.map((m) => (
                    <button
                      key={m.code}
                      type="button"
                      data-id={`interview-digest-chip-${m.code}`}
                      title={m.code}
                      className="rounded-sm border border-hairline bg-surface px-1.5 py-px text-fine text-ink-secondary hover:border-accent hover:bg-accent-tint hover:text-accent"
                      onMouseEnter={() => onHover(hoverOwner(m.code))}
                      onMouseLeave={() => onHover(null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocusCode(m.code);
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}
