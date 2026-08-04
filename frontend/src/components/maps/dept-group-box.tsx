// 부서 헤더 행 + 그 부서가 직접 가진 맵 카드를 묶는 박스.
// 컬럼 풀폭(들여쓰기 0)이라 카드 폭이 depth와 무관하게 고정된다 — 계층은 박스 "안쪽" 헤더의
// paddingLeft가 담당한다. 박스를 들여쓰거나 중첩하면 카드 폭이 다시 depth에 묶인다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R4
"use client";

import type { ReactNode } from "react";

interface DeptGroupBoxProps {
  children: ReactNode;
}

export function DeptGroupBox({ children }: DeptGroupBoxProps) {
  return (
    <div
      data-id="org-group-box"
      className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface-alt p-2"
    >
      {children}
    </div>
  );
}
