"use client";

// 타일 입력 팝오버 — 클릭한 마우스 위치에 고정(뷰포트 클램프), body 포털 z 1350(모달 1300 위).
// Enter=확정, 바깥 클릭=확정, Esc=취소 (사용자 결정 2026-09-03). 본문(입력·Σ·원문 메모)은 호출부가 채운다.

import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SpFieldPopoverProps {
  dataId: string;
  anchor: { x: number; y: number };
  title: string;
  hint?: string;
  width?: number;
  onCommit: () => void;
  onCancel: () => void;
  // 다중 줄 편집기(IO)는 Enter가 줄 추가라 전역 Enter 확정을 끈다
  enterCommits?: boolean;
  keysHint: string;
  // 푸터 맨 앞 슬롯 — OK와 같은 줄(예: IO 플라이아웃 '+ Add', 사용자 요청 2026-09-03)
  footerStart?: ReactNode;
  children: ReactNode;
}

export function SpFieldPopover({
  dataId, anchor, title, hint, width = 320, onCommit, onCancel, enterCommits = true, keysHint, footerStart, children,
}: SpFieldPopoverProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.y + 8, left: anchor.x - 16 });

  // 실측 후 뷰포트 안으로 — 아래가 모자라면 위로, 오른쪽이 모자라면 왼쪽으로
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x - 16;
    let top = anchor.y + 8;
    if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - rect.width - margin);
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, anchor.y - rect.height - 8);
    setPos({ top, left });
    // 첫 입력에 포커스 — 타일 클릭 즉시 타이핑
    const first = el.querySelector<HTMLElement>("input, textarea");
    first?.focus();
  }, [anchor.x, anchor.y]);

  return createPortal(
    <>
      <div data-id={`${dataId}-overlay`} className="fixed inset-0 z-[1340]" onMouseDown={onCommit} />
      <div
        ref={boxRef}
        data-id={dataId}
        role="dialog"
        aria-label={title}
        className="fixed z-[1350] flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3 shadow-lg"
        style={{ top: pos.top, left: pos.left, width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // 모달 백드롭의 window keydown(Esc=최상위 모달 닫기)까지 가지 않게 — 팝오버만 닫는다
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            onCancel();
            return;
          }
          if (e.key !== "Enter") return;
          const target = e.target as HTMLElement;
          const inTextarea = target.tagName === "TEXTAREA";
          // 텍스트영역은 Cmd/Ctrl+Enter로만 확정(줄바꿈 보존), 단일 입력은 Enter 확정
          if ((inTextarea && (e.metaKey || e.ctrlKey)) || (!inTextarea && enterCommits)) {
            e.preventDefault();
            onCommit();
          }
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-caption-strong text-ink">{title}</div>
            {hint && <p className="mt-0.5 text-fine text-ink-tertiary">{hint}</p>}
          </div>
          <button
            type="button"
            data-id={`${dataId}-cancel`}
            aria-label="Cancel"
            className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onCancel}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {children}
        <div className="flex items-center gap-2 border-t border-divider pt-1.5">
          {footerStart}
          <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{keysHint}</span>
          <button
            type="button"
            data-id={`${dataId}-commit`}
            className="rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
            onClick={onCommit}
          >
            OK
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
