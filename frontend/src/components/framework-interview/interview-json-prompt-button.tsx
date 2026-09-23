"use client";

// 외부 AI 프롬프트 복사 버튼 — 관리자 Framework 패널(인터뷰 JSON 섹션)과 캠페인 페이지 헤더가 공용.
// csv-template-actions.tsx의 tri-state 복사 패턴을 따른다(평문 HTTP에서 실패 가능, 성공 가정 금지).

import { useState } from "react";

import { AlertTriangle, Check, Sparkles } from "lucide-react";

import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { buildInterviewJsonPromptText, type InterviewPromptTarget } from "@/lib/interview-json-prompt";

// outline = 기본(캠페인 헤더), tint = 파일 선택 버튼 옆에서 AI 액션임이 드러나는 액센트 틴트(관리 패널)
const TONE = {
  outline: "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt",
  tint: "border-accent/30 bg-accent-tint text-accent hover:bg-accent-tint/80",
} as const;

interface InterviewJsonPromptButtonProps {
  target?: InterviewPromptTarget;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  // 복사 성공 시 — 호출부가 토스트를 띄운다(버튼 라벨 전환은 자체 처리)
  onCopied?: () => void;
}

export function InterviewJsonPromptButton({ target, disabled, tone = "outline", onCopied }: InterviewJsonPromptButtonProps) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    const ok = await copyText(buildInterviewJsonPromptText(target));
    setCopyState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    window.setTimeout(() => setCopyState("idle"), ok ? 1200 : 1600);
  };

  return (
    <button
      type="button"
      data-id="fw-consult-copy-prompt"
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-caption disabled:opacity-50 ${TONE[tone]}`}
      onClick={() => void handleCopy()}
      disabled={disabled}
      title={t("fwConsult.copyPromptHint")}
    >
      {copyState === "copied" ? (
        <Check size={14} strokeWidth={1.5} className="text-accent" />
      ) : copyState === "failed" ? (
        <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
      ) : (
        <Sparkles size={14} strokeWidth={1.5} />
      )}
      <span className={copyState === "failed" ? "text-error" : undefined}>
        {copyState === "copied" ? t("fwConsult.promptCopied") : copyState === "failed" ? t("fwConsult.promptCopyFailed") : t("fwConsult.copyPrompt")}
      </span>
    </button>
  );
}
