"use client";

// 판단(decision) 노드에서 엣지를 연결할 때 뜨는 분기 선택 — Yes / No / 기타.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import type { BranchKind } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

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

  // Esc로 취소
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const kinds: BranchKind[] = ["yes", "no", "other"];
  const cardStyle = position
    ? ({ position: "fixed", ...clampToViewport(position.x, position.y, 288, 96) } as const)
    : undefined;

  return createPortal(
    <ModalBackdrop
      className={
        position
          ? "fixed inset-0 z-[1200]"
          : "fixed inset-0 z-[1200] flex items-center justify-center"
      }
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="w-72 rounded-md bg-surface p-4 shadow-lg"
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-3 text-body-strong text-ink">{t("branch.pick")}</p>
        <div className="flex gap-2">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className="flex-1 rounded-sm border border-hairline px-2 py-2 text-caption text-ink hover:bg-surface-alt"
              onClick={() => onPick(kind)}
            >
              {t(`branch.${kind}`)}
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
