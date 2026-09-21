"use client";

// 캠페인 ② L6 설문 단계 스텁 — 페이지가 참조하는 `AnswerStep` 타입만 고정, 실제 폼은 Task 11에서 채운다.

import type { FwAnswerValue, FwInterviewSession, FwInterviewTask } from "@/lib/api";

interface AnswerStepProps {
  session: FwInterviewSession;
  task: FwInterviewTask | null;
  busy: boolean;
  onSubmit: (taskPk: number, answers: Record<string, FwAnswerValue>) => void;
}

export function AnswerStep(_props: AnswerStepProps) {
  return null;
}
