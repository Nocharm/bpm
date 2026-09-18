// 비교 화면 AI 요약 탭 본문 — 총평·집계 칩·주요 변경(클릭=캔버스 포커스)·확인 포인트. compare/page.tsx 인스펙터 전용 (2026-09-18).
"use client";

import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";

import type { CompareSummaryKind, CompareSummaryOut } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type CompareAiRunStatus = "loading" | "done" | "error";

export interface CompareAiRun {
  status: CompareAiRunStatus;
  result?: CompareSummaryOut;
  error?: string;
}

interface CompareAiSummaryProps {
  run: CompareAiRun | undefined;
  aiEnabled: boolean | null; // null=아직 /me 미도착
  noChanges: boolean; // diff 자체가 비어 AI 호출을 생략한 경우
  onFocusRef: (ref: string) => void;
  onRetry: () => void;
  onRegenerate: () => void;
}

// kind별 칩 톤 — 비교 캔버스 상태색(added/removed/changed)과 동일 토큰, flow/param은 액센트
const KIND_CLASS: Record<CompareSummaryKind, string> = {
  added: "bg-added/10 text-added",
  removed: "bg-removed/10 text-removed",
  changed: "bg-changed/10 text-changed",
  flow: "bg-accent-tint text-accent",
  param: "bg-accent-tint text-accent",
  other: "bg-surface-alt text-ink-secondary",
};

function StatChip({ label, added, removed, changed }: { label: string; added: number; removed: number; changed: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1 text-fine">
      <span className="text-ink-tertiary">{label}</span>
      <span className="font-semibold text-added">+{added}</span>
      <span className="font-semibold text-removed">−{removed}</span>
      <span className="font-semibold text-changed">~{changed}</span>
    </div>
  );
}

export function CompareAiSummary({ run, aiEnabled, noChanges, onFocusRef, onRetry, onRegenerate }: CompareAiSummaryProps) {
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

  const { headline, highlights, impacts, stats } = run.result;
  return (
    <div data-id="compare-ai" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      {/* 총평 — 액센트 틴트 카드. 우상단 재생성 버튼(탭 행은 폭이 없어 본문으로) */}
      <div
        data-id="compare-ai-headline"
        className="relative flex items-start gap-2 rounded-md border border-accent-tint-border bg-accent-tint/40 py-2 pl-3 pr-8 text-caption text-ink"
      >
        <Sparkles size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
        <span className="break-keep">{headline}</span>
        <button
          type="button"
          data-id="compare-ai-regenerate"
          title={t("compare.aiRegenerate")}
          aria-label={t("compare.aiRegenerate")}
          onClick={onRegenerate}
          className="absolute right-1.5 top-1.5 rounded-sm p-1 text-ink-tertiary hover:bg-surface hover:text-accent"
        >
          <RefreshCw size={12} strokeWidth={1.5} />
        </button>
      </div>
      {stats && (
        <div className="flex flex-wrap gap-1.5" data-id="compare-ai-stats">
          <StatChip label={t("compare.aiStatsNodes")} added={stats.nodes_added} removed={stats.nodes_removed} changed={stats.nodes_changed} />
          <StatChip label={t("compare.aiStatsEdges")} added={stats.edges_added} removed={stats.edges_removed} changed={stats.edges_changed} />
        </div>
      )}
      {highlights.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-fine font-semibold text-ink-secondary">{t("compare.aiHighlights")}</div>
          <ul className="flex flex-col gap-1" data-id="compare-ai-highlights">
            {highlights.map((h, i) => {
              const focusable = h.refs.length > 0;
              return (
                <li key={i}>
                  <button
                    type="button"
                    data-id={`compare-ai-highlight-${i}`}
                    disabled={!focusable}
                    onClick={() => onFocusRef(h.refs[0])}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-sm border border-hairline px-2 py-1.5 text-left ${
                      focusable ? "hover:bg-surface-alt" : "cursor-default"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`rounded-full px-1.5 text-[10px] font-semibold ${KIND_CLASS[h.kind] ?? KIND_CLASS.other}`}>
                        {t(`compare.aiKind.${h.kind}`)}
                      </span>
                      <span className="text-caption text-ink">{h.title}</span>
                    </span>
                    {h.detail && <span className="break-keep text-fine text-ink-secondary">{h.detail}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {impacts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-fine font-semibold text-ink-secondary">{t("compare.aiImpacts")}</div>
          <ul className="flex flex-col gap-1" data-id="compare-ai-impacts">
            {impacts.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5 text-caption text-ink">
                <AlertTriangle size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-changed" />
                <span className="break-keep">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
