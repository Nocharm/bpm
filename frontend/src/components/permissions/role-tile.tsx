"use client";

// 역할 타일 — 부서·담당자 타일 옆 단일값 역할(assignee_role). 클릭 위치 팝오버 안 SuggestInput(관리 목록 자동완성).
// DeptAssigneeTiles와 분리한 이유: 역할은 부서 페어(addAssignee)와 무관하다 (design 2026-09-11 §4.1).
// 노드 편집 모달·SP 지정 모달(편집)·Subprocess 탭·노드 모달 SP 상속(읽기)이 공유.

import { BriefcaseBusiness } from "lucide-react";
import { useState } from "react";

import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import type { PopoverActionLabels } from "@/components/popover-action-bar";
import { RoleChip } from "@/components/role-chip";
import { SuggestInput } from "@/components/suggest-input";
import { useCatalogs } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n";

interface RoleTileProps {
  value: string;
  readOnly?: boolean;
  // data-id 접두 — `${prefix}-role` / `${prefix}-role-chip` / `${prefix}-popover-role` / `${prefix}-role-input`
  dataIdPrefix: string;
  labels: PopoverActionLabels;
  // 읽기 전용에서 빈 값도 타일로 남길 때의 안내("미입력") — 없으면 빈 타일은 숨긴다
  placeholder?: string;
  // DeptAssigneeTiles의 roleTile 슬롯(담당자 2 : 역할 1 한 행) 안에서는 false — 그리드 열 스팬 해제
  spanColumns?: boolean;
  onChange: (next: string) => void;
}

export function RoleTile({ value, readOnly = false, dataIdPrefix, labels, placeholder, spanColumns = true, onChange }: RoleTileProps) {
  const { t } = useI18n();
  const { assignee_roles: roleOptions } = useCatalogs();
  // 팝오버 로컬 초안 — 확정 시에만 부모에 반영, Esc면 폐기
  const [active, setActive] = useState<{ at: { x: number; y: number }; draft: string } | null>(null);
  if (readOnly && value === "" && !placeholder) return null;
  const tile = (
    <SpFieldTile
      dataId={`${dataIdPrefix}-role`}
      icon={BriefcaseBusiness}
      label={t("field.assigneeRole")}
      value=""
      valueNode={value !== "" ? <RoleChip role={value} dataId={`${dataIdPrefix}-role-chip`} /> : undefined}
      // 값 있으면 라벨 없이 칩만, 편집 가능한데 비어 있으면 라벨 + 짧은 대시 (사용자 결정 2026-09-12)
      placeholder={placeholder ?? (readOnly ? undefined : "–")}
      labelHiddenWhenFilled
      wide
      spanColumns={spanColumns}
      readOnly={readOnly}
      active={active !== null}
      onOpen={(at) => setActive({ at, draft: value })}
    />
  );
  if (readOnly || active === null) return tile;
  const dirty = active.draft !== value;
  const apply = () => onChange(active.draft.trim());
  return (
    <>
      {tile}
      <SpFieldPopover
        dataId={`${dataIdPrefix}-popover-role`}
        anchor={active.at}
        title={t("field.assigneeRole")}
        hint={t("sp.tile.hint.role")}
        width={320}
        dirty={dirty}
        // 입력 안 Enter는 제안 확정 — 전역 Enter 확정을 끈다(DeptAssigneeTiles와 동일)
        enterCommits={false}
        onApply={apply}
        onCommit={() => {
          apply();
          setActive(null);
        }}
        onCancel={() => setActive(null)}
        labels={labels}
      >
        <SuggestInput
          mode="field"
          autoFocus
          dataId={`${dataIdPrefix}-role-input`}
          value={active.draft}
          options={roleOptions}
          placeholder={t("catalog.rolePlaceholder")}
          ariaLabel={t("field.assigneeRole")}
          onCommit={(next) => setActive((prev) => (prev ? { ...prev, draft: next } : prev))}
        />
      </SpFieldPopover>
    </>
  );
}
