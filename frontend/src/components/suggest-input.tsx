"use client";

// 단일값 자유입력 + 제안 드롭다운 — 관리 목록(카탈로그) 자동완성 필드의 공용 엔진(역할·시스템).
// 제안은 lib/search filterByQuery 랭킹(부분일치·초성·로마자), ↑↓ 이동·Enter 확정·Esc 되돌림·blur 확정.
// 일치 없으면 입력값 그대로 확정(allowFree). 드롭다운은 body 포털 fixed z-[1400] — 타일 팝오버(1350) 위,
// DataFormPicker와 같은 층. row=인스펙터 행(우측 정렬 w-32) / field=팝오버·폼 전폭.
// 설계: docs/design/2026-09-11-assignee-role-catalog-design.md §3.2

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import { filterByQuery } from "@/lib/search";

interface SuggestInputProps {
  value: string;
  options: readonly string[];
  // 확정 콜백 — 값이 바뀐 경우에만(trim 적용)
  onCommit: (next: string) => void;
  dataId: string;
  placeholder?: string;
  mode?: "row" | "field";
  maxLength?: number;
  // false면 목록 밖 값은 버리고 이전 값으로 되돌린다
  allowFree?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

const DROPDOWN_WIDTH = 224;
const MAX_SUGGESTIONS = 8;
const MARGIN = 8; // 뷰포트 가장자리 최소 여백

// 인스펙터 시스템 입력(page.tsx)과 같은 행 문법 / 모달 팝오버 INPUT_CLASS와 같은 필드 문법
const ROW_CLASS =
  "w-32 min-w-0 truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-right text-caption text-ink placeholder:italic placeholder:text-ink-tertiary focus:border-accent focus:outline-none";
const FIELD_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

export function SuggestInput({
  value, options, onCommit, dataId, placeholder, mode = "field", maxLength = 100, allowFree = true, autoFocus, ariaLabel,
}: SuggestInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  // 바깥 값 변경(다른 노드 선택 등) → 초안 동기화. 편집 중엔 사용자 입력을 지킨다 (렌더 중 상태 조정, effect 아님)
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!open) setDraft(value);
  }

  const hits = open
    ? filterByQuery([...options], draft, (item) => [{ field: "value", text: item }])
        .slice(0, MAX_SUGGESTIONS)
        .map((hit) => hit.item)
    : [];

  const closeMenu = () => {
    setOpen(false);
    setPos(null);
    setHighlight(-1);
  };
  const openMenu = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = mode === "row" ? rect.right - DROPDOWN_WIDTH : rect.left;
    setPos({
      top: rect.bottom + 4,
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - DROPDOWN_WIDTH - MARGIN)),
    });
    setHighlight(-1);
    setOpen(true);
  };
  const commit = (next: string) => {
    const trimmed = next.trim();
    closeMenu();
    setDraft(trimmed);
    if (trimmed !== value.trim()) onCommit(trimmed);
  };
  // Enter/blur — 하이라이트 항목 > 대소문자 무시 정확 일치(표기 정규화) > 자유값 > 되돌림
  const settle = () => {
    if (highlight >= 0 && highlight < hits.length) {
      commit(hits[highlight]);
      return;
    }
    const key = draft.trim().toLocaleLowerCase();
    const exact = options.find((option) => option.toLocaleLowerCase() === key);
    if (exact !== undefined) {
      commit(exact);
      return;
    }
    if (allowFree || key === "") {
      commit(draft);
      return;
    }
    setDraft(value);
    closeMenu();
  };

  // 스크롤·리사이즈로 앵커가 움직이면 닫는다(fixed 좌표 드리프트 방지). 메뉴 자체 스크롤은 예외
  useEffect(() => {
    if (!open) return undefined;
    const close = (event?: Event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
      setPos(null);
      setHighlight(-1);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <input
        ref={inputRef}
        data-id={dataId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${dataId}-menu`}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        className={mode === "row" ? ROW_CLASS : FIELD_CLASS}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        title={mode === "row" && draft !== "" ? draft : undefined}
        onFocus={openMenu}
        onChange={(event) => {
          setDraft(event.target.value);
          setHighlight(-1);
          if (!open) openMenu();
        }}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            if (hits.length === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((current) => (current + delta + hits.length) % hits.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation(); // 팝오버 전역 Enter 확정·모달 submit과 분리
            settle();
          } else if (event.key === "Escape") {
            event.stopPropagation(); // 모달/인스펙터 Esc 닫힘으로 번지지 않게
            setDraft(value);
            closeMenu();
          } else if (event.key === "Tab") {
            closeMenu(); // 포커스 이동의 blur가 settle
          }
        }}
      />
      {open &&
        pos !== null &&
        createPortal(
          <ul
            ref={menuRef}
            id={`${dataId}-menu`}
            data-id={`${dataId}-menu`}
            role="listbox"
            className="fixed z-[1400] max-h-56 overflow-y-auto rounded-sm border border-hairline bg-surface py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
          >
            {hits.map((item, index) => (
              <li key={item} role="option" aria-selected={highlight === index}>
                <button
                  type="button"
                  data-id={`${dataId}-option-${index}`}
                  className={`flex w-full items-center px-2 py-1 text-left text-caption ${
                    highlight === index ? "bg-accent-tint text-accent" : "text-ink hover:bg-surface-alt"
                  }`}
                  // mousedown + preventDefault — 포커스가 안 움직여 blur(settle)가 안 나고, 여기서만 확정
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(item);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="min-w-0 truncate">{item}</span>
                </button>
              </li>
            ))}
            {hits.length === 0 && (
              <li className="px-2 py-1 text-fine text-ink-tertiary">
                {t(allowFree ? "suggest.noMatchFree" : "suggest.noMatch")}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </>
  );
}
