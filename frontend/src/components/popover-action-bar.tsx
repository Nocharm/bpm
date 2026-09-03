"use client";

// 소형 입력 팝오버 공용 푸터 — kbd 키 안내 + 상태형 주 버튼(변경 없음 Cancel / 변경 있음 Save /
// 메뉴 "Save"로 열어둔 채 적용 뒤 Saved) + 셰브론 메뉴(Save · Save and close · Close without saving).
// 셰브론은 변경이 있을 때만 붙고(취소 상태는 버튼 하나), 상태 전환은 폭·색 트랜지션 + 라벨 페이드로
// 잇는다 (사용자 결정 2026-09-03). SP 타일 팝오버·인터뷰 원문 메모 팝오버·노트 폼이 공유한다.

import { ChevronDown } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

export interface PopoverActionLabels {
  apply: string; // kbd 안내 동사
  cancel: string;
  save: string;
  saveClose: string;
  closeNoSave: string;
  saved: string;
}

interface PopoverActionBarProps {
  dataId: string;
  dirty: boolean;
  // 적용만(열어둔 채) / 적용+닫기 / 폐기+닫기
  onApply: () => void;
  onCommit: () => void;
  onCancel: () => void;
  // 키 안내 — 단일 입력은 Enter, 텍스트영역은 ⌘/Ctrl+Enter, 다중 줄 편집기는 없음
  enterKind?: "enter" | "cmd-enter" | "none";
  labels: PopoverActionLabels;
  // 푸터 맨 앞 슬롯 — 주 버튼과 같은 줄(예: IO 플라이아웃 '+ Add')
  footerStart?: ReactNode;
}

// 앱 공통 키 칩 표기(node-summary-modal·editor-left-sidebar와 동일 클래스)
const KBD = "rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary";
const MENU_ITEM = "block w-full whitespace-nowrap rounded-sm px-2 py-1 text-left text-fine text-ink hover:bg-surface-alt";

export function PopoverActionBar({
  dataId, dirty, onApply, onCommit, onCancel, enterKind = "enter", labels, footerStart,
}: PopoverActionBarProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Save"(열어둔 채 적용) 직후 확인 표시 — 다시 고치면 dirty가 돼 자연히 풀린다
  const [savedFlash, setSavedFlash] = useState(false);
  if (dirty && savedFlash) setSavedFlash(false);
  // 변경이 사라지면(적용·되돌림) 메뉴도 함께 접는다 — 셰브론이 없는 상태에 메뉴만 남지 않게
  if (!dirty && menuOpen) setMenuOpen(false);

  const primaryLabel = dirty ? labels.save : savedFlash ? labels.saved : labels.cancel;

  return (
    <div
      className="flex items-center gap-2 border-t border-divider pt-1.5"
      onMouseDownCapture={(e) => {
        // 메뉴 바깥(푸터 안) 클릭이면 메뉴만 닫는다
        if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      }}
    >
      {footerStart}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-fine text-ink-tertiary">
        {enterKind === "enter" && (
          <span className="inline-flex items-center gap-1">
            <kbd className={KBD}>Enter</kbd>
            {labels.apply}
          </span>
        )}
        {enterKind === "cmd-enter" && (
          <span className="inline-flex items-center gap-1">
            <kbd className={KBD}>⌘/Ctrl</kbd>
            <kbd className={KBD}>Enter</kbd>
            {labels.apply}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <kbd className={KBD}>Esc</kbd>
          {labels.cancel}
        </span>
      </span>
      {/* 주 버튼(상태형) + 셰브론 — 변경이 있을 때만 셰브론이 폭 트랜지션으로 열리는 스플릿 버튼 */}
      <div ref={menuRef} className="relative flex shrink-0 items-stretch">
        <button
          type="button"
          data-id={`${dataId}-commit`}
          data-state={dirty ? "dirty" : savedFlash ? "saved" : "clean"}
          className={`rounded-sm border px-2 py-0.5 text-fine transition-[background-color,border-color,color,border-radius] duration-150 ease-smooth ${
            dirty
              ? "rounded-r-none border-accent bg-accent text-on-accent hover:bg-accent-focus"
              : "border-hairline text-ink hover:bg-surface-alt"
          }`}
          onClick={() => (dirty ? onCommit() : onCancel())}
        >
          {/* 라벨 교체 시 페이드 — key로 리마운트해 진입 애니메이션 재생 */}
          <span key={primaryLabel} className="inline-block animate-item-in">
            {primaryLabel}
          </span>
        </button>
        <button
          type="button"
          data-id={`${dataId}-menu-toggle`}
          aria-label="More actions"
          aria-expanded={menuOpen}
          aria-hidden={!dirty}
          tabIndex={dirty ? 0 : -1}
          className={`flex items-center justify-center overflow-hidden rounded-r-sm border border-l-0 border-accent bg-accent text-on-accent transition-[width,opacity] duration-150 ease-smooth hover:bg-accent-focus ${
            dirty ? "w-5 opacity-100" : "pointer-events-none w-0 border-0 opacity-0"
          }`}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <ChevronDown size={13} strokeWidth={1.5} className="shrink-0" />
        </button>
        {menuOpen && dirty && (
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
  );
}

// 호출부 공용 라벨 조립 — i18n t()를 받아 한 번에 만든다
export function buildPopoverActionLabels(t: (key: PopoverLabelKey) => string): PopoverActionLabels {
  return {
    apply: t("sp.tile.apply"),
    cancel: t("common.cancel"),
    save: t("sp.tile.save"),
    saveClose: t("sp.tile.saveClose"),
    closeNoSave: t("sp.tile.closeNoSave"),
    saved: t("sp.tile.saved"),
  };
}

export type PopoverLabelKey =
  | "sp.tile.apply"
  | "common.cancel"
  | "sp.tile.save"
  | "sp.tile.saveClose"
  | "sp.tile.closeNoSave"
  | "sp.tile.saved";
