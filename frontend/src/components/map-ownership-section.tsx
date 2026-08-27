"use client";

// 속성 빈상태 소유·승인자 섹션 — 오우닝 부서·오너·승인자 한눈에(맵 탭 협업자 섹션과 같은 박스형 아코디언).
// 표시 전용 — 편집·관리는 맵 탭(협업자)·승인 탭(승인자)에서 한다.

import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";

import { UserPill } from "@/components/user-pill";
import { useI18n } from "@/lib/i18n";

interface MapOwnershipSectionProps {
  owningDept: string | null;
  ownerId: string | null;
  approvers: string[];
}

export function MapOwnershipSection({ owningDept, ownerId, approvers }: MapOwnershipSectionProps) {
  const { t } = useI18n();
  // 부서는 리프명만 표시(전체 경로는 title) — 내보내기 정보 모달과 같은 규칙
  const deptLeaf = owningDept?.split("/").filter(Boolean).pop() ?? null;
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
          {deptLeaf ? (
            <span title={owningDept ?? undefined} className="min-w-0 truncate text-fine text-ink">
              {deptLeaf}
            </span>
          ) : (
            empty
          )}
        </OwnershipRow>
        <OwnershipRow label={t("home.memberOwner")}>
          {ownerId ? <UserPill loginId={ownerId} /> : empty}
        </OwnershipRow>
        <OwnershipRow label={t("approval.approversTitle")}>
          {approvers.length > 0 ? (
            <span className="flex min-w-0 flex-wrap justify-end gap-1">
              {approvers.map((id) => (
                <UserPill key={id} loginId={id} />
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

function OwnershipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="shrink-0 text-fine text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}
