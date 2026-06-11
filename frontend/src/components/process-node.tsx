"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";

import type { AppNode } from "@/lib/canvas";

// 프로세스 단계 노드 — 좌(입력)/우(출력) 핸들로 선후 연결, 하위 캔버스 보유 시 표시.
export function ProcessNode({ data, selected }: NodeProps<AppNode>) {
  return (
    <div
      className={`min-w-[150px] rounded border bg-white px-3 py-2 text-sm shadow-sm ${
        selected ? "border-blue-500" : "border-zinc-300"
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-medium text-zinc-800">{data.label}</div>
      {data.hasChildren && (
        <div className="mt-0.5 text-xs text-blue-600">▾ 하위 프로세스</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
