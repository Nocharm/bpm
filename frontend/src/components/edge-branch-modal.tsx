"use client";

// 판단(decision) 노드에서 엣지를 연결할 때 뜨는 분기 선택 — Yes / No / 기타.
// 레이아웃: 헤더(캡션+우상단 X) → 3열 아이콘 타일 → 하단 Cancel 바. (디시전/액션 팝업과 동일 체계)
// 모션: 타일 팝(열림 1회) + 아이콘 — Yes 체크·No 엑스가 그려지고(브랜치 색), Other 점 3개 순차 팝. 정지=최종형.
//   키프레임은 globals.css `.edge-br-*`. hover 시 아이콘 SVG를 replayKey로 리마운트해 재생.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { BranchGlyph } from "@/components/branch-icon";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import type { BranchKind } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

// 분기 타일 — 자체 replay state로 hover 시 아이콘만 재생.
function BranchTile({
  kind,
  label,
  delayMs,
  onPick,
}: {
  kind: BranchKind;
  label: string;
  delayMs: number;
  onPick: (kind: BranchKind) => void;
}) {
  const [replay, setReplay] = useState(0);
  return (
    <button
      type="button"
      className="edge-tile-pop group flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-sm border border-hairline text-caption text-ink transition-colors hover:border-accent hover:bg-accent-tint"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      onMouseEnter={() => setReplay((k) => k + 1)}
      onClick={() => onPick(kind)}
    >
      <BranchGlyph kind={kind} replayKey={replay} />
      {label}
    </button>
  );
}

const KINDS: { kind: BranchKind; delay: number }[] = [
  { kind: "yes", delay: 0 },
  { kind: "no", delay: 60 },
  { kind: "other", delay: 120 },
];

export function EdgeBranchModal({
  onPick,
  onClose,
  position,
}: {
  onPick: (kind: BranchKind) => void;
  onClose: () => void;
  /** 마우스 위치 — 주면 그 자리에(화면 안으로 클램프) 띄운다 (동선 최소화). */
  position?: { x: number; y: number };
}) {
  const { t } = useI18n();
  // 연결 릴리스(pointerup) 직후 따라오는 click이 백드롭에 떨어져 모달이 즉시 닫히는 문제는
  // ModalBackdrop의 mousedown-출처 가드가 처리한다(릴리스 click엔 백드롭 mousedown이 없음).

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // position 없으면 중앙 폴백.
  const pos = position ?? { x: 0, y: 0 };
  const { left, top } = clampToViewport(pos.x, pos.y, 256, 150);

  return createPortal(
    <ModalBackdrop
      className={
        position
          ? "fixed inset-0 z-[1200]"
          : "fixed inset-0 z-[1200] flex items-center justify-center"
      }
      style={{ background: "transparent" }}
      onClose={onClose}
    >
      <div
        data-id="edge-branch-modal"
        className="w-64 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={position ? { position: "fixed", left, top } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("branch.pick")}
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
        <div className="grid grid-cols-3 gap-1.5">
          {KINDS.map(({ kind, delay }) => (
            <BranchTile key={kind} kind={kind} label={t(`branch.${kind}`)} delayMs={delay} onPick={onPick} />
          ))}
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
