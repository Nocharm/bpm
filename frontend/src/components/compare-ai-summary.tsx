// 비교 화면 AI 보고서 탭 본문 — 결재자에게 올리는 메모 형식(제목·메타·배경·절·영향·마무리, 절의 근거 칩=캔버스 포커스). compare/page.tsx 인스펙터 전용 (2026-09-20).
"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import type { CompareSummaryOut } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

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
        <Loader2 size={14} strokeWidth={1.6} className="animate-spin text-accent" />
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

  const { title, opening, sections, impacts, closing, stats, generated_at: generatedAt, cached } = run.result;
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
          <p data-id="compare-ai-opening" className="break-keep text-caption leading-relaxed text-ink">
            {opening}
          </p>
        )}

        {sections.map((section, i) => {
          const chips = section.refs
            .map((ref) => ({ ref, label: resolveRef(ref) }))
            .filter((c): c is { ref: string; label: string } => c.label !== null);
          return (
            <section key={i} data-id={`compare-ai-section-${i}`} className="flex flex-col gap-1">
              <h4 className="break-keep text-caption-strong text-ink">
                {i + 1}. {section.heading}
              </h4>
              <p className="break-keep text-caption leading-relaxed text-ink">{section.body}</p>
              {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="text-fine text-ink-tertiary">{t("compare.aiRelated")}</span>
                  {chips.map((chip, j) => (
                    <button
                      key={chip.ref}
                      type="button"
                      data-id={`compare-ai-ref-${i}-${j}`}
                      title={chip.label}
                      onClick={() => onFocusRef(chip.ref)}
                      className="max-w-[12rem] truncate rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:border-accent hover:text-accent"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {impacts.length > 0 && (
          <section data-id="compare-ai-impacts" className="flex flex-col gap-1">
            <h4 className="text-caption-strong text-ink">{t("compare.aiImpacts")}</h4>
            <ul className="flex flex-col gap-1">
              {impacts.map((line, i) => (
                <li key={i} className="flex items-start gap-1.5 text-caption leading-relaxed text-ink">
                  <AlertTriangle size={13} strokeWidth={1.5} className="mt-1 shrink-0 text-changed" />
                  <span className="break-keep">{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {closing && (
          <p data-id="compare-ai-closing" className="break-keep text-caption leading-relaxed text-ink-secondary">
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
