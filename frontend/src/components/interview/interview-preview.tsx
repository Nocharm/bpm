"use client";

// AI 컨설턴트 우측 프리뷰 — 작업본 그래프(추가된 노드 하이라이트) + 리뷰 요약 (Task 10에서 구현 예정)

import type { InterviewState } from "@/lib/api";

interface InterviewPreviewProps {
  interview: InterviewState | null;
  onUpdated: (state: InterviewState) => void;
  mapId: number;
}

export function InterviewPreview({ interview, onUpdated, mapId }: InterviewPreviewProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" data-id="interview-preview" />
  );
}
