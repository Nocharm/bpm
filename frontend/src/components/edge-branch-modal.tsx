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
  // EdgeActionModal과 동일한 컨텍스트 팝업 디자인 — 음영 배경 없이 마우스 위치에. position 없으면 중앙 폴백.
  const pos = position ?? { x: 0, y: 0 };
  const { left, top } = clampToViewport(pos.x, pos.y, 176, 132);

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
        className="flex w-44 flex-col rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg"
        style={position ? { position: "fixed", left, top } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-3 pb-0.5 pt-1.5 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("branch.pick")}
        </p>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="flex h-8 w-full items-center px-3 text-left text-caption text-ink hover:bg-surface-alt"
            onClick={() => onPick(kind)}
          >
            {t(`branch.${kind}`)}
          </button>
        ))}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
