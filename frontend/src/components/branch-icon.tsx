"use client";

// 분기(Yes/No/Other) 아이콘 — 브랜치 팝업(EdgeBranchModal)·인스펙터 분기 선택 공용.
// Yes=체크(브랜치 블루)·No=엑스(브랜치 레드)·Other=점 3개(중립). 색은 실제 캔버스 분기 엣지 색(데이터 색 예외).
// replayKey 변경 시 SVG 리마운트→애니 재생(globals.css `.edge-br-*`). 정지 상태(애니 없이)도 그려진 최종형.

import type { BranchKind } from "@/lib/canvas";

const BRANCH_YES = { stroke: "var(--color-branch-yes)" };
const BRANCH_NO = { stroke: "var(--color-branch-no)" };

export function BranchGlyph({
  kind,
  replayKey = 0,
  size = 24,
}: {
  kind: BranchKind;
  replayKey?: number;
  size?: number;
}) {
  if (kind === "yes") {
    return (
      <svg key={replayKey} width={size} height={size} viewBox="0 0 24 24" fill="none" style={BRANCH_YES} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path className="edge-br-check" pathLength={1} d="M20 6 L9 17 L4 12" />
      </svg>
    );
  }
  if (kind === "no") {
    return (
      <svg key={replayKey} width={size} height={size} viewBox="0 0 24 24" fill="none" style={BRANCH_NO} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path className="edge-br-x1" pathLength={1} d="M18 6 L6 18" />
        <path className="edge-br-x2" pathLength={1} d="M6 6 L18 18" />
      </svg>
    );
  }
  return (
    <svg key={replayKey} className="text-ink-tertiary" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <circle className="edge-br-dot edge-br-dot1" cx="5" cy="12" r="2" />
      <circle className="edge-br-dot edge-br-dot2" cx="12" cy="12" r="2" />
      <circle className="edge-br-dot edge-br-dot3" cx="19" cy="12" r="2" />
    </svg>
  );
}
