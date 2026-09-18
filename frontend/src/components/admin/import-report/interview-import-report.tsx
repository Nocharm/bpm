"use client";

// 인터뷰 임포트 dry-run 리포트(2열, A안) — 좌: 요약·확인 필요·외부 L6·카테고리 관리자·거버넌스, 우: L5 파일 카드(맵 목록·미리보기).
// 우측 맵/L5를 고르면 좌측이 관련 항목 우선으로 재정렬(FLIP)·강조·흐림되고, 좌측 항목 호버는 우측 해당 행을 밝힌다.
// 외부 L6 상태 필은 필터(해당 없는 행은 비활성 표시). 하단 바 = 필터 상태 + 적용 요약 + Cancel/Apply (사용자 승인 목업 2026-09-08).
// 서버 상세 문구→사람말(describe)은 여기서 t로 닫아 섹션에 내려준다. 업무체계 탐색은 계보 코드를 /nodes로 따라가 id를 찾는다.
// 본문은 뷰포트 높이 상한 + 좌/우 열 독립 스크롤(우측을 내려도 좌측 요약이 남는다). 우측은 스티키 툴바(건수·검색·정렬)와
// 10개씩 윈도 렌더(바닥 센티널 IntersectionObserver) — 파일 30개 워스트 케이스 대응(사용자 지시 2026-09-18).
// 적용 완료·적용 중·재드라이런 중은 본문을 덮는 반투명 레이어 가운데에 문구(SectionOverlay).

import { CircleCheck, FolderX, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { SectionOverlay } from "@/components/section-overlay";

import { AdminsSection } from "./admins-section";
import { AttentionSection } from "./attention-section";
import { ExternalSection } from "./external-section";
import { ImportFileCard, ImportMapRow } from "./file-card";
import { GovernanceSection } from "./governance-section";
import type { Describe } from "./report-bits";
import { ReportSection } from "./report-section";
import { ImportSummaryCard } from "./summary-card";

// 미리보기는 맵 행과 L5 캔버스가 previewCode 한 칸을 나눠 쓴다 — 맵 코드와 겹치지 않게 접두를 단다
function buildCanvasPreviewKey(fileIndex: number): string {
  return `canvas:${fileIndex}`;
}

// 인터뷰 임포트 진행 단계 — null=대기, dryrun=드라이런 요청 중(결과가 있으면 재실행), apply=적용 요청 중
export type InterviewPhase = "dryrun" | "apply" | null;

type FileSort = "order" | "name" | "issues" | "maps";
const FILE_SORTS: FileSort[] = ["order", "name", "issues", "maps"];
const FILE_SORT_LABEL = {
  order: "framework.report.sortOrder",
  name: "framework.report.sortName",
  issues: "framework.report.sortIssues",
  maps: "framework.report.sortMaps",
} as const;
// 우측 파일 카드 윈도 크기 — 카드가 무거워(맵 목록·미리보기) 한 번에 다 그리지 않고 바닥에 닿을 때마다 이만큼 더 붙인다
const FILE_PAGE = 10;
const SORT_PILL = "rounded-full border px-2 py-px text-fine whitespace-nowrap transition-colors duration-150";

interface InterviewImportReportProps {
  result: InterviewImportResult;
  view: ImportReportView;
  index: InterviewIndex;
  files: { name: string; content: unknown }[]; // dry-run에 보낸 파일(파싱 성공분) — 색인과 같은 순서
  governanceChecked: ReadonlySet<string>;
  onToggleGovernance: (key: string) => void;
  onToggleAllGovernance: (next: boolean) => void;
  phase: InterviewPhase;
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
      // 시스템 카탈로그 정규화(2026-09-12) — 두 번째 가변부(정식 표기)는 원문에서 다시 뽑는다
      case "system-normalized": {
        const canonical = /normalized to ['"](.*)['"]$/.exec(raw)?.[1] ?? "";
        return `${t("framework.importMsgSystemNormalized")}: ${subject} → ${canonical}`;
      }
      case "system-other":
        return `${t("framework.importMsgSystemOther")}: ${subject}`;
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
  phase,
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
  const [fileSort, setFileSort] = useState<FileSort>("order");
  const [fileQuery, setFileQuery] = useState("");
  const [fileLimit, setFileLimit] = useState(FILE_PAGE);
  const rightRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const busy = phase !== null;

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

  // 우측 파일 카드 목록 — 파일 순서는 요청 payload 그대로 돌아오므로 이름까지 맞을 때만 색인·그룹을 붙인다.
  // 정렬·검색은 이 항목 위에서 돌고, 렌더는 fileLimit까지만(윈도).
  const fileEntries = useMemo(
    () =>
      result.files.map((file, i) => {
        const indexed = index.files[i]?.name === file.name ? index.files[i] : undefined;
        const group = view.groups[i]?.file === file.name ? view.groups[i] : undefined;
        const title = indexed?.l5Name || group?.canvas?.name || file.name;
        const issues =
          file.issues.length +
          (group?.canvas?.messages.length ?? 0) +
          (group?.maps.reduce((n, m) => n + m.messages.length, 0) ?? 0);
        return { i, file, indexed, group, title, issues };
      }),
    [result.files, index.files, view.groups],
  );
  const orderedFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    const list = q
      ? fileEntries.filter((e) => e.title.toLowerCase().includes(q) || e.file.name.toLowerCase().includes(q))
      : fileEntries.slice();
    if (fileSort === "name") list.sort((a, b) => a.title.localeCompare(b.title) || a.i - b.i);
    else if (fileSort === "issues") list.sort((a, b) => b.issues - a.issues || a.i - b.i);
    else if (fileSort === "maps") list.sort((a, b) => b.file.map_count - a.file.map_count || a.i - b.i);
    return list;
  }, [fileEntries, fileQuery, fileSort]);
  const visibleFiles = orderedFiles.slice(0, fileLimit);
  const hasMoreFiles = fileLimit < orderedFiles.length;

  // 바닥 센티널이 보이면 한 페이지 더 — limit마다 관찰을 다시 걸어야 짧은 카드로 센티널이 계속 보일 때도 이어서 붙는다
  useEffect(() => {
    const root = rightRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMoreFiles) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setFileLimit((n) => n + FILE_PAGE);
      },
      { root, rootMargin: "160px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMoreFiles, fileLimit]);

  // 좌측에서 고른 파일이 윈도 밖(또는 검색에 걸러진 상태)이면 보이게 만든 뒤 카드로 스크롤
  const revealFile = (fileIndex: number) => {
    const pos = orderedFiles.findIndex((e) => e.i === fileIndex);
    if (pos === -1) {
      setFileQuery("");
      setFileLimit(fileEntries.length);
    } else if (pos >= fileLimit) {
      setFileLimit(pos + 1);
    }
  };
  useEffect(() => {
    if (!focus) return;
    rightRef.current
      ?.querySelector(`[data-id="interview-file-card-${focus.fileIndex}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus, fileLimit]);

  const focusFile = (fileIndex: number) => {
    const file = index.files[fileIndex];
    const code = file?.l5Code || file?.name || String(fileIndex);
    const name = file?.l5Name || file?.name || "";
    revealFile(fileIndex);
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
    revealFile(fileIndex);
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
        {/* 본문 — 뷰포트 높이 상한(카드 헤더·페이지 여백 제외), 좌/우 열이 각자 스크롤. 레이어는 본문만 덮는다(푸터 Cancel은 살아 있음) */}
        <div className="relative flex max-h-[calc(100vh-11rem)] flex-col rounded-t-md p-3">
          {result.applied ? (
            <SectionOverlay
              dataId="interview-import-applied-overlay"
              icon={<CircleCheck size={18} strokeWidth={1.5} />}
              title={t("framework.importAppliedTitle")}
            >
              <span data-id="interview-import-applied" className="text-fine text-ink-tertiary break-keep text-balance">
                {t("framework.importAppliedOverlay")}
              </span>
            </SectionOverlay>
          ) : phase === "apply" ? (
            <SectionOverlay
              dataId="interview-import-applying-overlay"
              icon={<Loader2 size={18} strokeWidth={1.5} className="animate-spin" />}
              title={t("framework.importApplying")}
            />
          ) : phase === "dryrun" ? (
            <SectionOverlay
              dataId="interview-import-rerun-overlay"
              icon={<Loader2 size={18} strokeWidth={1.5} className="animate-spin" />}
              title={t("framework.importDryRunPending", { count: files.length })}
            />
          ) : null}
          <div className="grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-3 xl:grid-cols-[2fr_3fr]">
            {/* 열 안의 카드는 shrink-0 — 높이 상한에 걸리면 flex 자식이 눌려 요약 카드가 잘린다(실측 2026-09-18) */}
            <div className="scroll-soft flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0" data-id="interview-report-left">
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
            <div
              ref={rightRef}
              className="scroll-soft flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0"
              data-id="interview-report-right"
            >
              {/* 스티키 툴바 — 건수·검색·정렬 필. 검색/정렬이 바뀌면 윈도를 처음부터 다시 연다 */}
              <div
                data-id="interview-report-toolbar"
                className="sticky top-0 z-[3] flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 shadow-sm"
              >
                <span data-id="interview-report-file-total" className="shrink-0 text-fine text-ink-tertiary">
                  {t("framework.report.fileTotal", { count: result.files.length })}
                </span>
                <input
                  type="search"
                  data-id="interview-report-search"
                  value={fileQuery}
                  placeholder={t("framework.report.fileSearch")}
                  onChange={(e) => {
                    setFileQuery(e.target.value);
                    setFileLimit(FILE_PAGE);
                  }}
                  className="h-6 min-w-32 flex-1 rounded-sm border border-hairline bg-surface px-2 text-fine text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                />
                <span className="shrink-0 text-fine text-ink-tertiary">{t("framework.report.sortLabel")}</span>
                <span className="flex flex-wrap gap-1">
                  {FILE_SORTS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      data-id={`interview-report-sort-${key}`}
                      aria-pressed={fileSort === key}
                      className={`${SORT_PILL} ${
                        fileSort === key
                          ? "border-accent/40 bg-accent-tint text-accent"
                          : "border-hairline text-ink-secondary hover:bg-surface-alt"
                      }`}
                      onClick={() => {
                        setFileSort(key);
                        setFileLimit(FILE_PAGE);
                      }}
                    >
                      {t(FILE_SORT_LABEL[key])}
                    </button>
                  ))}
                </span>
              </div>
              <ul className="flex flex-col gap-3" data-id="interview-import-file-reports">
                {visibleFiles.map(({ i, file, indexed, group }) => (
                  <ImportFileCard
                    key={`${file.name}-${i}`}
                    index={i}
                    file={file}
                    indexed={indexed}
                    group={group}
                    extCounts={indexed ? extByCanvas.get(indexed.l5Code) : undefined}
                    content={files[i]?.name === file.name ? files[i].content : undefined}
                    focus={focus}
                    hover={hover}
                    expanded={expandedFiles.has(i)}
                    previewCode={previewCode}
                    canvasPreviewing={previewCode === buildCanvasPreviewKey(i)}
                    browseBusy={browseBusy}
                    rowOf={(code) => rowsByCode.get(code)}
                    describe={describe}
                    onFocusFile={() => focusFile(i)}
                    onFocusMap={focusCode}
                    onToggleExpanded={() => toggleFileExpanded(i)}
                    onTogglePreview={togglePreview}
                    onToggleCanvasPreview={() => togglePreview(buildCanvasPreviewKey(i))}
                    onBrowse={() => void handleBrowse(i)}
                  />
                ))}
              </ul>
              {orderedFiles.length === 0 && (
                <p data-id="interview-report-search-none" className="py-2 text-center text-fine text-ink-tertiary">
                  {t("framework.report.fileSearchNone")}
                </p>
              )}
              {hasMoreFiles && (
                <div
                  ref={sentinelRef}
                  data-id="interview-report-more"
                  className="flex items-center justify-center gap-1.5 py-2 text-fine text-ink-tertiary"
                >
                  <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
                  {t("framework.report.filesShown", { shown: visibleFiles.length, total: orderedFiles.length })}
                </div>
              )}
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
          {/* 적용 완료 문구는 본문 레이어 가운데로 옮겼다(2026-09-18) — 푸터는 버튼만 */}
          {!result.applied && (
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
            className="ml-auto rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
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
