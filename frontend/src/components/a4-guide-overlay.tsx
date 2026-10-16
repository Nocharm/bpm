"use client";

// A4 가이드 — 에디터 캔버스에 "이 폭 안이면 A4 본문에서 노드 글자가 9pt 이상" 경계를 그린다(B안: 왼쪽 끝·9pt 실선, 7pt 점선, 그 사이 옅은 틴트).
// 왼쪽 끝은 PNG 내보내기 프레임과 같은 기준(노드 bounds − 여백)이라 선 안쪽이 그대로 한 장에 담긴다. 폭 계산은 lib/export getA4GuideWidths.
// 에디터(maps/[mapId]/page.tsx) ViewportPortal 안에서만 쓴다 — 플로우 좌표로 그리고 라벨 칩만 줌을 상쇄해 같은 글자 크기로 보인다.

import { useStore } from "@xyflow/react";

import { A4_GUIDE_PADDING_PX, getA4GuideWidths, type PaperOrientation } from "@/lib/export";
import { useI18n } from "@/lib/i18n";

interface A4GuideOverlayProps {
  // 노드 bounds(플로우 좌표) — getNodesBounds
  bounds: { x: number; y: number; width: number; height: number };
  paper: PaperOrientation;
}

const GUIDE_OVERHANG = 40; // 선이 노드 위·아래로 더 뻗는 길이(플로우 px)

export function A4GuideOverlay({ bounds, paper }: A4GuideOverlayProps) {
  const { t } = useI18n();
  const zoom = useStore((state) => state.transform[2]);
  const { readable, minimum, contentWidthCm } = getA4GuideWidths(paper);
  const left = bounds.x - A4_GUIDE_PADDING_PX;
  const top = bounds.y - GUIDE_OVERHANG;
  const height = bounds.height + GUIDE_OVERHANG * 2;
  const line = 1.5 / zoom; // 줌과 무관하게 화면에서 1.5px
  // 라벨 칩 — 선 꼭대기 위에 붙고 줌을 상쇄한다(anchor: 칩의 어느 변을 선에 맞출지)
  const chip = (x: number, text: string, anchor: "start" | "end", muted = false) => (
    <span
      className={`absolute whitespace-nowrap rounded-full border px-2 py-0.5 text-fine font-semibold ${
        muted ? "border-hairline bg-surface text-ink-tertiary" : "border-accent-tint-border bg-accent-tint text-accent"
      }`}
      style={{
        left: x,
        top,
        transform: `translate(${anchor === "end" ? "-100%" : "0"}, -100%) scale(${1 / zoom})`,
        transformOrigin: anchor === "end" ? "right bottom" : "left bottom",
        marginTop: -4 / zoom,
      }}
    >
      {text}
    </span>
  );
  return (
    <div data-id="canvas-a4-guide" className="pointer-events-none absolute left-0 top-0" style={{ zIndex: -1000 }}>
      <div
        className="absolute"
        style={{
          left,
          top,
          width: readable,
          height,
          background: "color-mix(in srgb, var(--color-accent-canvas) 4%, transparent)",
          borderLeft: `${line}px solid var(--color-accent-canvas)`,
          borderRight: `${line}px solid var(--color-accent-canvas)`,
        }}
      />
      <div
        className="absolute"
        style={{
          left: left + minimum,
          top,
          height,
          borderLeft: `${line}px dashed color-mix(in srgb, var(--color-accent-canvas) 55%, transparent)`,
        }}
      />
      {chip(left, t(paper === "portrait" ? "a4Guide.portraitWidth" : "a4Guide.landscapeWidth"), "start")}
      {chip(left + readable, `9pt · ${contentWidthCm.toFixed(1)}cm`, "end")}
      {chip(left + minimum, t("a4Guide.minimum"), "start", true)}
    </div>
  );
}
