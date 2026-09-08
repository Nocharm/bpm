"use client";

// 인터뷰 임포트 dry-run 리포트(2열, A안) — 좌: 요약·확인 필요·외부 L6·카테고리 관리자·거버넌스, 우: L5 파일 카드(맵 목록·미리보기).
// 우측 맵/L5를 고르면 좌측이 관련 항목 우선으로 재정렬(FLIP)·강조·흐림되고, 좌측 항목 호버는 우측 해당 행을 밝힌다.
// 외부 L6 상태 필은 필터(해당 없는 행은 비활성 표시). 하단 바 = 필터 상태 + 적용 요약 + Cancel/Apply (사용자 승인 목업 2026-09-08).
// 서버 상세 문구→사람말(describe)은 여기서 t로 닫아 섹션에 내려준다. 업무체계 탐색은 계보 코드를 /nodes로 따라가 id를 찾는다.

import { CircleCheck, FolderX } from "lucide-react";
import { useMemo, useState } from "react";

import { getApiErrorDetail, listCategoryNodes, type InterviewImportResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  buildReportRelations,
  countExternalByCanvas,
  sumCanvasAdditions,
  type ExternalRefState,
  type ImportReportView,
  type InterviewIndex,
  type ReportMessage,
} from "@/lib/interview-report";
import type { RelatedTags, ReportFocus } from "@/lib/interview-report-focus";
import { FrameworkBrowseModal } from "@/components/framework-browse-modal";

import { AdminsSection } from "./admins-section";
import { AttentionSection } from "./attention-section";
import { ExternalSection } from "./external-section";
import { ImportFileCard, ImportMapRow } from "./file-card";
import { GovernanceSection } from "./governance-section";
import type { Describe } from "./report-bits";
import { ReportSection } from "./report-section";
import { ImportSummaryCard } from "./summary-card";

interface InterviewImportReportProps {
  result: InterviewImportResult;
  view: ImportReportView;
  index: InterviewIndex;
  files: { name: string; content: unknown }[]; // dry-run에 보낸 파일(파싱 성공분) — 색인과 같은 순서
  governanceChecked: ReadonlySet<string>;
  onToggleGovernance: (key: string) => void;
  onToggleAllGovernance: (next: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
  onToast: (message: string) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// 상세 문구 사람말 — 백엔드 영문 원문(kind 미등록)은 그대로 통과시켜 정보를 잃지 않는다.
function useDescribe(): Describe {
  const { t } = useI18n();
  return (kind: ReportMessage["kind"], subject: string, raw: string): string => {
    switch (kind) {
      case "owner-fallback":
        return t("framework.importMsgOwnerFallback");
      case "owner-not-found":
        return `${t("framework.importMsgOwnerNotFound")}: ${subject}`;
      case "approver-not-found":
        return `${t("framework.importMsgApproverNotFound")}: ${subject}`;
      case "sp-department-empty":
        return t("framework.importMsgSpDepartment");
      case "duplicate-name":
        return `${t("framework.importMsgDuplicateName")}: ${subject}`;
      case "duplicate-code":
        return t("framework.importMsgDuplicateCode");
      case "unknown-category":
        return `${t("framework.importMsgUnknownCategory")}: ${subject}`;
      case "in-trash":
        return t("framework.importMsgInTrash");
      case "no-landing":
        return t("framework.importMsgNoLanding");
      case "linkage-skipped":
        return `${t("framework.importMsgLinkageSkipped")} - ${subject}`;
      case "canvas":
        return subject === "created"
          ? t("framework.importMsgCanvasCreated")
          : t("framework.importMsgCanvasAugmented");
      case "external-linked":
        return `${t("framework.importMsgExternalLinked")}: ${subject}`;
      case "external-placeholder":
        return `${t("framework.importMsgExternalPlaceholder")}: ${subject}`;
      case "external-ambiguous":
        return `${t("framework.importMsgExternalAmbiguous")}: ${subject}`;
      case "external-l5-unknown":
        return `${t("framework.importMsgExternalL5Unknown")}: ${subject}`;
      case "external-resolved":
        return t("framework.importMsgExternalResolved");
      case "category-admin":
        return `${t("framework.importMsgCategoryAdminAdded")}: ${subject}`;
      case "category-admin-unknown":
        return `${t("framework.importMsgCategoryAdminUnknown")}: ${subject}`;
      // 파일 이슈(어댑터) — subject는 뷰모델이 단계 이름으로 바꿔 둔다(a0N → actions 라벨)
      case "file-self-edge":
        return `${t("framework.importMsgFileSelfEdge")}: ${subject}`;
      case "file-decision-promoted":
        return `${t("framework.importMsgFilePromoted")}: ${subject}`;
      case "file-external-l5-missing":
        return `${t("framework.importMsgFileExternalL5Missing")}: ${subject}`;
      case "file-seq-fallback":
        return t("framework.importMsgFileSeqFallback");
      default:
        return raw;
    }
  };
}

const FILTER_TAG_CLASS = "rounded-full border border-accent/30 bg-surface px-2 py-px text-fine text-accent";

export function InterviewImportReport({
  result,
  view,
  index,
  files,
  governanceChecked,
  onToggleGovernance,
  onToggleAllGovernance,
  busy,
  onCancel,
  onApply,
  onToast,
}: InterviewImportReportProps) {
  const { t } = useI18n();
  const describe = useDescribe();
  const [focus, setFocus] = useState<ReportFocus | null>(null);
  const [hover, setHover] = useState<RelatedTags | null>(null);
  const [extFilter, setExtFilter] = useState<ReadonlySet<ExternalRefState>>(new Set());
  const [expandedDigest, setExpandedDigest] = useState<ReadonlySet<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<number>>(new Set());
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [browseId, setBrowseId] = useState<number | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const relations = useMemo(() => buildReportRelations(index), [index]);
  const extByCanvas = useMemo(() => countExternalByCanvas(view.externalRefs), [view.externalRefs]);
  // 미리보기용 원문 행 — taskId → rows[i]
  const rowsByCode = useMemo(() => {
    const out = new Map<string, unknown>();
    for (const file of files) {
      const rows = asRecord(file.content)?.rows;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const code = asRecord(row)?.taskId;
        if (typeof code === "string" && code.trim() && !out.has(code.trim())) out.set(code.trim(), row);
      }
    }
    return out;
  }, [files]);

  const orphanGroup = view.groups.find((g) => g.file === "") ?? null;
  const governanceReplace = result.applied
    ? result.governance.filter((d) => d.applied).length
    : governanceChecked.size;

  const focusFile = (fileIndex: number) => {
    const file = index.files[fileIndex];
    const code = file?.l5Code || file?.name || String(fileIndex);
    const name = file?.l5Name || file?.name || "";
    setFocus((prev) => (prev?.kind === "file" && prev.fileIndex === fileIndex ? null : { kind: "file", code, fileIndex, name }));
  };
  // 맵 코드 또는 캔버스(L5) 코드 — 다이제스트 칩은 둘 다 올 수 있다
  const focusCode = (code: string) => {
    const fileIndex = relations.fileOfMap.get(code);
    if (fileIndex === undefined) {
      const canvasFile = relations.fileOfCanvas.get(code);
      if (canvasFile !== undefined) focusFile(canvasFile);
      return;
    }
    const name = index.maps.get(code)?.name ?? code;
    setFocus((prev) => (prev?.kind === "map" && prev.code === code ? null : { kind: "map", code, fileIndex, name }));
  };
  const toggleExtFilter = (state: ExternalRefState) => {
    setExtFilter((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  };
  const toggleDigest = (key: string) => {
    setExpandedDigest((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleFileExpanded = (fileIndex: number) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileIndex)) next.delete(fileIndex);
      else next.add(fileIndex);
      return next;
    });
  };
  const togglePreview = (code: string) => setPreviewCode((prev) => (prev === code ? null : code));
  const clearFilters = () => {
    setFocus(null);
    setExtFilter(new Set());
  };

  // 계보 코드를 루트부터 /nodes로 따라가 L5의 id를 찾는다 — 드라이런은 롤백되므로 아직 없는 L5는 안내만
  async function handleBrowse(fileIndex: number) {
    const chain = index.files[fileIndex]?.chain ?? [];
    if (chain.length === 0) {
      onToast(t("framework.report.browseUnavailable"));
      return;
    }
    setBrowseBusy(true);
    try {
      let parentId: number | undefined;
      let found: number | null = null;
      for (const step of chain) {
        const nodes = await listCategoryNodes(parentId);
        const hit = nodes.find((n) => n.code === step.code);
        if (!hit) {
          onToast(t("framework.report.browseUnavailable"));
          return;
        }
        parentId = hit.id;
        found = hit.id;
      }
      if (found !== null) setBrowseId(found);
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setBrowseBusy(false);
    }
  }

  const stateLabel = (state: ExternalRefState): string =>
    state === "linked"
      ? t("framework.importExternalStateLinked")
      : state === "placeholder"
        ? t("framework.importExternalStatePlaceholder")
        : state === "ambiguous"
          ? t("framework.importExternalStateAmbiguousShort")
          : t("framework.importExternalStateUnknown");
  const filtering = focus !== null || extFilter.size > 0;

  return (
    <>
      <div className="rounded-md border border-hairline" data-id="interview-import-report">
        <div className="relative flex flex-col gap-3 p-3">
          {/* 적용 완료 음영 — 본문을 덮어 두 번 누르지 않게(푸터의 Cancel로 닫기) */}
          {result.applied && (
            <div
              data-id="interview-import-applied-overlay"
              className="absolute inset-0 z-[2] rounded-t-md bg-surface/70 backdrop-blur-[1px]"
            />
          )}
          <div className="grid gap-3 xl:grid-cols-[2fr_3fr]">
            <div className="flex min-w-0 flex-col gap-3" data-id="interview-report-left">
              <ImportSummaryCard
                fileCount={result.files.length}
                applied={result.applied}
                summary={result.summary}
                canvasAdditions={sumCanvasAdditions(view)}
                fileIssues={view.fileIssueCounts}
                external={view.externalSummary}
                governanceTotal={result.governance.length}
                governanceReplace={governanceReplace}
              />
              <AttentionSection
                digest={view.digest}
                relations={relations}
                focus={focus}
                expanded={expandedDigest}
                describe={describe}
                onToggleExpand={toggleDigest}
                onHover={setHover}
                onFocusCode={focusCode}
              />
              <ExternalSection
                refs={view.externalRefs}
                summary={view.externalSummary}
                relations={relations}
                focus={focus}
                filter={extFilter}
                onToggleFilter={toggleExtFilter}
                onHover={setHover}
              />
              <AdminsSection rows={view.adminChanges} index={index} relations={relations} focus={focus} onHover={setHover} />
              <GovernanceSection
                diffs={result.governance}
                checked={governanceChecked}
                onToggle={onToggleGovernance}
                onToggleAll={onToggleAllGovernance}
                applied={result.applied}
                relations={relations}
                focus={focus}
                onHover={setHover}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3" data-id="interview-report-right">
              <ul className="flex flex-col gap-3" data-id="interview-import-file-reports">
                {result.files.map((file, i) => {
                  // 파일 순서는 요청 payload 그대로 돌아온다 — 이름까지 맞을 때만 색인·그룹을 붙인다
                  const indexed = index.files[i]?.name === file.name ? index.files[i] : undefined;
                  const group = view.groups[i]?.file === file.name ? view.groups[i] : undefined;
                  return (
                    <ImportFileCard
                      key={`${file.name}-${i}`}
                      index={i}
                      file={file}
                      indexed={indexed}
                      group={group}
                      extCounts={indexed ? extByCanvas.get(indexed.l5Code) : undefined}
                      focus={focus}
                      hover={hover}
                      expanded={expandedFiles.has(i)}
                      previewCode={previewCode}
                      browseBusy={browseBusy}
                      rowOf={(code) => rowsByCode.get(code)}
                      describe={describe}
                      onFocusFile={() => focusFile(i)}
                      onFocusMap={focusCode}
                      onToggleExpanded={() => toggleFileExpanded(i)}
                      onTogglePreview={togglePreview}
                      onBrowse={() => void handleBrowse(i)}
                    />
                  );
                })}
              </ul>
              {orphanGroup && orphanGroup.maps.length > 0 && (
                <ReportSection
                  dataId="interview-import-unmatched"
                  title={t("framework.importUnmatched")}
                  Icon={FolderX}
                  tip={t("framework.report.orphanTip")}
                  bodyClassName="max-h-64"
                >
                  <ul data-id="interview-unmatched-maps">
                    {orphanGroup.maps.map((entry) => (
                      <ImportMapRow
                        key={entry.code}
                        entry={entry}
                        focused={false}
                        fileFocused={false}
                        peer={false}
                        previewing={previewCode === entry.code}
                        row={rowsByCode.get(entry.code)}
                        describe={describe}
                        onFocus={() => {}}
                        onTogglePreview={() => togglePreview(entry.code)}
                      />
                    ))}
                  </ul>
                </ReportSection>
              )}
              {result.truncated && <p className="text-fine text-ink-tertiary">{t("framework.importTruncated")}</p>}
            </div>
          </div>
        </div>
        <div
          data-id="interview-import-actions"
          // 카드 푸터(고정 아님) — 스크롤 중 본문이 바 뒤로 넘어가지 않게, 끝까지 내려서 누른다 (사용자 피드백 2026-09-03)
          className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-hairline bg-surface px-3 py-2"
        >
          {filtering && (
            <span
              data-id="interview-report-filter-bar"
              className="flex items-center gap-1.5 rounded-sm border border-accent/30 bg-accent-tint px-2 py-1 text-fine text-accent"
            >
              <span>{t("framework.report.filter")}</span>
              {focus && (
                <span data-id="interview-report-filter-focus" className={FILTER_TAG_CLASS}>
                  {focus.kind === "map" ? t("framework.report.filterMap") : t("framework.report.filterL5")} ·{" "}
                  <b className="font-semibold">{focus.name}</b>
                </span>
              )}
              {extFilter.size > 0 && (
                <span data-id="interview-report-filter-external" className={FILTER_TAG_CLASS}>
                  {t("framework.importExternalColTask")} ·{" "}
                  <b className="font-semibold">{[...extFilter].map(stateLabel).join(" + ")}</b>
                </span>
              )}
              <button
                type="button"
                data-id="interview-report-filter-clear"
                className="rounded-sm border border-accent/30 bg-surface px-2 py-px text-fine text-accent hover:bg-accent-tint"
                onClick={clearFilters}
              >
                {t("framework.report.filterClear")}
              </button>
            </span>
          )}
          {result.applied ? (
            <span
              data-id="interview-import-applied"
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-fine text-accent"
            >
              <CircleCheck size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0 truncate">{t("framework.importAppliedOverlay")}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">
              {t("framework.importApplyBar", {
                // 전달분 맵 수 — 무변경 재전달도 맵은 존재하므로 unchanged까지 합산
                maps:
                  (result.summary.created ?? 0) + (result.summary.updated ?? 0) + (result.summary.unchanged ?? 0),
                changes: governanceChecked.size,
              })}
            </span>
          )}
          <button
            type="button"
            data-id="interview-import-cancel"
            disabled={busy}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="interview-import-apply"
            disabled={busy || result.applied}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={onApply}
          >
            {t("framework.importApply")}
          </button>
        </div>
      </div>
      {browseId !== null && (
        <FrameworkBrowseModal chainCategoryId={browseId} currentMapId={null} onClose={() => setBrowseId(null)} />
      )}
    </>
  );
}
