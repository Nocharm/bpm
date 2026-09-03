// 폴백 원문 힌트 — 대표 필드 옆 아이콘 → 클릭 팝오버(원문 표시·수정·적용).
// 인터뷰 임포트가 남긴 프리텍스트를 보며 대표값을 선정하는 검토 작업 지원 (design 2026-08-19 §5.2).
// body portal + fixed — 카드 overflow 클리핑 회피(SearchSelect 포털 컨벤션).
// 편집 모드 푸터는 공용 PopoverActionBar(상태형 주 버튼 + 메뉴 3종 + kbd 안내) — SP 타일 팝오버와 같은 경험
// (사용자 결정 2026-09-03). 바깥 클릭: 편집 중 변경이 있으면 저장하고 닫기, 아니면 그냥 닫기.
"use client";

import { MessageSquarePlus, MessageSquareText, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { buildPopoverActionLabels, PopoverActionBar } from "@/components/popover-action-bar";
import { useI18n } from "@/lib/i18n";

// 팝오버 폭 — 원문 문장이 두세 줄에 읽히게 (사용자 피드백 2026-09-03: 280은 좁다)
const POPOVER_WIDTH = 360;

interface FallbackHintProps {
  // 폴백 원문 — 비어 있고 편집 불가면 아무것도 렌더하지 않는다
  fallback: string | null | undefined;
  dataId: string;
  // 폴백 텍스트 수정 허용(맵 편집 권한) — 없으면 읽기 전용 팝오버. 있으면 원문이 없어도 "추가" 아이콘을 그린다
  // (새 맵·새 노드에서 작성자가 원문 메모를 남길 진입점, design 2026-09-03 followups §2)
  onSaveFallback?: (text: string) => void;
  // "적용" — 원문을 참고해 대표 필드에 값을 넣는 동작(포커스/프리필)은 부모가 정의
  onApply?: () => void;
  applyLabel?: string;
  // 행머리 스왑 — 주면 평소엔 이 아이콘, 부모 `group` 행 호버 시에만 노트 아이콘으로 바뀐다
  // (인스펙터 원문 메모 행: 우측 버튼 대신 행머리 아이콘이 노트 아이콘으로, 사용자 피드백 2026-09-03)
  restIcon?: LucideIcon;
}

export function FallbackHint({ fallback, dataId, onSaveFallback, onApply, applyLabel, restIcon: RestIcon }: FallbackHintProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const text = (fallback ?? "").trim();
  const isEmpty = text === "";
  if (isEmpty && !editing && !onSaveFallback) return null;
  const dirty = editing && draft.trim() !== text;
  const labels = buildPopoverActionLabels(t);

  const openPopover = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // 우측 정렬 고정폭 — 화면 우측 경계에서 8px 여유
      setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8) });
    }
    // 원문이 없으면 바로 편집 모드 — 빈 팝오버를 한 번 더 클릭할 이유가 없다
    setDraft("");
    setEditing(isEmpty);
    setOpen(true);
  };

  const close = () => {
    setEditing(false);
    setOpen(false);
  };
  // 적용만 — 저장하고 편집 모드에 머문다(주 버튼은 Saved로)
  const apply = () => onSaveFallback?.(draft.trim());
  const commit = () => {
    if (dirty) apply();
    close();
  };
  // 바깥 클릭 — 편집 중 변경이 있으면 저장하고 닫기, 아니면 그냥 닫기
  const handleOutside = () => (dirty ? commit() : close());

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-id={dataId}
        aria-label={isEmpty ? "Add interview note" : "Show original interview note"}
        className={`shrink-0 rounded-sm p-0.5 ${
          RestIcon
            ? "text-ink-tertiary group-hover:text-accent"
            : isEmpty
              ? "text-ink-muted hover:bg-surface-alt hover:text-accent"
              : "text-accent hover:bg-accent-tint"
        }`}
        onClick={() => (open ? handleOutside() : openPopover())}
      >
        {RestIcon && (
          <RestIcon size={14} strokeWidth={1.5} className={open ? "hidden" : "group-hover:hidden"} />
        )}
        {isEmpty ? (
          <MessageSquarePlus
            size={14}
            strokeWidth={1.5}
            className={RestIcon ? (open ? "" : "hidden group-hover:block") : undefined}
          />
        ) : (
          <MessageSquareText
            size={14}
            strokeWidth={1.5}
            className={RestIcon ? (open ? "" : "hidden group-hover:block") : undefined}
          />
        )}
      </button>
      {open && pos !== null &&
        createPortal(
          <>
            {/* 바깥 클릭 닫힘 — 팝오버 뒤 투명 오버레이 */}
            <div className="fixed inset-0 z-[1340]" onMouseDown={handleOutside} />
            <div
              data-id={`${dataId}-popover`}
              className="fixed z-[1350] flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3 shadow-lg"
              style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopPropagation();
                  close();
                  return;
                }
                // 텍스트영역은 ⌘/Ctrl+Enter로 저장하고 닫기(줄바꿈 보존)
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && editing) {
                  e.preventDefault();
                  commit();
                }
              }}
            >
              <div className="text-fine font-semibold text-ink-secondary">{t("sp.tile.note")}</div>
              {editing ? (
                <>
                  <textarea
                    data-id={`${dataId}-edit`}
                    className="w-full resize-y rounded-sm border border-hairline bg-surface-alt px-1.5 py-1 text-caption text-ink focus:outline-none"
                    rows={3}
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <PopoverActionBar
                    dataId={dataId}
                    dirty={dirty}
                    onApply={apply}
                    onCommit={commit}
                    onCancel={close}
                    enterKind="cmd-enter"
                    labels={labels}
                  />
                </>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-caption text-ink">{text}</p>
                  <div className="flex justify-end gap-1.5">
                    {onSaveFallback && (
                      <button
                        type="button"
                        data-id={`${dataId}-edit-btn`}
                        className="rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt"
                        onClick={() => {
                          setDraft(text);
                          setEditing(true);
                        }}
                      >
                        {t("notes.edit")}
                      </button>
                    )}
                    {onApply && (
                      <button
                        type="button"
                        data-id={`${dataId}-apply`}
                        className="rounded-sm bg-accent px-2 py-0.5 text-caption text-on-accent hover:bg-accent-focus"
                        onClick={() => {
                          onApply();
                          close();
                        }}
                      >
                        {applyLabel ?? t("sp.tile.apply")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
