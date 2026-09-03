"use client";

// 타일 입력 팝오버 — 클릭한 마우스 위치에 고정(뷰포트 클램프), body 포털 z 1350(모달 1300 위).
// Enter=저장하고 닫기, Esc=저장 없이 닫기, 바깥 클릭=변경이 있으면 저장하고 닫기(없으면 그냥 닫기)
// (사용자 결정 2026-09-03). 푸터는 공용 PopoverActionBar(상태형 주 버튼 + 메뉴 3종 + kbd 안내).
// readOnly: 목록을 클릭해야만 볼 수 있는 항목(입출력)의 열람용 — 액션 바 없이 Esc·닫기만
// (사용자 결정 2026-09-03). 본문(입력·Σ·원문 메모)은 호출부가 채운다.

import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { PopoverActionBar, type PopoverActionLabels } from "@/components/popover-action-bar";

interface SpFieldPopoverProps {
  dataId: string;
  anchor: { x: number; y: number };
  title: string;
  hint?: string;
  width?: number;
  // 초안이 확정값과 다른지 — 주 버튼 라벨·바깥 클릭 동작을 정한다
  dirty: boolean;
  // 적용만(열어둔 채) / 적용+닫기 / 폐기+닫기
  onApply: () => void;
  onCommit: () => void;
  onCancel: () => void;
  // 다중 줄 편집기(IO)는 Enter가 줄 추가라 전역 Enter 확정을 끈다 — 키 안내에서도 Enter가 빠진다
  enterCommits?: boolean;
  labels: PopoverActionLabels;
  // 푸터 맨 앞 슬롯 — 주 버튼과 같은 줄(예: IO 플라이아웃 '+ Add', 사용자 요청 2026-09-03)
  footerStart?: ReactNode;
  // 열람 전용 — 액션 바 대신 닫기 버튼, Enter/Esc/바깥 클릭 모두 닫기
  readOnly?: boolean;
  closeLabel?: string;
  children: ReactNode;
}

const KBD = "rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary";

export function SpFieldPopover({
  dataId, anchor, title, hint, width = 320, dirty, onApply, onCommit, onCancel, enterCommits = true, labels,
  footerStart, readOnly = false, closeLabel, children,
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

  // 바깥 클릭 — 변경이 있으면 저장하고 닫기, 없으면 그냥 닫기(사용자 확인 2026-09-03)
  const handleOutside = () => (dirty && !readOnly ? onCommit() : onCancel());

  return createPortal(
    <>
      <div data-id={`${dataId}-overlay`} className="fixed inset-0 z-[1340]" onMouseDown={handleOutside} />
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
          if (readOnly) {
            e.preventDefault();
            onCancel();
            return;
          }
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
            aria-label={readOnly ? closeLabel ?? labels.cancel : labels.closeNoSave}
            title={readOnly ? closeLabel ?? labels.cancel : labels.closeNoSave}
            className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onCancel}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {children}
        {readOnly ? (
          <div className="flex items-center justify-between gap-2 border-t border-divider pt-1.5">
            <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary">
              <kbd className={KBD}>Esc</kbd>
              {closeLabel ?? labels.cancel}
            </span>
            <button
              type="button"
              data-id={`${dataId}-close`}
              className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={onCancel}
            >
              {closeLabel ?? labels.cancel}
            </button>
          </div>
        ) : (
          <PopoverActionBar
            dataId={dataId}
            dirty={dirty}
            onApply={onApply}
            onCommit={onCommit}
            onCancel={onCancel}
            enterKind={enterCommits ? "enter" : "none"}
            labels={labels}
            footerStart={footerStart}
          />
        )}
      </div>
    </>,
    document.body,
  );
}
