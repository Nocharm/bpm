"use client";

// 노드 검색 — 사이드바 아웃라인 위. 제목/초성 매칭 결과 드롭다운 + 키보드 네비(↑↓ Enter Esc).
// 검색 상태·결과 계산은 page.tsx 소유, 이 컴포넌트는 표시+이벤트. "/" 포커스용 inputRef도 page.tsx 소유.
import { Search, X } from "lucide-react";
import { type RefObject } from "react";

import { useI18n } from "@/lib/i18n";

export interface NodeSearchResult {
  node: { id: string; title: string };
  path: string;
}

interface NodeSearchProps<R extends NodeSearchResult> {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  results: R[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: R) => void;
}

export function NodeSearch<R extends NodeSearchResult>({
  inputRef,
  query,
  onQueryChange,
  results,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: NodeSearchProps<R>) {
  const { t } = useI18n();
  return (
    <div className="relative mb-1">
      <div className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2 py-1">
        <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
          placeholder={t("editor.searchPlaceholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActiveIndexChange(Math.min(activeIndex + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onActiveIndexChange(Math.max(activeIndex - 1, 0));
            } else if (event.key === "Enter" && results[activeIndex]) {
              onSelect(results[activeIndex]);
            } else if (event.key === "Escape") {
              onQueryChange("");
              event.currentTarget.blur();
            }
          }}
        />
        {query === "" ? (
          // "/" 단축키 힌트 겸 클릭 시 포커스 — 공용 SearchBox와 동일 키캡 스타일 (F12)
          <button
            type="button"
            aria-label="Focus search"
            onClick={() => inputRef.current?.focus()}
            className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 text-fine text-ink-tertiary shadow-sm hover:bg-surface-alt hover:text-ink"
          >
            /
          </button>
        ) : (
          // 검색어 있을 때 — 전부 삭제 후 포커스 유지
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface hover:text-ink"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-sm border border-hairline bg-surface py-1 shadow-lg">
          {results.map((result, index) => (
            <li key={result.node.id}>
              <button
                className={`block w-full px-3 py-1.5 text-left text-caption ${
                  index === activeIndex ? "bg-surface-alt" : ""
                }`}
                onMouseDown={(event) => {
                  // blur로 드롭다운이 닫히기 전에 선택 처리
                  event.preventDefault();
                  onSelect(result);
                }}
                onMouseEnter={() => onActiveIndexChange(index)}
              >
                <span className="font-medium text-ink">{result.node.title}</span>
                <span className="ml-2 text-fine text-ink-tertiary">{result.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
