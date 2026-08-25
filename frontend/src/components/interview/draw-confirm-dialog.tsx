"use client";

// Draw map 확인 — 수집 정보 마크다운 서머리 + 승인/보류. 승인 대기 동안 page가 백그라운드
// 선그리기(prefetch)를 돌리므로, 승인 시 이미 완성이면 즉시 제안 모달이 뜬다 (2026-07-30).

import { useEffect } from "react";
import { PenLine } from "lucide-react";

import { MarkdownView } from "@/components/markdown-view";
import { ModalBackdrop } from "@/components/modal-backdrop";

interface DrawConfirmDialogProps {
  summary: string; // buildDrawSummary 산출 마크다운
  onConfirm: () => void;
  onClose: () => void;
}

export function DrawConfirmDialog({ summary, onConfirm, onClose }: DrawConfirmDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 p-6"
      onClose={onClose}
      data-id="iv-draw-confirm"
    >
      <div
        className="iv-pop flex max-h-[80vh] w-[26rem] max-w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <PenLine size={16} strokeWidth={1.5} className="text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-body-strong text-ink">Draw the map now?</h2>
            <p className="text-fine text-ink-muted">
              Based on what we&apos;ve collected - proposals are already being prepared in the background.
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView source={summary} className="text-caption" />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
            data-id="iv-draw-confirm-cancel"
          >
            Not now
          </button>
          <button
            className="rounded-sm bg-accent px-3 py-1.5 text-caption-strong text-on-accent"
            onClick={onConfirm}
            data-id="iv-draw-confirm-go"
          >
            Draw now
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
