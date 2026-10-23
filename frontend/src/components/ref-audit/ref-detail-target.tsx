// 고아 참조 상세 창의 바꿀 대상 고르기 — 부서는 조직도 트리 창, 사람은 이름 검색 피커. 상세 창 대체 줄의 오른쪽 칸이다.
"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { DeptTreePicker } from "@/components/admin/dept-tree-picker";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker } from "@/components/permissions/principal-picker";
import type { RefCard } from "@/lib/api";
import { useDirectory, useDirectoryDepartments } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { User as PickerUser } from "@/lib/mock/permissions";

/** 고른 대상 — value는 적용 본문의 to_value(부서 경로·로그인), label은 화면 이름. */
export interface RefTargetChoice {
  value: string;
  label: string;
}

interface RefDetailTargetProps {
  kind: RefCard["kind"];
  target: RefTargetChoice | null;
  onPick: (choice: RefTargetChoice) => void;
  onClear: () => void;
}

// 피커 후보에서 뺄 사람 없음 — 사라진 사람은 디렉터리에 이미 없다
const NO_EXCLUDES = new Set<string>();

function formatParentPath(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, -1).join(" › ");
}

export function RefDetailTarget({ kind, target, onPick, onClear }: RefDetailTargetProps) {
  const { t } = useI18n();
  const [isPickingDept, setIsPickingDept] = useState(false);
  const directory = useDirectory();
  const departments = useDirectoryDepartments();

  if (kind === "dept") {
    const parentPath = target ? formatParentPath(target.value) : "";
    return (
      <>
        <button
          type="button"
          data-id="ref-detail-picker"
          title={target?.value}
          onClick={() => setIsPickingDept(true)}
          className="inline-flex h-[34px] min-w-[200px] max-w-full items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-3 text-caption hover:bg-surface-alt"
        >
          {target ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-ink">{target.label}</span>
              {parentPath ? <span className="truncate text-fine text-ink-tertiary">{parentPath}</span> : null}
            </span>
          ) : (
            <span className="text-ink-tertiary">{t("refAudit.dlg.pickDept")}</span>
          )}
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-hidden />
        </button>
        {/* 상세 창의 유리면(backdrop-filter)이 fixed 자식을 가두므로 body로 띄운다. ModalBackdrop 래퍼는
            Escape 스택에 끼워 넣는 용도 — 트리 창만 닫히고 상세 창은 남는다(바깥 클릭은 트리 창이 직접 처리). */}
        {isPickingDept
          ? createPortal(
              <ModalBackdrop onClose={() => setIsPickingDept(false)}>
                <DeptTreePicker
                  title={t("refAudit.dlg.pickDept")}
                  departments={departments}
                  onPick={(path) => {
                    onPick({ value: path, label: deptLeaf(path) });
                    setIsPickingDept(false);
                  }}
                  onClose={() => setIsPickingDept(false)}
                />
              </ModalBackdrop>,
              document.body,
            )
          : null}
      </>
    );
  }

  if (target) {
    return (
      <button
        type="button"
        data-id="ref-detail-picker"
        title={t("refAudit.dlg.clearTarget")}
        aria-label={`${target.label} · ${t("refAudit.dlg.clearTarget")}`}
        onClick={onClear}
        className="inline-flex h-[34px] min-w-[200px] max-w-full items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-3 text-caption text-ink hover:bg-surface-alt"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{target.label}</span>
          <span className="truncate font-mono text-fine text-ink-tertiary">{target.value}</span>
        </span>
        <X size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-hidden />
      </button>
    );
  }

  const users = [...directory.values()];
  const pickerUsers: PickerUser[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: "",
    departmentId: "",
    status: "active",
    isSysadmin: false,
    korean_name: user.korean_name ?? "",
  }));
  const userDepartments = Object.fromEntries(users.map((user) => [user.id, user.department]));
  return (
    <span data-id="ref-detail-picker" title={t("refAudit.dlg.pickUser")} className="min-w-[220px] flex-1 rounded-sm bg-surface">
      <PrincipalPicker
        users={pickerUsers}
        departments={[]}
        groups={[]}
        excludeIds={NO_EXCLUDES}
        userDepartments={userDepartments}
        onSelect={(option) => {
          if (option.principalType === "user") onPick({ value: option.principalId, label: option.displayName });
        }}
      />
    </span>
  );
}
