"use client";

// 공용 검색창 — 맵 목록과 동일 디자인. 검색어 없으면 클릭 가능한 "/" 버튼(포커스), 있으면 전부삭제 버튼.
// 초성 검색은 호출부에서 filterByQuery로.

import { Search, X } from "lucide-react";
import type { RefObject } from "react";

export function SearchBox({
  value,
  onChange,
  placeholder,
  inputRef,
  dataId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  dataId?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2">
      <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      <input
        ref={inputRef}
        type="text"
        data-id={dataId}
        className="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value === "" ? (
        // "/" 힌트 겸 클릭 시 포커스 — 실제 버튼처럼 테두리·그림자 입체감(클릭 눌림은 전역 base)
        <button
          type="button"
          aria-label="Focus search"
          onClick={() => inputRef?.current?.focus()}
          className="shrink-0 rounded-xs border border-hairline bg-surface-alt px-1.5 text-fine text-ink-tertiary shadow-sm hover:bg-surface hover:text-ink"
        >
          /
        </button>
      ) : (
        // 검색어 있을 때 — 전부 삭제 후 포커스 유지
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef?.current?.focus();
          }}
          className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
