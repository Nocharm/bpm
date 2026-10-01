"use client";

// 빠른 연결 미리보기 — 커넥션 드래그 중 포인터가 노드 "몸체" 위면(핸들 미포착) 그 노드의
// 기본 핸들(정방향=왼쪽 타깃, 역방향=오른쪽 소스)에 스냅된 연결선을 그린다. 실제 핸들이
// 포착된 상태(connectionStatus 有)는 React Flow 스냅을 그대로 둔다. onConnectEnd의 몸체 드롭
// (page.tsx handleConnectEnd)과 판정 헬퍼를 공유해 미리보기=드롭 결과가 일치한다 (2026-08-25).

import {
  getBezierPath,
  Position,
  useStore,
  type ConnectionLineComponentProps,
} from "@xyflow/react";

import {
  sourceHandleId,
  targetHandleId,
  violatesTerminalRule,
  type AppNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import { PRIMARY_END_HANDLE, SUBPROCESS_IN_HANDLE } from "@/lib/subprocess-embed";

/** 몸체 드롭 시 기본 타깃 핸들 — 일반 노드는 왼쪽, subprocess는 전용 인 핸들(왼쪽). */
export function getQuickTargetHandleId(nodeType: ProcessNodeType): string {
  return nodeType === "subprocess" ? SUBPROCESS_IN_HANDLE : targetHandleId("left");
}

/** 역방향 몸체 드롭 시 기본 소스 핸들 — 일반 노드는 오른쪽, subprocess는 대표 끝(끝 ≥ 2면 호출부가 목록으로 바꾼다). */
export function getQuickSourceHandleId(nodeType: ProcessNodeType): string {
  return nodeType === "subprocess" ? PRIMARY_END_HANDLE : sourceHandleId("right");
}

/** 몸체 드롭 허용 판정 — 터미널 규칙 + section 제외. 역방향(타깃 핸들에서 시작)이면 드롭
 *  노드가 소스가 된다. subprocess 소스는 끝이 2개 이상이면 호출부가 출구 선택 목록(EdgeEndModal)으로 끝을 정한다. */
export function canQuickConnect(
  fromType: ProcessNodeType | undefined,
  overType: ProcessNodeType | undefined,
  reverse: boolean,
): boolean {
  if (!overType) return false;
  if (reverse) {
    return !violatesTerminalRule(overType, fromType);
  }
  return !violatesTerminalRule(fromType, overType);
}

export function QuickConnectLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  fromNode,
  fromHandle,
  connectionStatus,
}: ConnectionLineComponentProps<AppNode>) {
  const nodeLookup = useStore((s) => s.nodeLookup);
  let targetX = toX;
  let targetY = toY;
  let targetPosition = toPosition;
  // connectionStatus가 있으면 실제 핸들 포착(스냅) 중 — 몸체 스냅은 미포착일 때만
  if (connectionStatus === null && fromNode && fromHandle) {
    const reverse = fromHandle.type === "target";
    for (const node of nodeLookup.values()) {
      if (node.id === fromNode.id || node.connectable === false) continue;
      const width = node.measured?.width ?? 0;
      const height = node.measured?.height ?? 0;
      if (!width || !height) continue;
      const { x, y } = node.internals.positionAbsolute;
      if (toX < x || toX > x + width || toY < y || toY > y + height) continue;
      const overData = node.data as AppNode["data"];
      if (!canQuickConnect(fromNode.data.nodeType, overData.nodeType, reverse)) break;
      const wantedId = reverse ? getQuickSourceHandleId(overData.nodeType) : getQuickTargetHandleId(overData.nodeType);
      const bounds = reverse
        ? node.internals.handleBounds?.source
        : node.internals.handleBounds?.target;
      // subprocess 역방향은 끝 핸들 중 첫 번째(대표 끝)에 미리보기를 붙인다 — 실제 끝은 드롭 뒤 목록에서 고른다
      const handle = bounds?.find((entry) => entry.id === wantedId) ?? (reverse && overData.nodeType === "subprocess" ? bounds?.[0] : undefined);
      if (!handle) break;
      targetX = x + handle.x + handle.width / 2;
      targetY = y + handle.y + handle.height / 2;
      targetPosition = reverse ? Position.Right : Position.Left;
      break;
    }
  }
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <g>
      <path d={path} fill="none" className="react-flow__connection-path" />
    </g>
  );
}
