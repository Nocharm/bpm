"use client";

// 캔버스 줌 컨트롤 pill — 우하단(구 단축키 버튼 자리). 축소 / 현재 배율 / 확대 + 화면 맞춤(좌상단 정렬 fit).
// leading: 줌 필 왼쪽에 나란히 놓는 보조 컨트롤(노드 표시 정보 플로팅 버튼 등).
import { useReactFlow, useViewport } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

export function CanvasZoomScale({ onFit, leading }: { onFit: () => void; leading?: ReactNode }) {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut } = useReactFlow();
  const { t } = useI18n();
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-end gap-2 select-none">
      {leading}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-hairline bg-surface p-1 shadow-md">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-alt"
          onClick={() => zoomOut()}
          title={t("editor.zoomOut")}
          aria-label={t("editor.zoomOut")}
        >
          <Minus size={16} strokeWidth={1.5} />
        </button>
        <span className="min-w-[3rem] text-center text-caption tabular-nums text-ink">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-alt"
          onClick={() => zoomIn()}
          title={t("editor.zoomIn")}
          aria-label={t("editor.zoomIn")}
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-divider" />
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-alt"
          onClick={onFit}
          title={t("editor.fitView")}
          aria-label={t("editor.fitView")}
        >
          <Maximize size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
