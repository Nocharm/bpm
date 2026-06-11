// 캔버스 PNG 내보내기 — React Flow 공식 권장 방식(html-to-image) (spec §7 Phase B).

import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";

const PADDING_PX = 50; // 노드 경계 바깥 여백
const MIN_SIZE_PX = 400;
const MAX_SIZE_PX = 4096; // 브라우저 캔버스 크기 한계 보호

/** 전체 노드 bounds 기준으로 현재 캔버스를 PNG 파일로 저장한다. */
export async function exportCanvasPng(
  nodes: Node[],
  fileName: string,
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport || nodes.length === 0) {
    return;
  }
  const bounds = getNodesBounds(nodes);
  const width = Math.min(
    Math.max(Math.ceil(bounds.width) + PADDING_PX * 2, MIN_SIZE_PX),
    MAX_SIZE_PX,
  );
  const height = Math.min(
    Math.max(Math.ceil(bounds.height) + PADDING_PX * 2, MIN_SIZE_PX),
    MAX_SIZE_PX,
  );
  const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 0.1);

  const dataUrl = await toPng(viewport, {
    backgroundColor: "#ffffff",
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
    },
  });

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}
