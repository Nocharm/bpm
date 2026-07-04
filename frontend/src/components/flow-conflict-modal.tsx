"use client";

// 입력이 있는 노드 앞에 다른 노드를 추가할 때 — 기존 연결 유지(Keep) / 사이에 삽입(Insert between) 선택.
// 노드 아래 앵커(absolute, 캔버스 컨테이너 기준). 헤더 캡션+우상단 X, 2 아이콘 타일(디시전/액션과 동일 체계).
// 모션: 타일 팝(열림 1회) + 아이콘 의미 애니(Keep=새 엣지 합류, Insert=흐름 gap 껴듦). hover 시 아이콘만 재생.

import { useState } from "react";
import { X } from "lucide-react";

import { InsertGlyph, KeepGlyph } from "@/components/flow-glyphs";
import { useI18n } from "@/lib/i18n";

const TILE_CLASS =
  "edge-tile-pop group flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-sm border border-hairline text-caption text-ink transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint";

export function FlowConflictModal({
  rect,
  onKeep,
  onInsertBetween,
  onClose,
}: {
  rect: { left: number; top: number; height: number };
  onKeep: () => void;
  onInsertBetween: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // hover 시 해당 아이콘만 재생.
  const [keepReplay, setKeepReplay] = useState(0);
  const [insertReplay, setInsertReplay] = useState(0);

  return (
    <div
      data-id="flow-conflict-modal"
      className="absolute z-[1110] w-60 rounded-md border border-hairline bg-surface p-2 shadow-lg"
      style={{ left: rect.left, top: rect.top + rect.height + 8 }}
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("dropzone.conflictPrompt")}
        </span>
        <button
          type="button"
          aria-label={t("summary.close")}
          title={t("summary.close")}
          className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
          onClick={onClose}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className={TILE_CLASS}
          onMouseEnter={() => setKeepReplay((k) => k + 1)}
          onClick={onKeep}
        >
          <KeepGlyph replayKey={keepReplay} />
          {t("dropzone.keep")}
        </button>
        <button
          type="button"
          className={TILE_CLASS}
          style={{ animationDelay: "80ms" }}
          onMouseEnter={() => setInsertReplay((k) => k + 1)}
          onClick={onInsertBetween}
        >
          <InsertGlyph replayKey={insertReplay} />
          {t("dropzone.insert")}
        </button>
      </div>
    </div>
  );
}
