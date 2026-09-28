"use client";

// 인터뷰 JSON 왕복 안내 그림 — 프롬프트 복사 → 외부 AI → JSON 파일 → 여기서 드라이런·등록, 아이콘 4단계. 관리 패널 인터뷰 JSON 스트립 우측 전용(2026-09-28).

import { Bot, ChevronRight, ClipboardCopy, FileJson, Upload, type LucideIcon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const STEPS: { icon: LucideIcon; key: MessageKey }[] = [
  { icon: ClipboardCopy, key: "framework.interviewFlowCopy" },
  { icon: Bot, key: "framework.interviewFlowAi" },
  { icon: FileJson, key: "framework.interviewFlowJson" },
  { icon: Upload, key: "framework.interviewFlowImport" },
];

export function InterviewFlowGuide() {
  const { t } = useI18n();
  return (
    <ol className="flex min-w-0 flex-1 items-start gap-1" data-id="interview-flow-guide" aria-label={t("framework.interviewFlowTitle")}>
      {STEPS.map((step, index) => (
        <li key={step.key} className="flex min-w-0 flex-1 items-start gap-1">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-accent-tint text-accent">
              <step.icon size={16} strokeWidth={1.5} />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold leading-none text-on-accent tabular-nums">
                {index + 1}
              </span>
            </span>
            <span className="text-fine leading-4 text-ink-secondary">{t(step.key)}</span>
          </div>
          {index < STEPS.length - 1 && (
            <span className="mt-3.5 flex shrink-0 items-center text-ink-muted" aria-hidden="true">
              <span className="h-px w-3 border-t border-dashed border-border-strong" />
              <ChevronRight size={12} strokeWidth={1.5} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
