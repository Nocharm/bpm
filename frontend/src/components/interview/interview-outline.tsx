"use client";

// facts 아웃라인 패널 — 매 턴 즉시 갱신되는 "수집된 정보"(AI 0콜, speed redesign §6).
// 맵(수락본)과 별개로 대화 진행이 눈에 보이게 한다. 좌하단 접기 카드.

import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { useState } from "react";

import { deriveOutline, deriveSequencePreview } from "@/lib/interview";

interface InterviewOutlineProps {
  facts: Record<string, Record<string, unknown>> | null | undefined;
  mode?: string;
}

export function InterviewOutline({ facts, mode }: InterviewOutlineProps) {
  const [open, setOpen] = useState(true);
  const outline = deriveOutline(facts, mode);
  const sequence = deriveSequencePreview(facts);
  if (outline.length === 0) return null;

  return (
    <div
      className="iv-pop absolute bottom-3 left-3 z-10 w-64 rounded-md border border-hairline bg-surface shadow-md"
      data-id="iv-outline"
    >
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-caption-strong text-ink"
        onClick={() => setOpen((prev) => !prev)}
        data-id="iv-outline-toggle"
      >
        <ListChecks size={16} strokeWidth={1.5} className="text-accent" />
        <span className="flex-1 text-left">Collected so far</span>
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} className="text-ink-muted" />
        ) : (
          <ChevronUp size={16} strokeWidth={1.5} className="text-ink-muted" />
        )}
      </button>
      {open ? (
        <div className="max-h-64 overflow-y-auto border-t border-hairline px-3 py-2">
          {sequence.length > 0 ? (
            <div className="mb-2 rounded-sm bg-surface-alt px-2 py-1.5 text-fine text-ink-secondary" data-id="iv-outline-seq">
              {sequence.join(" → ")}
            </div>
          ) : null}
          {outline.map((entry) => (
            <div key={entry.stage} className="py-1">
              <div className="text-fine font-semibold text-ink-tertiary">{entry.label}</div>
              <dl>
                {entry.items.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-2 py-0.5">
                    <dt className="shrink-0 text-fine text-ink-muted">{key}</dt>
                    <dd className="truncate text-fine text-ink-secondary">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
