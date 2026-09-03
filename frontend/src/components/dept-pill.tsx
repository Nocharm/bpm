"use client";

// 부서 말단 필 — 저장된 부서(말단 이름 또는 슬래시 경로)를 말단만 필로 보여주고, 누르면 조직 정보 모달
// (경로·구성인원·하위 조직 트리). 타일(role=button) 안에 놓여도 클릭이 타일로 올라가지 않는다(span role=button).
// 노드 편집 모달·지정 모달의 부서 타일, 인스펙터 속성 탭(SP 상속 행·읽기 전용 행)이 공유한다 (2026-09-03).

import { Building2 } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { useKoreanDeptByPath } from "@/components/map-ownership-section";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { OrgInfoModal } from "@/components/org-info-modal";
import { useDirectory } from "@/lib/directory";

interface DeptPillProps {
  department: string;
  dataId: string;
}

export function DeptPill({ department, dataId }: DeptPillProps) {
  const dir = useDirectory();
  const koreanDeptByPath = useKoreanDeptByPath();
  const [orgInfo, setOrgInfo] = useState<{ x: number; y: number } | null>(null);
  if (department.trim() === "") return null;
  // 부서 값(말단 이름 또는 전달된 슬래시 경로) → 조직 경로 — 디렉터리 전체에서 말단 일치를 찾는다
  const resolvePath = (): string => {
    if (department.includes("/")) return department;
    for (const user of dir.values()) {
      const path = user.org_path ?? "";
      if (path !== "" && deptLeaf(path) === department) return path;
    }
    return department;
  };
  const path = resolvePath();
  const koreanName = koreanDeptByPath.get(path) ?? "";
  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setOrgInfo({ x: e.clientX, y: e.clientY });
  };
  const handleKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setOrgInfo({ x: rect.left + rect.width / 2, y: rect.bottom });
  };
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        data-id={dataId}
        title={koreanName ? `${path} (${koreanName})` : path}
        // min-w-0 — 좁은 행(인스펙터)에서 말단 이름이 말줄임되며 카드 밖으로 안 나간다. 호버=보더 액센트+틴트 진해짐+그림자
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-accent-tint-border bg-accent-tint/60 px-2 py-0.5 text-fine font-semibold text-accent transition-[background-color,border-color,box-shadow] duration-150 hover:border-accent hover:bg-accent-tint hover:shadow-sm"
        onClick={handleClick}
        onKeyDown={handleKey}
      >
        <Building2 size={11} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 truncate">{deptLeaf(path)}</span>
      </span>
      {orgInfo && (
        <OrgInfoModal orgPath={path} koreanDeptByPath={koreanDeptByPath} origin={orgInfo} onClose={() => setOrgInfo(null)} />
      )}
    </>
  );
}
