// 트리 행 들여쓰기(부서 트리·업무 체계 트리 공용) — 깊이당 12px + 4px. 헤더는 `--tree-indent`를 들고
// 패딩은 거기에 `--tree-shift`(조상 가이드 라인이 켜질 때 globals.css가 주는 밀림 폭)를 더한다.
// 헤더 엘리먼트와 패딩 엘리먼트가 다른 표면(업무 체계: div 헤더 > button)이 있어 변수와 클래스를 나눠 둔다.

import type { CSSProperties } from "react";

export const TREE_INDENT_PADDING_CLASS = "pl-[calc(var(--tree-indent)+var(--tree-shift,0px))]";

export function getTreeIndentStyle(depth: number): CSSProperties {
  // 커스텀 프로퍼티는 CSSProperties 타입에 없다 — 키를 넓힌 뒤 좁혀 돌려준다
  const style: Record<string, string> = { "--tree-indent": `${depth * 12 + 4}px` };
  return style as CSSProperties;
}
