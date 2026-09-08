"use client";

// 임포트 리포트의 사용자 필 — 이름은 UI 언어 → 영어 → 아이디 순으로 폴백(사용자 결정 2026-09-08), 디렉터리에 없는
// 로그인은 아이디(모노)로만. 호버 시 공용 유저 카드(UserHoverCard). 확인 필요·관리자·거버넌스 섹션 공용.

import type { DirectoryUser } from "@/lib/api";
import { useDirectoryState } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { SkeletonPill } from "@/components/skeleton";
import { UserHoverCard } from "@/components/user-hover-card";

/** 표시 이름 — ko UI는 한글명, 없으면 영문명, 그것도 없으면 로그인 id. en UI는 영문명 우선. */
export function pickPersonName(
  user: Pick<DirectoryUser, "name" | "korean_name"> | undefined,
  login: string,
  lang: string,
): string {
  if (!user) return login;
  const ko = user.korean_name ?? "";
  return (lang === "ko" ? ko || user.name : user.name || ko) || login;
}

export function PersonPill({ login, dataId }: { login: string; dataId?: string }) {
  const { lang } = useI18n();
  const { users, ready } = useDirectoryState();
  const user = users.get(login);
  if (!ready && !user) return <SkeletonPill className="w-16" />;
  const name = pickPersonName(user, login, lang);
  const idOnly = !user;
  return (
    <UserHoverCard user={user} loginId={login}>
      <span
        data-id={dataId}
        title={login}
        className={`inline-flex max-w-full items-center gap-1 rounded-full border border-hairline py-px pl-0.5 pr-2 text-fine ${
          idOnly ? "bg-surface-alt font-mono text-ink-secondary" : "bg-surface text-ink"
        }`}
      >
        <span
          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
            idOnly ? "bg-surface text-ink-muted" : "bg-accent-tint text-accent"
          }`}
        >
          {idOnly ? "@" : name.slice(0, 1)}
        </span>
        <span className="truncate">{name}</span>
      </span>
    </UserHoverCard>
  );
}
