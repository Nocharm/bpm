"use client";

// 요약 카드 — 리포트 좌상단 강조 섹션(액센트 틴트 그라데이션). 생성/경고/노트/연계/외부 L6/거버넌스 6셀로 하단 집계를 흡수한다.

import { ClipboardList } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { ExternalRefSummary } from "@/lib/interview-report";
import { InfoTip } from "@/components/info-tip";

interface ImportSummaryCardProps {
  fileCount: number;
  applied: boolean;
  summary: Record<string, number>;
  canvasAdditions: number;
  external: ExternalRefSummary;
  governanceTotal: number;
  governanceReplace: number;
}

export function ImportSummaryCard({
  fileCount,
  applied,
  summary,
  canvasAdditions,
  external,
  governanceTotal,
  governanceReplace,
}: ImportSummaryCardProps) {
  const { t } = useI18n();
  const n = (key: string) => summary[key] ?? 0;
  const review = external.ambiguous + external.unknownOrigin;
  const cells: { key: string; label: string; value: ReactNode; sub: string; tone?: string }[] = [
    {
      key: "created",
      label: t("framework.importCreated"),
      value: n("created"),
      sub: t("framework.report.cellCreatedSub", { updated: n("updated"), unchanged: n("unchanged") }),
      tone: "text-added",
    },
    {
      key: "warnings",
      label: t("framework.importWarnings"),
      value: n("warning"),
      sub: t("framework.report.cellWarningsSub", { errors: n("error") }),
      tone: n("error") > 0 ? "text-error" : n("warning") > 0 ? "text-changed" : "",
    },
    { key: "notes", label: t("framework.interviewNotes"), value: n("notes"), sub: t("framework.report.cellNotesSub") },
    {
      key: "linkage",
      label: t("framework.interviewLinkage"),
      value: canvasAdditions,
      sub: t("framework.report.cellLinkageSub"),
    },
    {
      key: "external",
      label: t("framework.report.cellExternal"),
      value: (
        <span className="tabular-nums">
          <span className={external.linked > 0 ? "text-accent" : ""}>{external.linked}</span>
          <span className="text-ink-muted"> / </span>
          <span className={external.placeholder > 0 ? "text-error" : ""}>{external.placeholder}</span>
          <span className="text-ink-muted"> / </span>
          <span className={review > 0 ? "text-changed" : ""}>{review}</span>
        </span>
      ),
      sub: t("framework.report.cellExternalSub"),
    },
    {
      key: "governance",
      label: t("framework.report.cellGovernance"),
      value: governanceTotal,
      sub: t("framework.report.cellGovernanceSub", {
        replace: governanceReplace,
        keep: Math.max(0, governanceTotal - governanceReplace),
      }),
    },
  ];
  return (
    <section
      data-id="interview-report-summary"
      className="overflow-hidden rounded-md border border-accent/30"
      style={{ backgroundImage: "linear-gradient(135deg, var(--color-accent-tint), var(--color-surface) 70%)" }}
    >
      <header className="flex items-center gap-2 border-b border-accent/20 px-2.5 py-1.5">
        <ClipboardList size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
        <span className="shrink-0 text-caption-strong text-accent">{t("framework.report.summaryTitle")}</span>
        <span className="truncate text-fine text-ink-tertiary">
          {applied
            ? t("framework.report.summaryMetaApplied", { files: fileCount })
            : t("framework.report.summaryMetaDry", { files: fileCount })}
        </span>
        <InfoTip text={t("framework.report.summaryTip")} dataId="interview-report-summary-info" />
      </header>
      <div className="grid grid-cols-3">
        {cells.map((cell, i) => (
          <div
            key={cell.key}
            data-id={`interview-summary-${cell.key}`}
            className={`flex flex-col gap-0.5 px-2.5 py-2 ${i % 3 !== 2 ? "border-r border-accent/15" : ""} ${
              i >= 3 ? "border-t border-accent/15" : ""
            }`}
          >
            <span className="text-fine text-ink-tertiary">{cell.label}</span>
            <span className={`text-body-strong leading-tight tabular-nums ${cell.tone || "text-ink"}`}>{cell.value}</span>
            <span className="text-fine leading-tight text-ink-muted">{cell.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
