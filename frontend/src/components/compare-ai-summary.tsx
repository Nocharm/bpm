// 비교 화면 AI 보고서 탭 본문 — 결재자에게 올리는 개조식 메모 4블록(개정 요지·흐름 영향·코멘트 대비 미언급·확인 질문, 근거 칩=캔버스 포커스). compare/page.tsx 인스펙터 전용 (2026-09-21).
"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  GitBranch,
  HelpCircle,
  Loader2,
  type LucideIcon,
  Minus,
  Plus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import type { CompareSummaryOut, CompareSummaryPoint, CompareSummaryPointKind } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

// kind → 아이콘·틴트 칩. 신설/삭제/변경은 비교 캔버스 상태색 토큰과 동일(틴트 배경 + 진한 획), 수치·흐름은 액센트,
// 통제는 주의색, 위험은 삭제색. 배경 틴트로 항목 종류가 한눈에 구분되게 (사용자 요청 2026-09-21).
const KIND_VISUAL: Record<CompareSummaryPointKind, { icon: LucideIcon | null; className: string; label: MessageKey }> = {
  added: { icon: Plus, className: "bg-added/15 text-added", label: "compare.aiKind.added" },
  removed: { icon: Minus, className: "bg-removed/15 text-removed", label: "compare.aiKind.removed" },
  changed: { icon: ArrowRightLeft, className: "bg-diff-changed/20 text-diff-changed", label: "compare.aiKind.changed" },
  increase: { icon: ArrowUp, className: "bg-accent-tint text-accent", label: "compare.aiKind.increase" },
  decrease: { icon: ArrowDown, className: "bg-accent-tint text-accent", label: "compare.aiKind.decrease" },
  flow: { icon: GitBranch, className: "bg-accent-tint text-accent", label: "compare.aiKind.flow" },
  control: { icon: ShieldAlert, className: "bg-changed/20 text-changed", label: "compare.aiKind.control" },
  risk: { icon: AlertTriangle, className: "bg-removed/15 text-removed", label: "compare.aiKind.risk" },
  note: { icon: null, className: "bg-surface-alt text-ink-tertiary", label: "compare.aiKind.note" },
};

function KindIcon({ kind }: { kind: CompareSummaryPointKind }) {
  const { t } = useI18n();
  const visual = KIND_VISUAL[kind] ?? KIND_VISUAL.note;
  const Icon = visual.icon;
  return (
    <span
      className={`mt-px inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm text-fine font-semibold ${visual.className}`}
      title={t(visual.label)}
      data-kind={kind}
    >
      {Icon ? <Icon size={12} strokeWidth={2.25} /> : "-"}
    </span>
  );
}

export type CompareAiRunStatus = "loading" | "done" | "error";

export interface CompareAiRun {
  status: CompareAiRunStatus;
  result?: CompareSummaryOut;
  error?: string;
}

// 메모 헤더 메타 — 서버 응답이 아니라 비교 화면이 이미 아는 값
export interface CompareAiMeta {
  mapName: string;
  baseLabel: string;
  targetLabel: string;
}

interface CompareAiSummaryProps {
  run: CompareAiRun | undefined;
  aiEnabled: boolean | null; // null=아직 /me 미도착
  noChanges: boolean; // diff 자체가 비어 AI 호출을 생략한 경우
  meta: CompareAiMeta;
  // ref(n1/e1…)→사람이 읽는 라벨(활동 제목·흐름 양끝). 모르는 ref면 null → 칩 생략
  resolveRef: (ref: string) => string | null;
  onFocusRef: (ref: string) => void;
  onRetry: () => void;
  onRegenerate: () => void;
}

// 근거 칩 줄 — refs를 라벨로 풀어 캔버스 포커스 버튼으로. 라벨을 못 찾는 ref는 생략.
function RefChips({
  refs,
  idPrefix,
  resolveRef,
  onFocusRef,
  label,
}: {
  refs: string[];
  idPrefix: string;
  resolveRef: (ref: string) => string | null;
  onFocusRef: (ref: string) => void;
  label: string;
}) {
  const chips = refs
    .map((ref) => ({ ref, label: resolveRef(ref) }))
    .filter((c): c is { ref: string; label: string } => c.label !== null);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <span className="text-fine text-ink-tertiary">{label}</span>
      {chips.map((chip, j) => (
        <button
          key={chip.ref}
          type="button"
          data-id={`${idPrefix}-${j}`}
          title={chip.label}
          onClick={() => onFocusRef(chip.ref)}
          className="max-w-[12rem] truncate rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:border-accent hover:text-accent"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// 종류 아이콘이 붙는 항목 목록(요지 절·영향·미언급) — refs가 있는 항목은 아래 칩 줄
function PointList({
  points,
  idPrefix,
  resolveRef,
  onFocusRef,
  relatedLabel,
}: {
  points: CompareSummaryPoint[];
  idPrefix: string;
  resolveRef: (ref: string) => string | null;
  onFocusRef: (ref: string) => void;
  relatedLabel: string;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {points.map((item, i) => (
        <li key={i} data-id={`${idPrefix}-${i}`} className="flex flex-col gap-0.5">
          <span className="flex items-start gap-1.5 break-keep text-caption text-ink">
            <KindIcon kind={item.kind} />
            <span>{item.point}</span>
          </span>
          {item.refs.length > 0 && (
            <div className="pl-5">
              <RefChips refs={item.refs} idPrefix={`${idPrefix}-${i}-ref`} resolveRef={resolveRef} onFocusRef={onFocusRef} label={relatedLabel} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CompareAiSummary({
  run,
  aiEnabled,
  noChanges,
  meta,
  resolveRef,
  onFocusRef,
  onRetry,
  onRegenerate,
}: CompareAiSummaryProps) {
  const { t } = useI18n();

  if (aiEnabled === false) {
    return (
      <div data-id="compare-ai-disabled" className="p-3 text-caption text-ink-tertiary">
        {t("compare.aiDisabled")}
      </div>
    );
  }
  if (noChanges) {
    return (
      <div data-id="compare-ai-no-changes" className="p-3 text-caption text-ink-tertiary">
        {t("compare.aiNoChanges")}
      </div>
    );
  }
  if (!run || run.status === "loading" || aiEnabled === null) {
    return (
      <div data-id="compare-ai-loading" className="flex items-center gap-2 p-3 text-caption text-ink-secondary">
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />
        {t("compare.aiGenerating")}
      </div>
    );
  }
  if (run.status === "error" || !run.result) {
    return (
      <div data-id="compare-ai-error" className="flex flex-col gap-2 p-3 text-caption">
        <div className="flex items-center gap-1.5 text-error">
          <AlertTriangle size={14} strokeWidth={1.5} />
          {t("compare.aiFailed")}
        </div>
        {run.error && <div className="text-fine text-ink-tertiary">{run.error}</div>}
        <button
          type="button"
          data-id="compare-ai-retry"
          onClick={onRetry}
          className="inline-flex w-fit items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          {t("compare.aiRetry")}
        </button>
      </div>
    );
  }

  const {
    title,
    opening,
    sections,
    impacts,
    unmentioned,
    questions,
    closing,
    stats,
    has_submit_note: hasSubmitNote,
    generated_at: generatedAt,
    cached,
  } = run.result;
  const related = t("compare.aiRelated");
  return (
    <div data-id="compare-ai" className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      <article data-id="compare-ai-report" className="flex flex-col gap-3">
        {/* 문서 헤더 — 제목 + 메타(맵·비교 대상·생성 시각). 재생성은 제목 줄 우측 */}
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-2.5">
          <div className="flex items-start justify-between gap-2">
            <h3 data-id="compare-ai-title" className="break-keep text-body-strong leading-snug text-ink">
              {title}
            </h3>
            <button
              type="button"
              data-id="compare-ai-regenerate"
              title={t("compare.aiRegenerate")}
              aria-label={t("compare.aiRegenerate")}
              onClick={onRegenerate}
              className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
            >
              <RefreshCw size={12} strokeWidth={1.5} />
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fine text-ink-secondary" data-id="compare-ai-meta">
            <dt className="text-ink-tertiary">{t("compare.aiMetaMap")}</dt>
            <dd className="truncate">{meta.mapName}</dd>
            <dt className="text-ink-tertiary">{t("compare.aiMetaVersions")}</dt>
            <dd className="truncate">
              {meta.baseLabel} → {meta.targetLabel}
            </dd>
            <dt className="text-ink-tertiary">{t("compare.aiMetaGenerated")}</dt>
            <dd>
              {formatKstShort(generatedAt)}
              {cached && <span className="ml-1 text-ink-tertiary">· {t("compare.aiCachedNote")}</span>}
            </dd>
          </dl>
        </header>

        {opening && (
          <p data-id="compare-ai-opening" className="break-keep text-caption text-ink">
            {opening}
          </p>
        )}

        {/* 1. 개정 요지 — 변경 종류가 아니라 의도별 절 */}
        {sections.length > 0 && (
          <section data-id="compare-ai-purpose" className="flex flex-col gap-2">
            <h4 className="text-caption-strong text-ink">{t("compare.aiPurpose")}</h4>
            {sections.map((section, i) => (
              <div key={i} data-id={`compare-ai-section-${i}`} className="flex flex-col gap-1 pl-1">
                <div className="break-keep text-caption-strong text-ink-secondary">
                  {i + 1}. {section.heading}
                </div>
                <div className="pl-1">
                  <PointList
                    points={section.points}
                    idPrefix={`compare-ai-section-${i}-point`}
                    resolveRef={resolveRef}
                    onFocusRef={onFocusRef}
                    relatedLabel={related}
                  />
                </div>
                <div className="pl-1">
                  <RefChips refs={section.refs} idPrefix={`compare-ai-ref-${i}`} resolveRef={resolveRef} onFocusRef={onFocusRef} label={related} />
                </div>
              </div>
            ))}
          </section>
        )}

        {/* 2. 흐름·통제 영향 — 전체 그래프·합계·입출력 근거 */}
        {impacts.length > 0 && (
          <section data-id="compare-ai-impacts" className="flex flex-col gap-1">
            <h4 className="text-caption-strong text-ink">{t("compare.aiImpacts")}</h4>
            <PointList
              points={impacts}
              idPrefix="compare-ai-impact"
              resolveRef={resolveRef}
              onFocusRef={onFocusRef}
              relatedLabel={related}
            />
          </section>
        )}

        {/* 3. 코멘트 대비 미언급 변경 — 제출 코멘트가 없으면 대조 불가 안내 */}
        <section data-id="compare-ai-unmentioned" className="flex flex-col gap-1">
          <h4 className="text-caption-strong text-ink">{t("compare.aiUnmentioned")}</h4>
          {!hasSubmitNote ? (
            <p data-id="compare-ai-unmentioned-none" className="pl-1 text-fine text-ink-tertiary">
              {t("compare.aiUnmentionedNoNote")}
            </p>
          ) : unmentioned.length === 0 ? (
            <p data-id="compare-ai-unmentioned-empty" className="pl-1 text-fine text-ink-tertiary">
              {t("compare.aiUnmentionedEmpty")}
            </p>
          ) : (
            <PointList
              points={unmentioned}
              idPrefix="compare-ai-unmentioned-item"
              resolveRef={resolveRef}
              onFocusRef={onFocusRef}
              relatedLabel={related}
            />
          )}
        </section>

        {/* 4. 결재 전 확인 질문 — 제출자에게 되물을 것 */}
        {questions.length > 0 && (
          <section data-id="compare-ai-questions" className="flex flex-col gap-1">
            <h4 className="text-caption-strong text-ink">{t("compare.aiQuestions")}</h4>
            <ul className="flex flex-col gap-1">
              {questions.map((q, i) => (
                <li key={i} className="flex items-start gap-1.5 break-keep text-caption text-ink">
                  <HelpCircle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {closing && (
          <p data-id="compare-ai-closing" className="break-keep text-caption text-ink-secondary">
            {closing}
          </p>
        )}

        {stats && (
          <div data-id="compare-ai-stats" className="border-t border-hairline pt-2 text-fine text-ink-tertiary">
            {t("compare.aiEvidence", {
              na: stats.nodes_added,
              nr: stats.nodes_removed,
              nc: stats.nodes_changed,
              ea: stats.edges_added,
              er: stats.edges_removed,
              ec: stats.edges_changed,
            })}
          </div>
        )}
      </article>
    </div>
  );
}
