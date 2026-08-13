// 승인자별 상태 라인 빌더 — 승인/거절/회수 다이얼로그 공용. 본인은 하이라이트(accent), 승인 완료는 Check.
// 반려자(rejected_by)는 Rejected 우선 — 승인했다 거절해도 'Approved'로 남지 않게.

import { Check, User, X } from "lucide-react";

import { type ConfirmLine } from "@/components/confirm-dialog";
import { type WorkflowState } from "@/lib/api";
import { type MessageKey } from "@/lib/i18n-messages";

export function buildApproverStatusLines(
  workflow: WorkflowState | null,
  nameById: Map<string, string>,
  username: string | null,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): ConfirmLine[] {
  const rejectedBy = workflow?.rejected_by ?? null;
  return (workflow?.approvers ?? []).map((id) => {
    const rejected = id === rejectedBy;
    const approved = !rejected && (workflow?.approvals ?? []).includes(id);
    const isMe = id === username;
    const name = nameById.get(id) ?? id;
    const icon = rejected ? (
      <X size={14} strokeWidth={1.5} />
    ) : approved ? (
      <Check size={14} strokeWidth={1.5} />
    ) : (
      <User size={14} strokeWidth={1.5} />
    );
    return {
      icon,
      text: `${name}${isMe ? ` (${t("approval.you")})` : ""}`,
      tone: isMe ? "accent" : approved ? "ink" : "muted",
      highlight: isMe,
      badge: rejected
        ? { text: "Rejected", tone: "warn" as const }
        : { text: approved ? "Approved" : "Pending", tone: approved ? "approved" : "pending" },
    };
  });
}
