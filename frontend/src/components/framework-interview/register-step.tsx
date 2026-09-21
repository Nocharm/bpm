"use client";

// 캠페인 ④ 등록 단계 스텁 — 페이지가 참조하는 `RegisterStep`/`RegisterStep.TaskPreviewModal` 타입만 고정,
// 실제 화면은 Task 12에서 채운다.

import type { FwInterviewSession } from "@/lib/api";

interface RegisterStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onApplied: () => void;
}

interface TaskPreviewModalProps {
  sessionId: number;
  taskPk: number;
  onClose: () => void;
}

export function RegisterStep(_props: RegisterStepProps) {
  return null;
}

RegisterStep.TaskPreviewModal = function TaskPreviewModal(_props: TaskPreviewModalProps) {
  return null;
};
