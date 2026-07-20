"use client";

// 셀프 게시 확인 팝오버 — 승인자가 본인 1인일 때 승인요청 클릭 지점(마우스 근처)에 뜨는 소형 Yes/No.
// Yes = 승인요청→승인→게시 일괄, No = 기존 승인요청 확인 플로우 계속, 바깥 클릭·Escape = 취소.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

interface SelfPublishPopoverProps {
  /** 클릭 지점 — 이 자리에(화면 안으로 클램프) 띄운다 (동선 최소화). */
  position: { x: number; y: number };
  onYes: () => void;
  onNo: () => void;
  onClose: () => void;
}

export function SelfPublishPopover({ position, onYes, onNo, onClose }: SelfPublishPopoverProps) {
  const { t } = useI18n();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, 256, 112);

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200]"
      style={{ background: "transparent" }}
      onClose={onClose}
    >
      <div
        data-id="self-publish-popover"
        className="w-64 rounded-md border border-hairline bg-surface p-3 shadow-lg"
        style={{ position: "fixed", left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="flex items-center gap-1.5 text-caption-strong text-ink">
          <Upload size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          {t("approval.selfPublishTitle")}
        </p>
        <p className="mt-1 text-caption text-ink-secondary">{t("approval.selfPublishBody")}</p>
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            data-id="self-publish-yes"
            className="flex-1 rounded-sm border border-accent px-2 py-1 text-caption text-accent hover:bg-accent-tint"
            onClick={onYes}
          >
            {t("approval.selfPublishYes")}
          </button>
          <button
            type="button"
            data-id="self-publish-no"
            className="flex-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onNo}
          >
            {t("approval.selfPublishNo")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
