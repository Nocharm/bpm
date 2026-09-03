// IO 항목별 데이터 폼 피커 — 평소엔 값 필(비활성 표시)/행 호버 시 지정 아이콘, 편집 시
// 자동완성 드롭다운(확장자·영문·한글 유사도 매치, 방향키 이동·Enter/Space 선택,
// 무일치 자유값은 "추가" 행으로만 확정) (사용자 결정 2026-08-20). 드롭다운은 body portal
// (fixed) — 인스펙터 overflow 클리핑 회피(SearchSelect 컨벤션).
"use client";

import { FileType, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { matchExactDataForm, resolveDataForm, searchDataForms } from "@/lib/data-forms";
import { useI18n } from "@/lib/i18n";

interface DataFormPickerProps {
  // 현재 폼 값 — ""=미지정(행 호버 시 지정 아이콘만)
  value: string;
  dataId: string;
  // 확정 콜백 — 선택/추가는 값, 필 ×는 "" (부모가 행 폼을 갱신·커밋)
  onCommit: (next: string) => void;
  // 열 모드 — IO 행의 '형식' 열(고정 폭)로 놓일 때: 필은 고정 폭, 미지정도 점선 자리표시 필이 항상 보인다
  // (사용자 요청 2026-09-03: 인덱스/형식/라벨 열 할당)
  column?: boolean;
}

const DROPDOWN_WIDTH = 224;
// 열 모드 필 폭 — 행마다 같은 자리에 정렬 (MultiValueInput의 정적 FormPill과 동기)
export const DATA_FORM_COLUMN_WIDTH = "w-[5.5rem]";

export function DataFormPicker({ value, dataId, onCommit, column = false }: DataFormPickerProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // Space 선택은 방향키로 명시 탐색한 뒤에만 — 자유값 타이핑의 공백 입력과 충돌 방지
  const [navigated, setNavigated] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const options = editing ? searchDataForms(query) : [];
  const trimmed = query.trim();
  const hasCustomRow = trimmed !== "" && matchExactDataForm(trimmed) === null;
  const rowCount = options.length + (hasCustomRow ? 1 : 0);

  const openEditor = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH - 8),
    });
    setQuery("");
    setHighlight(0);
    setNavigated(false);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setPos(null);
  };

  const select = (index: number) => {
    if (index < options.length) {
      onCommit(options[index].value);
    } else if (hasCustomRow) {
      onCommit(trimmed);
    } else {
      return;
    }
    close();
  };

  if (editing) {
    return (
      <>
        <input
          ref={inputRef}
          data-id={dataId}
          autoFocus // 아이콘 클릭으로 연 즉시 타이핑 흐름
          className="w-[5.5rem] shrink-0 rounded-sm border border-accent bg-surface px-1.5 py-0.5 text-fine text-ink-secondary placeholder:italic placeholder:text-ink-tertiary focus:outline-none"
          value={query}
          placeholder={t("detail.formPlaceholder")}
          maxLength={50}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setNavigated(false);
          }}
          onBlur={close}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (rowCount === 0) return;
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => (h + delta + rowCount) % rowCount);
              setNavigated(true);
            } else if (e.key === "Enter" || (e.key === " " && navigated)) {
              e.preventDefault();
              select(highlight);
            } else if (e.key === "Escape") {
              e.stopPropagation(); // 모달/인스펙터 Esc 닫힘으로 번지지 않게
              close();
            }
          }}
        />
        {pos !== null &&
          createPortal(
            <ul
              data-id={`${dataId}-menu`}
              className="fixed z-[1400] max-h-56 overflow-y-auto rounded-sm border border-hairline bg-surface py-1 shadow-lg"
              style={{ top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
            >
              {options.map((option, i) => {
                const Icon = option.icon;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      data-id={`${dataId}-option-${option.value}`}
                      className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-caption text-ink ${
                        highlight === i ? "bg-accent-tint text-accent" : "hover:bg-surface-alt"
                      }`}
                      // mousedown — input blur(close)보다 먼저 확정
                      onMouseDown={(e) => {
                        e.preventDefault();
                        select(i);
                      }}
                      onMouseEnter={() => setHighlight(i)}
                    >
                      <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                      <span className="min-w-0 truncate">{option.value}</span>
                      <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                        {option.keywords[0]}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasCustomRow && (
                <li>
                  <button
                    type="button"
                    data-id={`${dataId}-add-custom`}
                    className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-caption ${
                      highlight === options.length ? "bg-accent-tint text-accent" : "text-accent hover:bg-surface-alt"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(options.length);
                    }}
                    onMouseEnter={() => setHighlight(options.length)}
                  >
                    <span className="min-w-0 truncate">{t("dataForm.addCustom", { value: trimmed })}</span>
                  </button>
                </li>
              )}
              {rowCount === 0 && (
                <li className="px-2 py-1 text-caption text-ink-tertiary">{t("dataForm.noMatch")}</li>
              )}
            </ul>,
            document.body,
          )}
      </>
    );
  }

  if (value !== "") {
    const matched = resolveDataForm(value);
    const Icon = matched?.icon;
    return (
      // 입력 완료 상태 — 필 형식 비활성 표시(카탈로그 항목은 아이콘 동반), 클릭=재편집·×=제거
      <span
        data-id={`${dataId}-pill`}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary ${
          column ? DATA_FORM_COLUMN_WIDTH : "max-w-[8rem]"
        }`}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-1"
          title={value}
          onClick={(e) => openEditor(e.currentTarget)}
        >
          {Icon && <Icon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />}
          <span className="min-w-0 truncate">{matched?.value ?? value}</span>
        </button>
        <button
          type="button"
          data-id={`${dataId}-clear`}
          aria-label={t("dataForm.clear")}
          className="shrink-0 text-ink-tertiary hover:text-ink"
          onClick={() => onCommit("")}
        >
          <X size={10} strokeWidth={1.5} />
        </button>
      </span>
    );
  }

  if (column) {
    return (
      // 미지정(열 모드) — 점선 자리표시 필이 항상 보여 열이 흔들리지 않는다
      <button
        type="button"
        data-id={`${dataId}-open`}
        aria-label={t("dataForm.set")}
        title={t("dataForm.set")}
        className={`inline-flex ${DATA_FORM_COLUMN_WIDTH} shrink-0 items-center justify-center gap-1 rounded-full border border-dashed border-hairline px-1.5 py-0.5 text-fine text-ink-muted transition-colors hover:border-accent hover:text-accent`}
        onClick={(e) => openEditor(e.currentTarget)}
      >
        <FileType size={11} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 truncate">{t("detail.formPlaceholder")}</span>
      </button>
    );
  }
  return (
    // 미지정 — 행 호버/포커스 시에만 나타나는 지정 아이콘 버튼 (사용자 결정 2026-08-20)
    <button
      type="button"
      data-id={`${dataId}-open`}
      aria-label={t("dataForm.set")}
      title={t("dataForm.set")}
      className="shrink-0 rounded-sm p-0.5 text-ink-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface-alt hover:text-accent focus-visible:opacity-100 group-hover/mvrow:opacity-100"
      onClick={(e) => openEditor(e.currentTarget)}
    >
      <FileType size={14} strokeWidth={1.5} />
    </button>
  );
}
