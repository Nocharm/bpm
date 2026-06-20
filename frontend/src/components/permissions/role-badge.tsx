"use client";

// 권한 역할 표시 뱃지 — 역할 또는 승인 대기 상태를 pill로 표현 / Role or pending-approval pill badge.

import { useI18n } from "@/lib/i18n";
import type { MapRole } from "@/lib/mock/permissions";

// 역할별 스타일 토큰 — raw hex 미사용 / Token classes only, no raw hex.
const ROLE_STYLES: Record<MapRole, string> = {
  owner: "border-accent text-accent",
  editor: "border-added text-added",
  viewer: "border-hairline text-ink-tertiary",
};

interface RoleBadgeProps {
  role: MapRole;
  /** 승인 대기 중인 변경이 있으면 true — 역할 대신 「승인 대기」 표시 / Show pending state instead of role. */
  pending?: boolean;
}

export function RoleBadge({ role, pending = false }: RoleBadgeProps) {
  const { t } = useI18n();

  if (pending) {
    return (
      <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
        {t("perm.rolePending")}
      </span>
    );
  }

  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-fine ${ROLE_STYLES[role]}`}>
      {t(
        role === "owner"
          ? "perm.roleOwner"
          : role === "editor"
            ? "perm.roleEditor"
            : "perm.roleViewer",
      )}
    </span>
  );
}
