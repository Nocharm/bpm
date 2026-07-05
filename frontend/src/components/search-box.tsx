"use client";

// 공용 검색창 — 맵 목록과 동일 디자인(아이콘 + 입력 + "/" 키 힌트). 초성 검색은 호출부에서 filterByQuery로.

import { Search } from "lucide-react";
import type { RefObject } from "react";

export function SearchBox({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2">
      <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      <input
        ref={inputRef}
        type="text"
        className="peer w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {/* "/" 키 힌트 — 검색어 없고 포커스 아닐 때만 */}
      {value === "" && (
        <kbd
          aria-hidden
          className="pointer-events-none shrink-0 rounded-xs border border-hairline bg-surface-alt px-1.5 text-fine text-ink-tertiary peer-focus:hidden"
        >
          /
        </kbd>
      )}
    </div>
  );
}
