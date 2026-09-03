"use client";

// 타일 입력 팝오버 — 클릭한 마우스 위치에 고정(뷰포트 클램프), body 포털 z 1350(모달 1300 위).
// Enter=저장하고 닫기, Esc=저장 없이 닫기, 바깥 클릭=변경이 있으면 저장하고 닫기(없으면 그냥 닫기)
// (사용자 결정 2026-09-03). 푸터 주 버튼은 상태형 — 변경 없음 "Cancel" / 변경 있음 "Save" /
// 메뉴 "Save"로 열어둔 채 적용한 뒤 "Saved". 셰브론 메뉴: Save · Save and close · Close without saving.
// 본문(입력·Σ·원문 메모)은 호출부가 채운다.

import { ChevronDown, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  labels: {
    apply: string; // kbd 안내 동사
    cancel: string;
    save: string;
    saveClose: string;
    closeNoSave: string;
    saved: string;
  };
  // 푸터 맨 앞 슬롯 — 주 버튼과 같은 줄(예: IO 플라이아웃 '+ Add', 사용자 요청 2026-09-03)
  footerStart?: ReactNode;
  children: ReactNode;
}

// 앱 공통 키 칩 표기(node-summary-modal·editor-left-sidebar와 동일 클래스)
const KBD = "rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary";
const MENU_ITEM = "block w-full whitespace-nowrap rounded-sm px-2 py-1 text-left text-caption text-ink hover:bg-surface-alt";

export function SpFieldPopover({
  dataId, anchor, title, hint, width = 320, dirty, onApply, onCommit, onCancel, enterCommits = true, labels,
  footerStart, children,
}: SpFieldPopoverProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.y + 8, left: anchor.x - 16 });
  const [menuOpen, setMenuOpen] = useState(false);
  // "Save"(열어둔 채 적용) 직후 확인 표시 — 다시 고치면 dirty가 돼 자연히 풀린다
  const [savedFlash, setSavedFlash] = useState(false);
  if (dirty && savedFlash) setSavedFlash(false);

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
  const handleOutside = () => (dirty ? onCommit() : onCancel());
  const handlePrimary = () => (dirty ? onCommit() : onCancel());
  const primaryLabel = dirty ? labels.save : savedFlash ? labels.saved : labels.cancel;

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
        onMouseDownCapture={(e) => {
          // 메뉴 바깥(팝오버 안) 클릭이면 메뉴만 닫는다
          if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // 모달 백드롭의 window keydown(Esc=최상위 모달 닫기)까지 가지 않게 — 팝오버만 닫는다
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            if (menuOpen) setMenuOpen(false);
            else onCancel();
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
            aria-label={labels.closeNoSave}
            title={labels.closeNoSave}
            className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onCancel}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {children}
        <div className="flex items-center gap-2 border-t border-divider pt-1.5">
          {footerStart}
          {/* 키 안내 — 바깥 클릭 문구는 생략, 키는 kbd 칩으로 (사용자 요청 2026-09-03) */}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-fine text-ink-tertiary">
            {enterCommits && (
              <span className="inline-flex items-center gap-1">
                <kbd className={KBD}>Enter</kbd>
                {labels.apply}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <kbd className={KBD}>Esc</kbd>
              {labels.cancel}
            </span>
          </span>
          {/* 주 버튼(상태형) + 셰브론 메뉴 — 한 덩어리 스플릿 버튼 */}
          <div ref={menuRef} className="relative flex shrink-0 items-stretch">
            <button
              type="button"
              data-id={`${dataId}-commit`}
              data-state={dirty ? "dirty" : savedFlash ? "saved" : "clean"}
              className={`rounded-l-sm px-2.5 py-1 text-caption ${
                dirty
                  ? "bg-accent text-on-accent hover:bg-accent-focus"
                  : "border border-hairline text-ink hover:bg-surface-alt"
              }`}
              onClick={handlePrimary}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              data-id={`${dataId}-menu-toggle`}
              aria-label="More actions"
              aria-expanded={menuOpen}
              className={`rounded-r-sm px-1 py-1 ${
                dirty
                  ? "border-l border-on-accent/30 bg-accent text-on-accent hover:bg-accent-focus"
                  : "border border-l-0 border-hairline text-ink-secondary hover:bg-surface-alt"
              }`}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <ChevronDown size={14} strokeWidth={1.5} />
            </button>
            {menuOpen && (
              <div
                data-id={`${dataId}-menu`}
                className="absolute bottom-full right-0 z-[1] mb-1 w-max rounded-md border border-hairline bg-surface p-1 shadow-md"
              >
                <button
                  type="button"
                  data-id={`${dataId}-menu-save`}
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    onApply();
                    setSavedFlash(true);
                  }}
                >
                  {labels.save}
                </button>
                <button
                  type="button"
                  data-id={`${dataId}-menu-save-close`}
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    onCommit();
                  }}
                >
                  {labels.saveClose}
                </button>
                <button
                  type="button"
                  data-id={`${dataId}-menu-close`}
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    onCancel();
                  }}
                >
                  {labels.closeNoSave}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
