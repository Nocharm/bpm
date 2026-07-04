"use client";

// 출력 1개 충돌 시 선택 모달 — 삽입(흐름에 끼움)/교체(기존 대체)/취소. 마우스 위치에 띄워 동선 최소화.
// 바깥 mousedown·Esc로 닫힘(ModalBackdrop). decision 분기는 별도(EdgeBranchModal).
// 레이아웃: 헤더(캡션+우상단 X) → 2열 아이콘 타일(경계·3:2·hover accent) → 하단 Cancel 바. (디시전 팝업과 동일 체계)
// 모션: 타일 팝(열림 1회) + 아이콘 의미 애니메이션 — Insert=흐름 gap에 노드 드롭, Replace=기존 엣지 페이드아웃 + 새 꺾은선 엣지 그려짐.
//   키프레임은 globals.css `.edge-*`. hover 시 아이콘 SVG를 replayKey로 리마운트해 아이콘만 재생. 정지 상태도 완성형(겹침 없음).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { InsertGlyph } from "@/components/flow-glyphs";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

// 강조 포인트(Replace=새로 연결되는 엣지) — 데이터가 아닌 토큰이므로 var 사용. (Insert 글리프는 flow-glyphs 공용)
const ACCENT_STROKE = { stroke: "var(--color-accent)" };

// Replace — [A]—[B] 시작, B 아래 새 노드 C 팝인 → 기존 A—B 엣지 페이드아웃 → 새 꺾은선 엣지 A→C가
// 아래로 나와 왼쪽으로 들어가며 그려짐(강조색=엣지). 정지 상태(애니 없이)도 교체된 최종형으로 깨끗.
function ReplaceAnimIcon({ replayKey }: { replayKey: number }) {
  return (
    <svg
      key={replayKey}
      className="text-ink-tertiary transition-colors group-hover:text-accent"
      width={32}
      height={24}
      viewBox="0 0 40 30"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.5" y="3.5" width="9" height="9" rx="2" />
      <rect x="29.5" y="3.5" width="9" height="9" rx="2" />
      <rect className="edge-repl-node" x="29.5" y="19.5" width="9" height="9" rx="2" />
      <line className="edge-repl-old" x1="10.5" y1="8" x2="29.5" y2="8" />
      <path className="edge-repl-edge" pathLength={1} d="M6 12.5 L6 24 L29.5 24" style={ACCENT_STROKE} />
    </svg>
  );
}

export function EdgeActionModal({
  position,
  onInsert,
  onReplace,
  onClose,
}: {
  position: { x: number; y: number };
  onInsert: () => void;
  onReplace: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // hover 시 해당 아이콘만 재생 — key 증가로 SVG 리마운트.
  const [insertReplay, setInsertReplay] = useState(0);
  const [replaceReplay, setReplaceReplay] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, 240, 176);

  // 경계 있는 3:2 아이콘 타일 — 열림 시 팝(1회), hover 시 accent 보더/틴트/아이콘.
  const tileClass =
    "edge-tile-pop group flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-sm border border-hairline text-caption text-ink transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint";

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-action-modal"
        className="fixed w-60 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("edge.outputConflict")}
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
        {/* Insert(흐름 삽입)는 디시전 Intercept와 사실상 같은 기능이라 같은 2번째 위치로 통일 */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={tileClass}
            onMouseEnter={() => setReplaceReplay((k) => k + 1)}
            onClick={onReplace}
          >
            <ReplaceAnimIcon replayKey={replaceReplay} />
            {t("edge.actionReplace")}
          </button>
          <button
            type="button"
            className={tileClass}
            style={{ animationDelay: "80ms" }}
            onMouseEnter={() => setInsertReplay((k) => k + 1)}
            onClick={onInsert}
          >
            <InsertGlyph replayKey={insertReplay} />
            {t("edge.actionInsert")}
          </button>
        </div>
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center rounded-sm text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
