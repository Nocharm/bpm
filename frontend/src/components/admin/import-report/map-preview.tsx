"use client";

// 맵 행 미리보기 — 업로드 JSON의 actions/relations로 그린 L6 흐름(lib/interview-preview)을 ScopePreview(경량 SVG)로.
// 한 번에 하나만 열리고(호출부의 previewCode 단일 상태), 뷰포트는 1.5노드 높이 고정, 기본 배율은 노드가 읽히는 크기,
// 드래그 팬·휠 줌·+/−/맞춤 버튼 — 서브프로세스 피크와 같은 조작감 (사용자 결정 2026-09-08).

import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { VersionGraph } from "@/lib/api";
import { NODE_HEIGHT, nodeSizeOf, normalizeNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { buildPreviewGraph, layoutPreviewGraph } from "@/lib/interview-preview";
import { ScopePreview } from "@/components/scope-preview";

const VIEW_HEIGHT = 84; // px — 노드 52 × 1.5 + 여백
const VIEW_PAD = 40; // ScopePreview의 viewBox 패딩과 동일
const TARGET_NODE_PX = 44; // 기본 배율에서 process 노드가 보이는 높이
const ZOOM_MIN = 1;
const ZOOM_MAX = 6; // 분기가 여러 줄인 흐름도 노드가 읽히는 배율까지
const ZOOM_STEP = 0.25;

// 그래프 높이 기준(LR 흐름은 높이가 병목) process 노드가 TARGET_NODE_PX로 보이는 배율 — 0.25 단위, [1, 4] 클램프
function fitZoom(graph: VersionGraph): number {
  const tops = graph.nodes.map((n) => n.pos_y);
  const bottoms = graph.nodes.map((n) => n.pos_y + nodeSizeOf(normalizeNodeType(n.node_type)).h);
  const height = Math.max(...bottoms) + VIEW_PAD - (Math.min(...tops) - VIEW_PAD);
  const scaleAtOne = VIEW_HEIGHT / Math.max(1, height);
  const target = TARGET_NODE_PX / (NODE_HEIGHT * scaleAtOne);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(target * 4) / 4));
}

const ZOOM_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-hairline bg-surface/90 text-ink-secondary hover:bg-accent-tint hover:text-accent";

export function ImportMapPreview({ row, dataId, onClose }: { row: unknown; dataId: string; onClose: () => void }) {
  const { t } = useI18n();
  const graph = useMemo(() => {
    const built = buildPreviewGraph(row);
    return built ? layoutPreviewGraph(built) : null;
  }, [row]);
  const [zoom, setZoom] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 기본 배율이 1보다 크면 SVG가 컨테이너보다 커서 좌상단 빈 여백부터 보인다 — 마운트 시 Start 노드가 왼쪽에,
  // 그 행이 세로 중앙에 오도록 스크롤(LR 흐름은 시작부터 읽는다). viewBox↔px 환산은 meet 정렬(가운데 여백) 포함.
  // ScopePreview는 배율 변화 때만 기준점을 보정하므로 첫 시야는 여기서 잡는다.
  useLayoutEffect(() => {
    const pane = wrapRef.current?.querySelector<HTMLElement>('[data-id="scope-preview-pane"]');
    const svg = pane?.querySelector("svg");
    if (!pane || !svg || !graph) return;
    const start = graph.nodes.find((n) => n.node_type === "start") ?? graph.nodes[0];
    const size = nodeSizeOf(normalizeNodeType(start.node_type));
    const box = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || rect.width === 0) return;
    const scale = Math.min(rect.width / box.width, rect.height / box.height);
    const offsetX = (rect.width - box.width * scale) / 2;
    const offsetY = (rect.height - box.height * scale) / 2;
    const startLeft = offsetX + (start.pos_x - box.x) * scale;
    const startCenterY = offsetY + (start.pos_y + size.h / 2 - box.y) * scale;
    pane.scrollLeft = Math.max(0, startLeft - 16);
    pane.scrollTop = Math.max(0, startCenterY - pane.clientHeight / 2);
  }, [graph]);
  if (!graph) {
    return (
      <p data-id={dataId} className="px-2 py-1 text-fine text-ink-tertiary">
        {t("framework.report.previewEmpty")}
      </p>
    );
  }
  const initial = fitZoom(graph);
  const current = zoom ?? initial;
  const applyZoom = (next: number): number => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
    setZoom(clamped);
    return clamped;
  };
  return (
    <div
      ref={wrapRef}
      data-id={dataId}
      className="relative overflow-hidden rounded-sm border border-hairline"
      style={{ height: VIEW_HEIGHT }}
    >
      <ScopePreview
        fullGraph={graph}
        scopeParentId={null}
        zoom={current}
        onZoom={(direction) => applyZoom(current + direction * ZOOM_STEP)}
      />
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        <button type="button" aria-label={t("editor.zoomOut")} className={ZOOM_BTN} onClick={() => applyZoom(current - ZOOM_STEP)}>
          <ZoomOut size={12} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label={t("editor.zoomIn")} className={ZOOM_BTN} onClick={() => applyZoom(current + ZOOM_STEP)}>
          <ZoomIn size={12} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label={t("framework.report.previewFit")} className={ZOOM_BTN} onClick={() => setZoom(null)}>
          <Maximize2 size={12} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={t("framework.report.previewClose")}
          data-id={`${dataId}-close`}
          className={ZOOM_BTN}
          onClick={onClose}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      <span className="pointer-events-none absolute bottom-1 left-1.5 rounded-sm bg-surface/80 px-1 text-fine text-ink-tertiary">
        {t("framework.report.previewHint")}
      </span>
    </div>
  );
}
