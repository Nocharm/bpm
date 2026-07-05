"use client";

// 사용자 필 — 이름을 필로 표시(이름 우선), id는 보조. 1초 호버 시 유저 카드(이름/아이디/직급/부서).
// login_id는 디렉터리로 이름 해석. 알림·승인·공지·피드백 등 사용자 표시 공용.

import { useDirectory } from "@/lib/directory";
import { UserHoverCard } from "@/components/user-hover-card";

export function UserPill({ loginId, className = "" }: { loginId: string; className?: string }) {
  const dir = useDirectory();
  const user = dir.get(loginId);
  return (
    <UserHoverCard user={user} loginId={loginId}>
      <span
        className={
          "truncate rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary " + className
        }
      >
        {user?.name ?? loginId}
      </span>
    </UserHoverCard>
  );
}
