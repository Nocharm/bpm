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
  // 표시 이름 대체 — UI 언어 한글명처럼 말단 영문 대신 보일 글자(홈 상세 부서 타일). 없으면 영문 말단
  label?: string;
  // block — 긴 부서명을 말줄임 없이 줄바꿈해 다 보여주는 둥근 사각형(홈 상세 부서 타일, 사용자 지시 2026-09-09).
  // 기본 pill은 한 줄 말줄임 알약(좁은 행·타일에서 폭을 못 늘리는 표면)
  variant?: "pill" | "block";
  // block 전용 — 이름 아래 톤다운 보조 줄(UI 언어의 반대 언어 부서명)
  subLabel?: string;
  // block 전용 — 셀을 가득 채워 필 자체가 타일이 된다(홈 상세 부서 타일, 사용자 지시 2026-09-09)
  fill?: boolean;
}

export function DeptPill({ department, dataId, label, variant = "pill", subLabel, fill }: DeptPillProps) {
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
        className={`inline-flex min-w-0 max-w-full gap-1 border border-accent-tint-border bg-accent-tint/60 font-semibold text-accent transition-[background-color,border-color,box-shadow] duration-150 hover:border-accent hover:bg-accent-tint hover:shadow-sm ${
          variant === "block"
            ? `items-start rounded-sm px-2 py-1 text-caption ${fill ? "h-full w-full" : ""}`
            : "items-center rounded-full px-2 py-0.5 text-fine"
        }`}
        onClick={handleClick}
        onKeyDown={handleKey}
      >
        <Building2 size={variant === "block" ? 13 : 11} strokeWidth={1.5} className={`shrink-0 ${variant === "block" ? "mt-0.5" : ""}`} />
        {variant === "block" ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="min-w-0 break-keep">{label || deptLeaf(path)}</span>
            {subLabel && <span className="min-w-0 break-keep text-fine font-normal text-accent/60">{subLabel}</span>}
          </span>
        ) : (
          <span className="min-w-0 truncate">{label || deptLeaf(path)}</span>
        )}
      </span>
      {orgInfo && (
        <OrgInfoModal orgPath={path} koreanDeptByPath={koreanDeptByPath} origin={orgInfo} onClose={() => setOrgInfo(null)} />
      )}
    </>
  );
}
