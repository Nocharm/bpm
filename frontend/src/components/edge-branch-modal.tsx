"use client";

// 판단(decision) 노드에서 엣지를 연결할 때 뜨는 분기 선택 — Yes / No / 기타.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { BranchKind } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

export function EdgeBranchModal({
  onPick,
  onClose,
}: {
  onPick: (kind: BranchKind) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

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

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="w-72 rounded-md bg-surface p-4 shadow-lg"
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
    </div>,
    document.body,
  );
}
