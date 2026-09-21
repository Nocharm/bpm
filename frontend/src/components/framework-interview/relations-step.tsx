"use client";

// 캠페인 ③ L6 연결 단계 스텁 — 페이지가 참조하는 `RelationsStep` 타입만 고정, 실제 화면은 Task 12에서 채운다.

import type { FwInterviewSession } from "@/lib/api";

interface RelationsStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onPropose: () => void;
  onConfirm: (relations: Record<string, unknown>) => void;
}

export function RelationsStep(_props: RelationsStepProps) {
  return null;
}
