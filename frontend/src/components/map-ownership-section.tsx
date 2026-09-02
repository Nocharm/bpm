"use client";

// 속성 빈상태 소유·승인자 섹션 — 오우닝 부서·오너·승인자 한눈에(맵 탭 협업자 섹션과 같은 박스형 아코디언).
// 표시 전용 — 편집·관리는 맵 탭(협업자)·승인 탭(승인자)에서 한다.
// 이름·부서는 언어설정 우선노출+폴백 — ko는 korean_name/dept_info 한글명, 없으면 영문(approval-panel·협업자 카드와 동일 규칙).

import { ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { SkeletonPill } from "@/components/skeleton";
import { UserHoverCard } from "@/components/user-hover-card";
import { getDirectory } from "@/lib/api";
import { useDirectoryState } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { buildKoreanDeptByPath, formatDeptName } from "@/lib/korean-dept";

// org_path → 한글 부서명 — 세션당 1회만 fetch(모듈 캐시, lib/directory.ts와 같은 기법).
// 속성 빈상태는 선택 변경마다 리마운트되므로 컴포넌트 내 fetch면 매번 재조회하게 된다.
let deptNameCache: Map<string, string> | null = null;

export function useKoreanDeptByPath(): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(deptNameCache ?? new Map());
  useEffect(() => {
    if (deptNameCache) return;
    let alive = true;
    void getDirectory()
      .then((dir) => {
        deptNameCache = buildKoreanDeptByPath(dir.departments, dir.users);
        if (alive) setMap(deptNameCache);
      })
      .catch(() => {
        // 조회 실패 — 영문 리프 폴백으로 그대로 표시
      });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}

interface MapOwnershipSectionProps {
  owningDept: string | null;
  ownerId: string | null;
  approvers: string[];
}

export function MapOwnershipSection({ owningDept, ownerId, approvers }: MapOwnershipSectionProps) {
  const { t, lang } = useI18n();
  const koreanDeptByPath = useKoreanDeptByPath();
  const empty = <span className="text-fine text-ink-tertiary">-</span>;
  return (
    <details
      open
      data-acc
      data-id="map-ownership-section"
      className="group rounded-md border border-hairline px-3 py-2"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 text-fine font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} strokeWidth={1.5} className="transition-transform group-open:rotate-90" />
        {t("inspector.ownership")}
      </summary>
      <div className="mt-2 flex flex-col gap-0.5">
        <OwnershipRow label={t("perm.owningDept.title")}>
          {owningDept ? (
            <span title={owningDept} className="min-w-0 truncate text-fine text-ink">
              {formatDeptName(owningDept, lang, koreanDeptByPath)}
            </span>
          ) : (
            empty
          )}
        </OwnershipRow>
        <OwnershipRow label={t("home.memberOwner")}>
          {ownerId ? <LocalizedUserPill loginId={ownerId} /> : empty}
        </OwnershipRow>
        <OwnershipRow label={t("approval.approversTitle")}>
          {approvers.length > 0 ? (
            <span className="flex min-w-0 flex-wrap justify-end gap-1">
              {approvers.map((id) => (
                <LocalizedUserPill key={id} loginId={id} />
              ))}
            </span>
          ) : (
            empty
          )}
        </OwnershipRow>
      </div>
    </details>
  );
}

// UserPill의 언어설정 변형 — ko는 한글이름 우선, 없으면 영문·아이디 폴백. 스켈레톤·호버 카드는 동일.
function LocalizedUserPill({ loginId }: { loginId: string }) {
  const { lang } = useI18n();
  const { users, ready } = useDirectoryState();
  const user = users.get(loginId);
  if (!ready && !user) {
    return <SkeletonPill />;
  }
  const english = user?.name || loginId;
  const name = lang === "ko" ? user?.korean_name || english : english;
  return (
    <UserHoverCard user={user} loginId={loginId}>
      <span className="truncate rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary transition-colors hover:bg-accent-tint hover:text-accent">
        {name}
      </span>
    </UserHoverCard>
  );
}

function OwnershipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="shrink-0 text-fine text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}
