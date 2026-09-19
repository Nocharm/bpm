// 업무 체계 탐색 모달의 ERD식 다이어그램 레이아웃(순수) — 위 가운데 상위 체인(L1까지 전부), 가운데 현재,
// 자식은 좌/우 번갈아, 손자는 각 자식 바깥쪽에 세로 계단 스택. 엣지는 수평→수직→수평 직각 버스라 서로
// 겹치지 않고, 자식 간격은 손자 스택 높이만큼 벌린다 (목업 v4 확정 2026-09-19). 렌더러는
// components/maps/framework-explorer-modal.tsx.

import type { CategoryNode } from "@/lib/api";

// 박스·간격 상수(px, SVG 사용자 단위) — BW/BH 박스, ROW 손자 행 피치, GAP 자식 블록 간격,
// DX 중심↔자식 x 거리, SX 자식↔손자 x 간격, TOP 상위 체인 시작 y, ANC_GAP 상위 박스 간격
export const DIAGRAM = { BW: 156, BH: 28, ROW: 32, GAP: 22, DX: 200, SX: 60, TOP: 24, ANC_GAP: 14, BELOW_ANCESTORS: 56 } as const;

export type DiagramKind = "ancestor" | "center" | "child" | "grandchild";

export interface DiagramNode {
  node: CategoryNode;
  x: number; // 박스 좌상단
  y: number;
  kind: DiagramKind;
  side: "L" | "R" | null; // 중심 기준 좌/우(상위·중심은 null)
}

export interface DiagramLink {
  d: string; // SVG path — 직각 버스
  kind: "up" | "down";
}

export interface DiagramInput {
  ancestors: CategoryNode[]; // 루트(L1)→부모 순, 없으면 []
  center: CategoryNode;
  children: CategoryNode[];
  grandchildren: Map<number, CategoryNode[]>; // 자식 id → 손자(없으면 미포함)
}

export interface DiagramLayout {
  nodes: DiagramNode[];
  links: DiagramLink[];
  width: number;
  height: number;
  cx: number; // 중심 박스 가운데 x
  cy: number; // 중심 박스 가운데 y
}

export function layoutDiagram(input: DiagramInput, width = 1180): DiagramLayout {
  const { BW, BH, ROW, GAP, DX, SX, TOP, ANC_GAP, BELOW_ANCESTORS } = DIAGRAM;
  const nodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];
  const cx = width / 2;

  // 상위 체인 — 위 가운데에 L1부터 차례로 쌓고, 마지막 상위가 중심으로 내려온다
  const ancestorsBottom = input.ancestors.length > 0 ? TOP + input.ancestors.length * (BH + ANC_GAP) - ANC_GAP : 0;

  const gcOf = (k: CategoryNode) => input.grandchildren.get(k.id) ?? [];
  const blockHeight = (k: CategoryNode) => Math.max(BH, gcOf(k).length * ROW - (ROW - BH));
  const sides: { L: CategoryNode[]; R: CategoryNode[] } = { L: [], R: [] };
  input.children.forEach((k, i) => sides[i % 2 === 0 ? "R" : "L"].push(k));
  const sideHeight = (arr: CategoryNode[]) => arr.reduce((s, k) => s + blockHeight(k), 0) + Math.max(0, arr.length - 1) * GAP;
  const totalH = Math.max(sideHeight(sides.L), sideHeight(sides.R), BH);
  const cy = (input.ancestors.length > 0 ? ancestorsBottom + BELOW_ANCESTORS : TOP + BH) + totalH / 2;

  input.ancestors.forEach((a, i) => {
    const y = TOP + i * (BH + ANC_GAP);
    nodes.push({ node: a, x: cx - BW / 2, y, kind: "ancestor", side: null });
    const nextTop = i === input.ancestors.length - 1 ? cy - BH / 2 : y + BH + ANC_GAP;
    links.push({ d: `M${cx},${y + BH} V${nextTop}`, kind: "up" });
  });
  nodes.push({ node: input.center, x: cx - BW / 2, y: cy - BH / 2, kind: "center", side: null });

  for (const side of ["L", "R"] as const) {
    const arr = sides[side];
    const sgn = side === "R" ? 1 : -1;
    let y = cy - sideHeight(arr) / 2;
    const kx = cx + sgn * DX - BW / 2;
    const busX = cx + sgn * (DX - BW / 2 - 24);
    for (const k of arr) {
      const bh = blockHeight(k);
      const ky = y + bh / 2 - BH / 2; // 자식 박스는 손자 스택의 세로 가운데
      nodes.push({ node: k, x: kx, y: ky, kind: "child", side });
      links.push({ d: `M${cx + sgn * (BW / 2)},${cy} H${busX} V${ky + BH / 2} H${kx + (sgn > 0 ? 0 : BW)}`, kind: "down" });
      const gcs = gcOf(k);
      if (gcs.length > 0) {
        const gx = kx + sgn * (BW + SX);
        const gbus = kx + (sgn > 0 ? BW + SX / 2 : -SX / 2);
        gcs.forEach((g, j) => {
          const gy = y + j * ROW;
          nodes.push({ node: g, x: gx, y: gy, kind: "grandchild", side });
          links.push({ d: `M${kx + (sgn > 0 ? BW : 0)},${ky + BH / 2} H${gbus} V${gy + BH / 2} H${gx + (sgn > 0 ? 0 : BW)}`, kind: "down" });
        });
      }
      y += bh + GAP;
    }
  }

  const height = Math.max(cy + totalH / 2 + 40, 360);
  return { nodes, links, width, height, cx, cy };
}

// 화면에 전부 들어오는 배율 — 세로 기준, 확대는 하지 않는다(1 상한)
export function fitScale(layout: DiagramLayout, viewportHeight: number): number {
  return Math.min(1, (viewportHeight - 20) / layout.height);
}
