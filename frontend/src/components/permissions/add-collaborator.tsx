"use client";

// 협업자 추가 피커+역할 선택 — 협업자 패널·맵 상세 카드 공용 (설계: 2026-08-08-governance-ux-design.md §B).
// 역할은 목록에서 후보를 클릭한 자리(또는 Enter 시 입력창 하단)에 뜨는 팝오버에서 2단계로 고른다 —
// 우측에 role을 미리 선택해두는 방식은 어떤 이름을 눌렀는지 헷갈려 폐기 (R2 QA 피드백).
// RolePopover는 role-popover.tsx로 추출 — create-map-dialog.tsx도 쓰는 두 번째 사용처 등장 (T3).

import { useRef, useState, useSyncExternalStore } from "react";

import type { DirectoryDept, DirectoryUser, Group, PrincipalType } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import { sortUsersByOrgProximity } from "@/lib/org-proximity";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";

import { PrincipalPicker, type PrincipalOption } from "./principal-picker";
import { RolePopover } from "./role-popover";

// 실 active 그룹을 피커 prop(UserGroup) 형식으로 변환 — principalId = 문자열 그룹 id /
// Adapt real active groups to the picker's UserGroup shape (principalId = string group id).
function toPickerGroups(groups: Group[]): UserGroup[] {
  return groups
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: String(g.id),
      name: g.name,
      description: g.description,
      status: "active" as const,
      managerIds: [],
      members: [],
    }));
}

// 협업자 추가 폼 — 추가는 즉시 적용(서버) / Add-collaborator form; add is applied immediately by the server.
export function AddCollaborator({
  excludeIds,
  viewerGrantDisabled,
  dirUsers,
  dirDepts,
  groups,
  onAdd,
}: {
  excludeIds: Set<string>;
  /** 공개 맵이면 viewer 선택 비활성 / Disable viewer option on public maps. */
  viewerGrantDisabled?: boolean;
  /** 실 디렉터리 사용자 / Real directory users for the picker. */
  dirUsers: DirectoryUser[];
  /** 실 디렉터리 부서 / Real directory departments for the picker. */
  dirDepts: DirectoryDept[];
  /** 실 active 그룹 / Real active groups for the picker. */
  groups: Group[];
  onAdd: (
    principalType: PrincipalType,
    principalId: string,
    role: "viewer" | "editor",
  ) => void;
}) {
  const { t, lang } = useI18n();
  // 입력창 wrapper — Enter 경로(좌표 없음) 폴백: 입력창 하단 기준으로 팝오버를 띄운다.
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  // 클릭(또는 Enter)된 후보 — 팝오버가 열린 동안의 로컬 의도. 역할 선택 시 onAdd 호출 후 소거.
  const [pendingPick, setPendingPick] = useState<{ option: PrincipalOption; x: number; y: number } | null>(
    null,
  );

  // 기본(무검색) 목록 — 내 조직 근접도 우선(3다리 내 우선 노출, org 빈 사람 최후순위).
  // 검색 랭킹(lib/search)은 입력 순서와 무관해 그대로 유지된다.
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  // 실 디렉터리 데이터를 피커 prop 형식으로 변환 — 미사용 필드는 빈 값으로 채움.
  // Adapt real directory data to picker's MockUser / Department shapes (unused fields stubbed).
  const pickerUsers: MockUser[] = sortUsersByOrgProximity(dirUsers, me?.orgPath ?? "").map((u) => ({
    id: u.id,
    name: u.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
    korean_name: u.korean_name ?? "",
  }));
  const pickerDepts: Department[] = dirDepts.map((d) => ({
    id: d.id,
    code: "",
    name: d.name,
    orgLevels: [],
    parentId: null,
    rawDn: "",
    korean_name: d.korean_name,
  }));

  const pendingName = pendingPick
    ? lang === "ko" && pendingPick.option.koreanName
      ? pendingPick.option.koreanName
      : pendingPick.option.displayName
    : "";

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
      <p className="text-caption-strong text-ink">{t("perm.addCollaborator")}</p>

      {/* 클릭(또는 Enter) 시 역할 팝오버를 띄우고, 팝오버에서 Viewer/Editor 선택 시 추가 (R2 QA 피드백) */}
      <div ref={pickerWrapRef}>
        <PrincipalPicker
          users={pickerUsers}
          departments={pickerDepts}
          groups={toPickerGroups(groups)}
          excludeIds={excludeIds}
          deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
          highlightId={
            pendingPick ? `${pendingPick.option.principalType}:${pendingPick.option.principalId}` : null
          }
          onSelect={(opt, coords) => {
            const fallback = pickerWrapRef.current?.getBoundingClientRect();
            const { x, y } = coords ?? { x: fallback?.left ?? 0, y: fallback?.bottom ?? 0 };
            setPendingPick({ option: opt, x, y });
          }}
        />
      </div>

      {pendingPick && (
        <RolePopover
          name={pendingName}
          x={pendingPick.x}
          y={pendingPick.y}
          viewerGrantDisabled={viewerGrantDisabled}
          onPick={(role) => {
            onAdd(pendingPick.option.principalType, pendingPick.option.principalId, role);
            setPendingPick(null);
          }}
          onCancel={() => setPendingPick(null)}
        />
      )}
    </div>
  );
}
