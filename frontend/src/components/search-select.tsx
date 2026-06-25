"use client";

// 검색 드롭다운 — 옵션 목록을 검색어로 필터 + 매치 하이라이트, 선택 시 value 저장 (F5 담당자/부서).
// 자유입력 불가(목록에서만 선택). 기존 값이 옵션에 없으면 버튼에 그대로 표시(레거시 보존).

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Highlight } from "@/components/highlight";
import { filterByQuery } from "@/lib/search";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string; // 보조 표기(예: 부서)
}

export function SearchSelect({
  value,
  options,
  emptyLabel,
  placeholder,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  emptyLabel: string; // 미지정 옵션 라벨
  placeholder: string; // 검색 입력 placeholder
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const hits = filterByQuery(options, query, (option) => [
    { field: "label", text: option.label },
    ...(option.sub ? [{ field: "sub", text: option.sub }] : []),
  ]);
  const current = options.find((option) => option.value === value);
  const display = current ? current.label : value || emptyLabel;

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink hover:bg-surface-alt"
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
        }}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      </button>

      {open && (
        <>
          {/* 바깥 클릭 닫기 */}
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 w-full min-w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-sm border border-hairline px-2 py-1 text-fine text-ink outline-none"
            />
            <div className="max-h-56 overflow-y-auto">
              {/* 미지정 */}
              <button
                type="button"
                className="block w-full px-3 py-1 text-left text-caption text-ink-tertiary hover:bg-surface-alt"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {emptyLabel}
              </button>
              {hits.length === 0 ? (
                <p className="px-3 py-1 text-fine text-ink-tertiary">…</p>
              ) : (
                hits.map(({ item, matches }) => {
                  const labelRanges = matches.find((m) => m.field === "label")?.ranges ?? [];
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-caption text-ink hover:bg-surface-alt"
                      onClick={() => {
                        onChange(item.value);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 truncate">
                        <Highlight text={item.label} ranges={labelRanges} />
                        {item.sub && <span className="ml-1 text-fine text-ink-tertiary">· {item.sub}</span>}
                      </span>
                      {item.value === value && (
                        <Check size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
