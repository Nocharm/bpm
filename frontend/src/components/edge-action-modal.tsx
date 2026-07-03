"use client";

// 출력 1개 충돌 시 선택 모달 — 삽입(흐름에 끼움)/교체(기존 대체)/취소. 마우스 위치에 띄워 동선 최소화.
// 바깥 mousedown·Esc로 닫힘(ModalBackdrop). decision 분기는 별도(EdgeBranchModal).

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, 180, 132);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-action-modal"
        className="fixed flex w-44 flex-col rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-3 pb-0.5 pt-1.5 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("edge.outputConflict")}
        </p>
        <button
          type="button"
          className="flex h-8 w-full items-center px-3 text-left text-caption text-ink hover:bg-surface-alt"
          onClick={onInsert}
        >
          {t("edge.actionInsert")}
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center px-3 text-left text-caption text-ink hover:bg-surface-alt"
          onClick={onReplace}
        >
          {t("edge.actionReplace")}
        </button>
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
