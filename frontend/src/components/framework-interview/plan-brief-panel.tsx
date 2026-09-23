"use client";

// 캠페인 ① 좌측 brief+첨부 패널 — planning 단계에 페이지 좌측 보드 자리를 쓴다(잠금 후엔 TaskBoard). PlanEditor와 짝 (spec 2026-09-23 §3 B7).
// 첨부는 brief와 분리된 목록으로 개별 삭제한다(잘못 올린 파일 누적 방지).

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";

import type { FwAttachment } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AiButton } from "@/components/ai-button";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface PlanBriefPanelProps {
  brief: string;
  onBriefChange: (value: string) => void;
  attachments: FwAttachment[];
  busy: boolean;
  onAttach: (file: File) => void;
  onRemoveAttachment: (index: number) => void;
  onGenerate: () => void;
  // 카드가 있으면 "다시 제안" 라벨
  hasCards: boolean;
}

export function PlanBriefPanel({ brief, onBriefChange, attachments, busy, onAttach, onRemoveAttachment, onGenerate, hasCards }: PlanBriefPanelProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="flex flex-col gap-3 p-3" data-id="fw-consult-brief-panel">
      <div className="flex flex-col gap-1">
        <label className="text-body-strong text-ink" htmlFor="fw-consult-brief">{t("fwConsult.brief")}</label>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.briefHint")}</span>
      </div>
      <textarea id="fw-consult-brief" data-id="fw-consult-brief" className={`${FIELD} min-h-48`} value={brief} onChange={(e) => onBriefChange(e.target.value)} placeholder={t("fwConsult.briefPlaceholder")} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-caption text-ink">{t("fwConsult.attachments")}</span>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.md" data-id="fw-consult-attach-input"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
          <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-attach" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} strokeWidth={1.5} />{t("fwConsult.attach")}
          </button>
        </div>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.attachHint")}</span>
        {attachments.length === 0 ? (
          <span className="text-fine text-ink-tertiary" data-id="fw-consult-attachments-empty">{t("fwConsult.noAttachments")}</span>
        ) : (
          <ul className="flex flex-col gap-1" data-id="fw-consult-attachments">
            {attachments.map((a, i) => (
              <li key={`${a.name}-${i}`} data-id={`fw-consult-attachment-${i}`} className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink">
                <FileText size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-fine text-ink-tertiary tabular-nums">{t("fwConsult.chars", { count: a.chars.toLocaleString() })}</span>
                <button type="button" data-id={`fw-consult-attachment-remove-${i}`} className="shrink-0 rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.removeAttachment")} disabled={busy} onClick={() => onRemoveAttachment(i)}>
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AiButton data-id="fw-consult-generate-plan" disabled={busy} onClick={onGenerate}>
        {hasCards ? t("fwConsult.regeneratePlan") : t("fwConsult.generatePlan")}
      </AiButton>
    </section>
  );
}
