// 부서 헤더 행 + 그 부서가 직접 가진 맵 카드를 묶는 박스.
// 컬럼 풀폭(들여쓰기 0)이라 카드 폭이 depth와 무관하게 고정된다 — 계층은 박스 "안쪽" 헤더의
// paddingLeft가 담당한다. 박스를 들여쓰거나 중첩하면 카드 폭이 다시 depth에 묶인다.
// 테두리는 없다 — 카드 자체가 이미 테두리를 갖고 있어, 박스에도 테두리를 두면 9px 간격을 두고
// 거의 동심인 둥근 테두리 두 겹이 겹쳐 보였다(육안 지적). 틴트 배경만으로 그룹을 표시하고,
// 좌우 패딩도 없애 카드 인셋은 카드 리스트 쪽(pl-5 pr-2)에 맡긴다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R4
"use client";

import type { ReactNode } from "react";

interface DeptGroupBoxProps {
  children: ReactNode;
  // 표면별 식별자 — 업무 체계(framework-tree)가 같은 박스를 재사용하며 data-id만 달리 단다.
  dataId?: string;
}

export function DeptGroupBox({ children, dataId = "org-group-box" }: DeptGroupBoxProps) {
  return (
    <div
      data-id={dataId}
      className="flex flex-col gap-2 rounded-sm bg-surface-alt py-2"
    >
      {children}
    </div>
  );
}
