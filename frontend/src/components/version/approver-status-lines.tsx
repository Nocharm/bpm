// 승인자별 상태 라인 빌더 — 승인/거절/회수 다이얼로그 공용. 본인은 하이라이트(accent), 승인 완료는 Check.
// 반려자(rejected_by)는 Rejected 우선 — 승인했다 거절해도 'Approved'로 남지 않게.

import { Check, Eye, User, X } from "lucide-react";

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

// 동봉 가시성 변경 안내 라인 — 승인 확인 모달에 승인자 상태 라인 뒤로 이어붙는다(원 신고 건: 패널에서
// 승인자에게 동봉 변경이 전혀 보이지 않던 문제). 동봉이 없으면 undefined(ApproveConfirmDialog가 그대로 무시).
export function buildBundledVisibilityLines(
  workflow: WorkflowState | null,
  nameById: Map<string, string>,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): ConfirmLine[] | undefined {
  const bundled = workflow?.bundled_visibility;
  if (!bundled) return undefined;
  const label = (v: string) => (v === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate"));
  return [
    {
      icon: <Eye size={14} strokeWidth={1.5} />,
      text: t("approval.bundledLine", {
        from: label(bundled.from_visibility),
        to: label(bundled.to_visibility),
      }),
    },
    {
      icon: <User size={14} strokeWidth={1.5} />,
      text: nameById.get(bundled.requested_by) ?? bundled.requested_by,
      tone: "muted",
    },
  ];
}
