"use client";

// 임포트 리포트 미리보기 — 업로드 JSON으로 그린 흐름(lib/interview-preview)을 ScopePreview(경량 SVG)로.
// scope="map"은 행 하나의 L6 흐름(actions/relations), scope="canvas"는 파일 전체의 L5 연계 캔버스.
// 한 번에 하나만 열리고(호출부의 previewCode 단일 상태), 뷰포트는 5노드 높이 고정, 기본 배율은 노드가 읽히는 크기,
// 드래그 팬·휠 줌·+/−/맞춤 버튼 — 서브프로세스 피크와 같은 조작감 (사용자 결정 2026-09-08).

import { AlertTriangle, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/lib/i18n";
import { buildL5PreviewGraph, buildPreviewGraph, layoutPreviewGraph, readPreviewNotices } from "@/lib/interview-preview";
import { usePreviewZoom } from "@/lib/use-preview-zoom";
import { ScopePreview } from "@/components/scope-preview";

const VIEW_HEIGHT = 266; // px — 노드 52 × 5 + 여백 (3배에서 더 키움, 사용자 지시 2026-09-09)

const ZOOM_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-hairline bg-surface/90 text-ink-secondary hover:bg-accent-tint hover:text-accent";

interface ImportMapPreviewProps {
  source: unknown; // scope="map"이면 rows[i], scope="canvas"면 파일 원문 전체
  scope?: "map" | "canvas";
  dataId: string;
  onClose: () => void;
  // true면 우상단 닫기 버튼을 숨긴다 — 항상 펼쳐져 있고 닫을 대상이 없는 임베드(캠페인 연결 단계 등)용.
  hideClose?: boolean;
  // true면 고정 높이(VIEW_HEIGHT) 대신 부모 높이를 다 쓴다 — 캠페인 연결 단계의 큰 L5 미리보기(2026-09-21).
  fill?: boolean;
}

export function ImportMapPreview({ source, scope = "map", dataId, onClose, hideClose = false, fill = false }: ImportMapPreviewProps) {
  const { t } = useI18n();
  const graph = useMemo(() => {
    const built = scope === "canvas" ? buildL5PreviewGraph(source) : buildPreviewGraph(source);
    return built ? layoutPreviewGraph(built) : null;
  }, [source, scope]);
  // 흐름 노티(병행 갈래가 되돌아가기·건너뛰기와 섞여 택일로 접힘 등) — 그림만으로는 안 보여 미리보기 아래에 적는다.
  // 어댑터 경고 미러라 L6 행(scope="map")에만 있다
  const notices = useMemo(() => (scope === "map" ? readPreviewNotices(source) : []), [source, scope]);
  // 첫 배율·시작 노드 스크롤·휠/버튼 줌 — 라이브러리 피크와 같은 훅(lib/use-preview-zoom)
  const { paneRef, zoom, stepZoom, resetZoom } = usePreviewZoom(graph);
  if (!graph) {
    return (
      <p data-id={dataId} className="px-2 py-1 text-fine text-ink-tertiary">
        {t("framework.report.previewEmpty")}
      </p>
    );
  }
  return (
    <>
      <div
        ref={paneRef}
        data-id={dataId}
        className="relative overflow-hidden rounded-sm border border-hairline"
        style={{ height: fill ? "100%" : VIEW_HEIGHT }}
      >
        <ScopePreview
          fullGraph={graph}
          scopeParentId={null}
          zoom={zoom}
          onZoom={stepZoom}
        />
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          <button type="button" aria-label={t("editor.zoomOut")} className={ZOOM_BTN} onClick={() => stepZoom(-1)}>
            <ZoomOut size={12} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label={t("editor.zoomIn")} className={ZOOM_BTN} onClick={() => stepZoom(1)}>
            <ZoomIn size={12} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label={t("framework.report.previewFit")} className={ZOOM_BTN} onClick={resetZoom}>
            <Maximize2 size={12} strokeWidth={1.5} />
          </button>
          {!hideClose && (
            <button
              type="button"
              aria-label={t("framework.report.previewClose")}
              data-id={`${dataId}-close`}
              className={ZOOM_BTN}
              onClick={onClose}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
        <span className="pointer-events-none absolute bottom-1 left-1.5 rounded-sm bg-surface/80 px-1 text-fine text-ink-tertiary">
          {t("framework.report.previewHint")}
        </span>
      </div>
      {notices.length > 0 && (
        <div data-id={`${dataId}-notices`} className="mt-1.5 rounded-sm border border-hairline bg-surface-alt px-2 py-1.5">
          <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
            <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 text-changed" />
            {t("framework.report.previewNotices")}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 pl-[22px]">
            {notices.map((notice, i) => (
              <li key={i} data-id={`${dataId}-notice-${i}`} className="text-fine text-ink-secondary">
                {notice}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
