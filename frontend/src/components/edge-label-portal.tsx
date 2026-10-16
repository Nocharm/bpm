"use client";

// 연결선 HTML 라벨 포털 — React Flow `EdgeLabelRenderer`와 같은 자리(.react-flow__edgelabel-renderer)에 그린다.
// 원본은 인스턴스마다 스토어가 바뀔 때마다 querySelector로 라벨 층을 다시 찾아, 라벨·전달물 점이 붙은 연결선이 많으면
// 드래그 프레임마다 수백 번 DOM을 뒤졌다(2026-10-16 실측: 120노드 맵 드래그 CPU의 ~10%). 층은 RF 인스턴스(domNode)당
// 한 번만 찾고 domNode만 구독한다. 에디터 연결선(multiline-edge)과 비교 화면 연결선이 쓴다.

import { useStore } from "@xyflow/react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// RF 인스턴스 루트 → 라벨 층. 루트가 바뀌면(다른 캔버스·재마운트) 새로 찾는다
const layerByRoot = new WeakMap<HTMLElement, HTMLElement>();

function findLabelLayer(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const cached = layerByRoot.get(root);
  if (cached?.isConnected) return cached;
  const layer = root.querySelector<HTMLElement>(".react-flow__edgelabel-renderer");
  if (layer) layerByRoot.set(root, layer);
  return layer;
}

export function EdgeLabelPortal({ children }: { children: ReactNode }) {
  const root = useStore((state) => state.domNode);
  const [, setRetry] = useState(0);
  const layer = findLabelLayer(root);
  // 첫 커밋 전엔 라벨 층 div가 아직 DOM에 없을 수 있다 — 다음 프레임에 한 번 더 찾는다(원본은 스토어 갱신마다 재시도)
  useEffect(() => {
    if (layer || !root) return undefined;
    const frame = requestAnimationFrame(() => setRetry((count) => count + 1));
    return () => cancelAnimationFrame(frame);
  }, [layer, root]);
  return layer ? createPortal(children, layer) : null;
}
