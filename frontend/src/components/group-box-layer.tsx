"use client";

// 에디터 영역(그룹) 박스 층 — 동결 드래그(#R2) 중엔 라이브 좌표 신호·합류 대상만 구독해 이 층만 다시 그린다(페이지 리렌더 없이 박스가 멤버를 따라감). 맵 에디터 전용.
import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { GraphGroup } from "@/lib/api";
import type { AppNode } from "@/lib/canvas";
import { generalDragLive, getDragLiveVersion, subscribeDragLive } from "@/lib/drag-live";
import { useGroupDropTarget } from "@/lib/drop-target";
import { buildGroupBoxes, type GroupBoxGeom } from "@/lib/group-boxes";

interface GroupBoxLayerProps {
  groups: GraphGroup[];
  nodes: AppNode[]; // 저장좌표 노드(nodes state)
  yOffsets: ReadonlyMap<string, number>; // height-shift 표시 오프셋(트윈 중간값)
  renderBox: (box: GroupBoxGeom, targeted: boolean) => ReactNode; // targeted: 드래그 노드의 합류 대상(펄스 강조)
}

export function GroupBoxLayer({ groups, nodes, yOffsets, renderBox }: GroupBoxLayerProps) {
  const liveVersion = useSyncExternalStore(subscribeDragLive, getDragLiveVersion, getDragLiveVersion);
  const groupDropTarget = useGroupDropTarget();
  const boxes = useMemo(() => {
    // 라이브 좌표는 RF가 보고한 표시좌표 그대로(오프셋 포함) — 그 외 노드는 저장좌표 + 오프셋.
    // liveVersion이 바뀔 때마다 다시 계산되도록 같은 버전에서만 맵을 읽는다.
    const live = liveVersion >= 0 ? generalDragLive : null;
    return buildGroupBoxes(
      groups,
      nodes,
      (node) => live?.get(node.id) ?? { x: node.position.x, y: node.position.y + (yOffsets.get(node.id) ?? 0) },
    );
  }, [groups, nodes, yOffsets, liveVersion]);
  return (
    <>
      {boxes.map((box) => (
        <Fragment key={box.id}>{renderBox(box, groupDropTarget === box.id)}</Fragment>
      ))}
    </>
  );
}
