/** 영역(그룹) 박스 기하 — 태그(다중 소속) 멤버 bbox + 비멤버 노드 홈(notch). 에디터 영역 박스 층이 쓴다. */
import type { GraphGroup } from "@/lib/api";
import { NODE_HEIGHT, NODE_WIDTH, rectWithExclusions, type AppNode } from "@/lib/canvas";

export const GROUP_PAD = 16; // 그룹 박스가 멤버 bounding box를 감싸는 여백
export const GROUP_TITLE_GAP = 26; // 박스 상단에 타이틀바를 얹을 추가 여백 — 멤버 노드와 제목 겹침 방지

export interface GroupBoxGeom {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  outline: string;
  z: number;
}

// 멤버 많은 그룹일수록 패딩↑(작은 그룹을 감쌈), z는 멤버 적은 그룹이 위(노드보다는 뒤). 반투명 fill이라 겹쳐도 모두 보임.
// getPos는 노드의 실제 렌더(표시) 좌표 — 저장좌표 + height-shift 오프셋, 동결 드래그 중이면 라이브 좌표.
export function buildGroupBoxes(
  groups: GraphGroup[],
  nodes: AppNode[],
  getPos: (node: AppNode) => { x: number; y: number },
): GroupBoxGeom[] {
  const posById = new Map(nodes.map((node) => [node.id, getPos(node)] as const));
  const posOf = (node: AppNode) => posById.get(node.id) ?? node.position;
  return groups.flatMap((group) => {
    const members = nodes.filter((node) => node.data.groupIds.includes(group.id));
    if (members.length === 0) {
      return [];
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const member of members) {
      const w = member.measured?.width ?? NODE_WIDTH;
      const h = member.measured?.height ?? NODE_HEIGHT;
      const { x, y } = posOf(member);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    // 멤버 많을수록 패딩↑ → 큰 그룹이 작은 그룹을 시각적으로 감쌈
    const pad = GROUP_PAD + Math.min(members.length, 8) * 4;
    const originX = minX - pad;
    const originY = minY - pad - GROUP_TITLE_GAP;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2 + GROUP_TITLE_GAP;
    // 기본 사각형(멤버 padded bbox)에서, 범위 안에 들어온 비멤버 노드를 가장 가까운 변쪽으로 잘라냄.
    // 좌표는 박스 좌상단(origin) 기준 상대. y는 타이틀바 헤드룸(GROUP_TITLE_GAP)만큼 내림.
    const intruderMargin = 8;
    const intruders = nodes
      .filter((node) => !node.data.groupIds.includes(group.id))
      .flatMap((node) => {
        const w = node.measured?.width ?? NODE_WIDTH;
        const h = node.measured?.height ?? NODE_HEIGHT;
        const { x, y } = posOf(node);
        // 멤버 padded bbox와 겹치는 비멤버만
        if (x >= maxX + pad || x + w <= minX - pad || y >= maxY + pad || y + h <= minY - pad) {
          return [];
        }
        return [
          {
            x: x - intruderMargin - originX,
            y: y - intruderMargin - originY,
            w: w + intruderMargin * 2,
            h: h + intruderMargin * 2,
          },
        ];
      });
    // 멤버 노드(작은 여백)는 notch보다 우선 — notch가 멤버를 반만 자르지 않게 비껴감
    const memberKeep = 6;
    const memberRects = members.map((member) => {
      const w = member.measured?.width ?? NODE_WIDTH;
      const h = member.measured?.height ?? NODE_HEIGHT;
      const { x, y } = posOf(member);
      return {
        x: x - memberKeep - originX,
        y: y - memberKeep - originY,
        w: w + memberKeep * 2,
        h: h + memberKeep * 2,
      };
    });
    const region = rectWithExclusions(
      { x: 0, y: GROUP_TITLE_GAP, w: width, h: height - GROUP_TITLE_GAP },
      intruders,
      memberRects,
    );
    return [
      {
        id: group.id,
        label: group.label,
        color: group.color,
        x: originX,
        y: originY,
        width,
        height,
        fill: region.fill,
        outline: region.outline,
        // 멤버 적은 그룹이 위(z 큼). 전부 노드(z:0)보다 뒤
        z: -members.length,
      },
    ];
  });
}
