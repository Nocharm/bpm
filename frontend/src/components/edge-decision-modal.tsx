"use client";

// 디시전 노드에 노드를 드롭(출력 ≥1)했을 때 선택 모달 — 분기 만들기 / 인터셉트 / 취소 (F1).
// 분기=새 출력선(yes/no/기타 라벨), 인터셉트=기존 출력선 하나에 끼워넣기. 마우스 위치 팝업.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GitBranch, CornerDownRight } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

export function EdgeDecisionModal({
  position,
  onBranch,
  onIntercept,
  onClose,
}: {
  position: { x: number; y: number };
  onBranch: () => void;
  onIntercept: () => void;
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

  const { left, top } = clampToViewport(position.x, position.y, 200, 132);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-decision-modal"
        className="fixed flex w-48 flex-col rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-3 pb-0.5 pt-1.5 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("edge.decisionPrompt")}
        </p>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 text-left text-caption text-ink hover:bg-surface-alt"
          onClick={onBranch}
        >
          <GitBranch size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          {t("edge.actionBranch")}
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 text-left text-caption text-ink hover:bg-surface-alt"
          onClick={onIntercept}
        >
          <CornerDownRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          {t("edge.actionIntercept")}
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
