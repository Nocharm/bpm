// 링크 항목의 연결 노드 드롭다운 — 읽기전용 모드에서 링크 IO 클릭 시(#2). 행 호버=해당 노드
// 하이라이트, 클릭=그 노드로 이동·포커스. EdgeSelectModal 크롬 축소판(백드롭 mousedown 닫힘+Esc).
"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

export interface IoPeerItem {
  nodeId: string;
  label: string;
  // 상대 항목이 속한 측 — 행 우측 보조 라벨
  side: "input" | "output";
}

interface IoPeersMenuProps {
  position: { x: number; y: number };
  items: IoPeerItem[];
  onHoverPeer?: (nodeId: string | null) => void;
  onPick: (nodeId: string) => void;
  onClose: () => void;
}

export function IoPeersMenu({ position, items, onHoverPeer, onPick, onClose }: IoPeersMenuProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closeAndClear = () => {
    onHoverPeer?.(null);
    onClose();
  };

  const listH = Math.min(items.length * 30, 120);
  const { left, top } = clampToViewport(position.x, position.y, 224, 40 + listH);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1350]" style={{ background: "transparent" }} onClose={closeAndClear}>
      <div
        data-id="io-peers-menu"
        className="fixed w-56 rounded-md border border-hairline bg-surface p-1.5 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-1 pb-1 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
          {t("io.peersTitle")}
        </p>
        <div className="scrollbar-hidden flex max-h-[120px] flex-col gap-0.5 overflow-y-auto">
          {items.map((item) => (
            <button
              key={`${item.nodeId}-${item.side}`}
              type="button"
              data-id={`io-peers-row-${item.nodeId}`}
              className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-caption text-ink hover:bg-accent-tint"
              onMouseEnter={() => onHoverPeer?.(item.nodeId)}
              onMouseLeave={() => onHoverPeer?.(null)}
              onClick={() => {
                onHoverPeer?.(null);
                onPick(item.nodeId);
              }}
            >
              <Link2 size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-fine text-ink-tertiary">
                {item.side === "input" ? t("field.input") : t("field.output")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
