"use client";

// 협업자 추가 피커+역할 선택 — 협업자 패널·맵 상세 카드 공용 (설계: 2026-08-08-governance-ux-design.md §B).

import { useState } from "react";

import type { DirectoryDept, DirectoryUser, Group, PrincipalType } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";

import { PrincipalPicker } from "./principal-picker";

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
  const { t } = useI18n();
  // 공개 맵이면 editor 기본값 / Default to editor on public maps (viewer disabled).
  const [role, setRole] = useState<"viewer" | "editor">(viewerGrantDisabled ? "editor" : "viewer");

  // 실 디렉터리 데이터를 피커 prop 형식으로 변환 — 미사용 필드는 빈 값으로 채움.
  // Adapt real directory data to picker's MockUser / Department shapes (unused fields stubbed).
  const pickerUsers: MockUser[] = dirUsers.map((u) => ({
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

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
      <p className="text-caption-strong text-ink">{t("perm.addCollaborator")}</p>

      {/* 선택한 역할로 드롭다운 선택(클릭/Enter) 즉시 추가 — 별도 Add 버튼 없음 (3차 수정) */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <PrincipalPicker
            users={pickerUsers}
            departments={pickerDepts}
            groups={toPickerGroups(groups)}
            excludeIds={excludeIds}
            deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
            onSelect={(opt) => onAdd(opt.principalType, opt.principalId, role)}
          />
        </div>
        {/* 역할 — 퍼블릭 맵이면 editor 1옵션이라 드롭다운 대신 정적 표시(화살표 없음) */}
        {viewerGrantDisabled ? (
          <span className="rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-fine text-ink-secondary">
            {t("perm.roleEditor")}
          </span>
        ) : (
          <select
            className="rounded-sm border border-hairline bg-surface px-1.5 py-1.5 text-fine text-ink"
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
          >
            <option value="viewer">{t("perm.roleViewer")}</option>
            <option value="editor">{t("perm.roleEditor")}</option>
          </select>
        )}
      </div>
    </div>
  );
}
