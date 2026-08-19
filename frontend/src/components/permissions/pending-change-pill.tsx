"use client";

// 권한 변경 승인 대기 필 — 목표 역할만 짧게(⏳ Viewer) 보여주고 전체 내역(현재→목표·요청자)은 툴팁으로.
// 전체 문구("editor → viewer · Approval pending")를 필에 담으면 좁은 카드에서 필이 행 폭을 먹어
// 이름·부서 줄이 뭉개진다(사용자 피드백 2026-08-19). 본인이 낸 요청이면 호버 시 회수로 스왑.

import { Hourglass } from "lucide-react";

import { useI18n } from "@/lib/i18n";

import { HoverSwapPill } from "./hover-swap-pill";

// 역할 → 표시 라벨 키. 역할 문자열은 서버 원문(lowercase)이라 표시용으로 다시 매핑한다.
function getRoleLabelKey(role: string) {
  if (role === "owner") return "perm.roleOwner";
  if (role === "editor") return "perm.roleEditor";
  return "perm.roleViewer";
}

// 역할 필(w-[60px])과 같은 시각 무게를 유지하되 아이콘+라벨이 들어가도록 최소폭만 공유.
const PENDING_PILL_CLASS =
  "inline-flex min-w-[60px] items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed";

export function PendingChangePill({
  role,
  toRole,
  requesterName,
  canWithdraw,
  onWithdraw,
  dataId,
}: {
  /** 현재 역할 — 툴팁의 "from" / Current role, shown in the tooltip only. */
  role: string;
  /** 목표 역할 — null이면 제거 요청 / Target role; null means a removal request. */
  toRole: string | null;
  /** 요청자 표시명 / Display name of the requester. */
  requesterName: string;
  /** 본인이 낸 요청이면 회수 가능 / Requester can withdraw. */
  canWithdraw: boolean;
  onWithdraw: () => void;
  dataId?: string;
}) {
  const { t } = useI18n();
  const toLabel = toRole ? t(getRoleLabelKey(toRole)) : t("perm.pending.removed");
  const fromLabel = t(getRoleLabelKey(role));
  const title = `${fromLabel} → ${toLabel} · ${t("perm.pending.tag")} · ${t("perm.pending.by", { name: requesterName })}`;
  const base = (
    <span className={PENDING_PILL_CLASS}>
      <Hourglass size={12} strokeWidth={1.5} />
      {toLabel}
    </span>
  );

  if (!canWithdraw) {
    return (
      <span data-id={dataId} title={title} className="inline-flex shrink-0">
        {base}
      </span>
    );
  }
  return (
    <HoverSwapPill
      dataId={dataId}
      title={title}
      swapLabel={t("perm.pending.withdraw")}
      onActivate={onWithdraw}
      className="shrink-0"
      base={base}
    />
  );
}
