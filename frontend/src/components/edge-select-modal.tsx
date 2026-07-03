"use client";

// 다중 출력 노드에 삽입 시 — 어느 출력선으로 들어갈지 선택 (F1). 라벨="엣지라벨 → 다음노드".
// 마우스 위치 컨텍스트 팝업(투명 배경, 바깥 mousedown·Esc 닫힘).

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

export function EdgeSelectModal({
  position,
  options,
  onPick,
  onClose,
}: {
  position: { x: number; y: number };
  options: { edgeId: string; label: string }[];
  onPick: (edgeId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, 224, 56 + options.length * 32);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-select-modal"
        className="fixed flex w-56 flex-col rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-3 pb-0.5 pt-1.5 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("edge.selectOutput")}
        </p>
        {options.map((option) => (
          <button
            key={option.edgeId}
            type="button"
            className="flex h-8 w-full items-center truncate px-3 text-left text-caption text-ink hover:bg-surface-alt"
            onClick={() => onPick(option.edgeId)}
          >
            {option.label}
          </button>
        ))}
        <hr className="my-1 border-t border-divider" />
        <button
          type="button"
          className="flex h-8 w-full items-center px-3 text-left text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
