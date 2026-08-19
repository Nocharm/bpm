"use client";

// 사용자 필 — 이름을 필로 표시(이름 우선), id는 보조. 1초 호버 또는 클릭 시 유저 카드(이름/아이디/직급/부서).
// login_id는 디렉터리로 이름 해석. 알림·승인·공지·피드백 등 사용자 표시 공용.

import { useDirectoryState } from "@/lib/directory";
import { SkeletonPill } from "@/components/skeleton";
import { UserHoverCard } from "@/components/user-hover-card";

export function UserPill({ loginId, className = "" }: { loginId: string; className?: string }) {
  const { users, ready } = useDirectoryState();
  const user = users.get(loginId);
  // 디렉터리 도착 전에는 아이디를 먼저 그리지 않는다 — 글자가 id→이름으로 갈아끼워지는 깜빡임 대신
  // 같은 자리 스켈레톤. 도착 후에도 못 찾으면(퇴사 등) 기존대로 아이디 폴백.
  if (!ready && !user) {
    return <SkeletonPill className={className} />;
  }
  return (
    <UserHoverCard user={user} loginId={loginId}>
      <span
        className={
          // 호버 어포던스 — 이 필이 카드를 여는 트리거임을 보이게(커서는 래퍼가 pointer)
          "truncate rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary transition-colors hover:bg-accent-tint hover:text-accent " +
          className
        }
      >
        {user?.name ?? loginId}
      </span>
    </UserHoverCard>
  );
}
