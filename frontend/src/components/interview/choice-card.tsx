"use client";

// 선택지 카드 — 옵션 제목 + 요약 + SVG 미리보기(Task 10) + 선택 버튼

import type { ChoiceOption } from "@/lib/api";

interface ChoiceCardProps {
  option: ChoiceOption;
  disabled: boolean;
  onChoose: (choiceId: string) => void;
}

export function ChoiceCard({ option, disabled, onChoose }: ChoiceCardProps) {
  return (
    <div
      data-id="iv-choice-card"
      className="rounded-md border border-hairline bg-surface px-3 py-2 text-left hover:border-accent hover:bg-accent-tint disabled:opacity-50"
    >
      <div className="text-body-strong">{option.title}</div>
      <div className="text-caption text-ink-secondary">{option.summary}</div>
      <button
        data-id="iv-choice-pick"
        className="mt-2 inline-flex items-center gap-1 text-caption-strong text-accent"
        disabled={disabled}
        onClick={() => onChoose(option.id)}
      >
        Use this option
      </button>
    </div>
  );
}
