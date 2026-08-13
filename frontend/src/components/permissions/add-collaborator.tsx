"use client";

// 협업자 추가 피커+역할 선택 — 협업자 패널·맵 상세 카드 공용 (설계: 2026-08-08-governance-ux-design.md §B).
// 역할은 목록에서 후보를 클릭한 자리(또는 Enter 시 입력창 하단)에 뜨는 팝오버에서 2단계로 고른다 —
// 우측에 role을 미리 선택해두는 방식은 어떤 이름을 눌렀는지 헷갈려 폐기 (R2 QA 피드백).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DirectoryDept, DirectoryUser, Group, PrincipalType } from "@/lib/api";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";

import { PrincipalPicker, type PrincipalOption } from "./principal-picker";

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

// 클릭 위치(또는 Enter 폴백 좌표) 기준 역할 팝오버 — Viewer/Editor 중 하나를 고르는 2단계.
// 로컬 전용(export 안 함) — AddCollaborator 밖에서 쓰이지 않는다.
function RolePopover({
  name,
  x,
  y,
  viewerGrantDisabled,
  onPick,
  onCancel,
}: {
  name: string;
  x: number;
  y: number;
  /** 퍼블릭 맵이면 Viewer 버튼을 숨김 — Editor 하나뿐이어도 2-step은 유지 (사용자 지시). */
  viewerGrantDisabled?: boolean;
  onPick: (role: "viewer" | "editor") => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc = 취소(선택 없이 닫힘) — capture로 등록해 팝오버 자신의 클릭보다 먼저 보되,
  // ref.contains로 내부 클릭은 걸러낸다.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  // 커서 우하단 오프셋으로 클램프 — 클릭된 이름을 팝오버가 가리지 않게, 화면 밖으로 나가지 않게.
  const { left, top } = clampToViewport(x + 12, y + 12, 200, 96);

  return createPortal(
    <div
      ref={popoverRef}
      data-id="add-pick-popover"
      style={{ left, top }}
      className="fixed z-[1300] rounded-md border border-hairline bg-surface p-2 shadow-lg"
    >
      <p className="max-w-[176px] truncate text-fine text-ink-tertiary">{name}</p>
      <p className="mb-1.5 text-fine text-ink-tertiary">{t("perm.addPick.title")}</p>
      <div className="flex gap-1.5">
        {!viewerGrantDisabled && (
          <button
            type="button"
            data-id="add-pick-viewer"
            className="rounded-sm border border-hairline px-2 py-1 text-fine hover:bg-surface-alt"
            onClick={() => onPick("viewer")}
          >
            {t("perm.roleViewer")}
          </button>
        )}
        <button
          type="button"
          data-id="add-pick-editor"
          className="rounded-sm border border-hairline px-2 py-1 text-fine hover:bg-surface-alt"
          onClick={() => onPick("editor")}
        >
          {t("perm.roleEditor")}
        </button>
      </div>
    </div>,
    document.body,
  );
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
