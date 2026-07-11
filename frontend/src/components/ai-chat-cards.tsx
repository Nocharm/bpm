"use client";

// AI 챗 메시지 부착 카드 — 분석 findings·워크스루 스텝퍼·graph/ops 요약(+라이브 미리보기 커밋) (design 2026-07-10)
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  Pause,
  Play,
  Route,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AiFinding, AiMessagePayload, AiStep } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// 분석 findings — 심각도 레일·클릭 시 노드 하이라이트. 히스토리에서도 동작(사라진 노드는 부모가 no-op).
export function AnalysisCard({
  findings,
  onHighlightNode,
}: {
  findings: AiFinding[];
  onHighlightNode: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div data-id="ai-analysis-card" className="mt-2 flex flex-col gap-2">
      <span className="flex items-center gap-1.5 px-0.5 text-caption-strong text-ink">
        <Search size={14} strokeWidth={1.6} className="text-accent" />
        {t("ai.analysisTitle")}
        <span className="rounded-full bg-surface-alt px-1.5 text-fine text-ink-tertiary">
          {findings.length}
        </span>
      </span>
      {findings.map((finding, index) => {
        const sev = finding.severity;
        // 심각도별 좌측 레일·아이콘 톤 — high=경고 빨강, medium=액센트, low=중성
        const rail =
          sev === "high" ? "border-l-error" : sev === "medium" ? "border-l-accent" : "border-l-divider";
        const iconTone =
          sev === "high"
            ? "bg-error/10 text-error"
            : sev === "medium"
              ? "bg-accent-tint text-accent"
              : "bg-surface-alt text-ink-tertiary";
        return (
          <button
            key={`finding-${index}`}
            type="button"
            className={`group flex w-full gap-2.5 rounded-[3px] border border-l-[3px] border-hairline ${rail} bg-surface p-2.5 text-left shadow-sm hover:bg-surface-alt disabled:opacity-60`}
            onClick={() => onHighlightNode(finding.node_ids[0])}
            disabled={finding.node_ids.length === 0}
          >
            <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
              {sev === "high" ? (
                <AlertTriangle size={14} strokeWidth={1.7} />
              ) : (
                <Info size={14} strokeWidth={1.7} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-caption-strong text-ink">{finding.category}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                    sev === "high" ? "bg-error/10 text-error" : "bg-surface-alt text-ink-tertiary"
                  }`}
                >
                  {finding.severity}
                </span>
              </span>
              <span className="mt-1 block text-fine leading-relaxed text-ink">{finding.message}</span>
              {finding.suggestion && (
                <span className="mt-1.5 flex items-start gap-1.5 rounded-xs bg-accent-tint px-2 py-1 text-fine text-accent">
                  <Lightbulb size={13} strokeWidth={1.6} className="mt-px shrink-0" />
                  <span>{finding.suggestion}</span>
                </span>
              )}
            </span>
            {finding.node_ids.length > 0 && (
              <ArrowUpRight
                size={14}
                strokeWidth={1.5}
                className="mt-px shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// 워크스루 스텝퍼 — live(이번 세션 응답)에서만 자동재생 허용, 히스토리는 수동 이전/다음만.
export function WalkthroughCard({
  steps,
  live,
  onHighlightNode,
}: {
  steps: AiStep[];
  live: boolean;
  onHighlightNode: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);

  // 사용자 조작으로만 하이라이트 — 마운트(창 열림·히스토리 로딩) 시 캔버스가 움직이지 않게
  const goTo = (index: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, index));
    setStepIndex(next);
    if (steps[next]) onHighlightNode(steps[next].node_id);
  };

  // 자동재생 — 2.5초 간격. 정지 판정은 타이머 콜백 안(async)에서: effect 내 동기 setState 금지 회피
  useEffect(() => {
    if (!autoplay || steps.length === 0) return;
    const timer = setTimeout(() => {
      const next = Math.min(steps.length - 1, stepIndex + 1);
      setStepIndex(next);
      if (steps[next]) onHighlightNode(steps[next].node_id);
      if (next >= steps.length - 1) setAutoplay(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [autoplay, stepIndex, steps, onHighlightNode]);

  return (
    <div
      data-id="ai-walkthrough-card"
      className="mt-2 overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-caption-strong text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
            <Route size={13} strokeWidth={1.7} />
          </span>
          {t("ai.walkthrough")}
        </span>
        <div className="flex items-center gap-0.5">
          <span className="mr-1.5 flex items-center gap-1">
            {steps.map((step, i) => (
              <span
                key={step.order}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === stepIndex
                    ? "bg-accent"
                    : i < stepIndex
                      ? "bg-accent/40"
                      : "border border-hairline bg-surface-pearl"
                }`}
              />
            ))}
          </span>
          <span className="mr-1 text-fine tabular-nums text-ink-tertiary">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            type="button"
            aria-label={t("ai.prevStep")}
            className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
            onClick={() => goTo(stepIndex - 1)}
            disabled={stepIndex === 0}
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("ai.nextStep")}
            className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
            onClick={() => goTo(stepIndex + 1)}
            disabled={stepIndex === steps.length - 1}
          >
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
          {live && (
            <button
              type="button"
              aria-label={t("ai.autoplay")}
              className={`rounded-sm p-1 hover:bg-surface-pearl ${autoplay ? "text-accent" : ""}`}
              onClick={() => setAutoplay((value) => !value)}
            >
              {autoplay ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2 px-2.5 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
          {stepIndex + 1}
        </span>
        <p className="text-caption leading-relaxed text-ink">{steps[stepIndex]?.narration}</p>
      </div>
    </div>
  );
}

const SUMMARY_ITEM_CAP = 8; // 요약 카드 항목 나열 상한 — 넘치면 "+N more"

// graph/ops 요약 — 히스토리는 읽기전용, 라이브 최신 제안은 preview로 커밋/취소 버튼 동봉.
export function ProposalSummaryCard({
  kind,
  payload,
  preview,
  footer,
}: {
  kind: "graph" | "ops";
  payload: AiMessagePayload;
  preview?: { onCommit?: () => void; onDiscard?: () => void };
  footer?: string;
}) {
  const { t } = useI18n();
  const items =
    kind === "graph"
      ? (payload.nodes ?? []).map((node) => `${node.node_type} · ${node.title}`)
      : (payload.ops ?? []).map((op) => {
          const target =
            op.node?.title ?? op.title ?? op.node_id ?? [op.source, op.target].filter(Boolean).join(" → ");
          return `${op.action} · ${target}`;
        });
  const shown = items.slice(0, SUMMARY_ITEM_CAP);
  const rest = items.length - shown.length;
  const counts =
    kind === "graph"
      ? t("ai.proposalCountsGraph", {
          nodes: (payload.nodes ?? []).length,
          edges: (payload.edges ?? []).length,
          groups: (payload.groups ?? []).length,
        })
      : t("ai.proposalCountsOps", { n: (payload.ops ?? []).length });
  return (
    <div
      data-id="ai-proposal-card"
      className="mt-2 overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-caption-strong text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
            <Sparkles size={13} strokeWidth={1.7} />
          </span>
          {t(kind === "graph" ? "ai.proposalGraphTitle" : "ai.proposalOpsTitle")}
        </span>
        <span className="text-fine tabular-nums text-ink-tertiary">{counts}</span>
      </div>
      <ul className="flex flex-col gap-0.5 px-2.5 py-2">
        {shown.map((item, index) => (
          <li key={index} className="truncate text-fine text-ink-secondary">
            {item}
          </li>
        ))}
        {rest > 0 && <li className="text-fine text-ink-tertiary">{t("ai.proposalMore", { n: rest })}</li>}
      </ul>
      {preview ? (
        <div className="border-t border-accent-tint-border bg-accent-tint p-2.5">
          <p className="text-fine leading-relaxed text-ink">{t("ai.previewHint")}</p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={preview.onCommit}
              className="flex flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
            >
              <Check size={14} strokeWidth={1.8} />
              {t("ai.previewAdd")}
            </button>
            <button
              type="button"
              onClick={preview.onDiscard}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            >
              {t("approvers.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-hairline px-2.5 py-1.5 text-fine text-ink-tertiary">
          {footer ?? t("ai.proposalReadOnly")}
        </div>
      )}
    </div>
  );
}
