"use client";

// 부서 말단 필 — 저장된 부서(말단 이름 또는 슬래시 경로)를 말단만 필로 보여주고, 누르면 조직 정보 모달
// (경로·구성인원·하위 조직 트리). 타일(role=button) 안에 놓여도 클릭이 타일로 올라가지 않는다(span role=button).
// 노드 편집 모달·지정 모달의 부서 타일, 인스펙터 속성 탭(SP 상속 행·읽기 전용 행)이 공유한다 (2026-09-03).

import { Building2, TriangleAlert } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { useKoreanDeptByPath } from "@/components/map-ownership-section";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { OrgInfoModal } from "@/components/org-info-modal";
import { useDirectory, useValidDeptLeaves } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  const koreanDeptByPath = useKoreanDeptByPath();
  const deptLeaves = useValidDeptLeaves();
  const [orgInfo, setOrgInfo] = useState<{ x: number; y: number } | null>(null);
  if (department.trim() === "") return null;
  // 조직도에 없는 부서 — 감사(ref_audit)와 같은 판정(저장값 그대로 대조). 집합이 null이면 판정 보류
  const isOrphan = deptLeaves !== null && !deptLeaves.has(department.trim());
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
  // 고아 부서는 조직 정보 모달을 열 게 없다 — 버튼 역할을 떼고 안내 문구만 남긴다
  const interactive = !isOrphan;
  return (
    <>
      <span
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        data-id={dataId}
        data-orphan={isOrphan ? "true" : undefined}
        title={isOrphan ? `${department} — ${t("orphan.dept")}` : koreanName ? `${path} (${koreanName})` : path}
        // min-w-0 — 좁은 행(인스펙터)에서 말단 이름이 말줄임되며 카드 밖으로 안 나간다. 호버=보더 액센트+틴트 진해짐+그림자.
        // group/dept — 보조 줄(subLabel)을 필 호버에만 드러내는 트리거(무명 group은 바깥 타일 호버에 섞인다)
        className={`group/dept inline-flex min-w-0 max-w-full gap-1 border font-semibold transition-[background-color,border-color,box-shadow] duration-150 ${
          isOrphan
            ? "border-notice-border bg-notice text-warn"
            : `border-accent-tint-border bg-accent-tint/60 text-accent hover:border-accent hover:bg-accent-tint hover:shadow-sm ${interactive ? "cursor-pointer" : ""}`
        } ${
          // fill(타일 대체)은 빈 타일 머리 행과 같은 여백(px-2.5 py-2) — 값 유무로 위치·크기가 어긋나지 않게 (2026-09-11)
          variant === "block"
            ? `items-start rounded-sm text-fine ${fill ? "h-full w-full px-2.5 py-2" : "px-2 py-1"}`
            : "items-center rounded-full px-2 py-0.5 text-fine"
        }`}
        onClick={interactive ? handleClick : undefined}
        onKeyDown={interactive ? handleKey : undefined}
      >
        {variant === "block" ? (
          // 아이콘은 이름과 같은 행에서 세로 중앙 — 열 밖에 고정 오프셋(mt)으로 두면 글자 크기가 바뀔 때마다 어긋난다
          <span className="flex min-w-0 flex-col gap-0.5">
            {/* fill은 아이콘 16·간격 8·행 높이 20 — 빈 타일 머리 행(아이콘 16 + gap-2, "–" 캡션으로 20px)과 같은 자리에 이름이 온다.
                이름이 두 줄로 감겨도 아이콘은 첫 줄 기준(items-start + 아이콘 2px·글자 4px 내림 = 20px 행 안에서 각각 세로 중앙) */}
            <span className={`flex min-w-0 ${fill ? "min-h-5 items-start gap-2" : "items-center gap-1"}`}>
              {isOrphan ? (
                <TriangleAlert size={fill ? 16 : 13} strokeWidth={1.5} className={`shrink-0 ${fill ? "mt-0.5" : ""}`} />
              ) : (
                <Building2 size={fill ? 16 : 13} strokeWidth={1.5} className={`shrink-0 ${fill ? "mt-0.5" : ""}`} />
              )}
              <span className={`min-w-0 break-keep ${fill ? "mt-1" : ""}`}>{label || deptLeaf(path)}</span>
            </span>
            {/* 보조 줄은 호버 때만 — 자리는 늘 차지해(opacity) 호버로 타일·그리드 행 높이가 튀지 않는다 (사용자 지시 2026-09-10).
                들여쓰기 = 아이콘 + 간격으로 이름 아래 정렬 */}
            {subLabel && (
              <span className={`min-w-0 break-keep text-fine font-normal text-accent/60 opacity-0 transition-opacity duration-150 group-hover/dept:opacity-100 ${fill ? "pl-6" : "pl-[17px]"}`}>
                {subLabel}
              </span>
            )}
          </span>
        ) : (
          <>
            {isOrphan ? (
              <TriangleAlert size={11} strokeWidth={1.5} className="shrink-0" />
            ) : (
              <Building2 size={11} strokeWidth={1.5} className="shrink-0" />
            )}
            <span className="min-w-0 truncate">{label || deptLeaf(path)}</span>
          </>
        )}
      </span>
      {orgInfo && interactive && (
        <OrgInfoModal orgPath={path} koreanDeptByPath={koreanDeptByPath} origin={orgInfo} onClose={() => setOrgInfo(null)} />
      )}
    </>
  );
}
