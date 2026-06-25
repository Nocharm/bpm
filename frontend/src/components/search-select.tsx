"use client";

// 검색 드롭다운 — 옵션 목록을 검색어로 필터 + 매치 하이라이트, 선택 시 value 저장 (F5 담당자/부서).
// 자유입력 불가(목록에서만 선택). 기존 값이 옵션에 없으면 버튼에 그대로 표시(레거시 보존).
// SR: 키 내비(Tab/↓ 다음, ↑/Shift+Tab 이전, Enter 선택) · 드롭다운은 absolute overlay라 입력창 위치 불변.

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Highlight } from "@/components/highlight";
import { filterByQuery } from "@/lib/search";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string; // 보조 표기(표시 전용, 예: 아이디 · 부서) — 검색 대상 아님
  keywords?: string; // 추가 검색어(표시 안 함, 예: 아이디). label과 함께 검색
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
  const [active, setActive] = useState(0); // 0=미지정, 1..n=hits
  const listRef = useRef<HTMLDivElement>(null);

  // 검색은 label + keywords만 — sub(부서 등)는 표시 전용(검색 제외).
  const hits = filterByQuery(options, query, (option) => [
    { field: "label", text: option.label },
    ...(option.keywords ? [{ field: "keywords", text: option.keywords }] : []),
  ]);
  // 내비 대상: [미지정, ...hits]
  const navCount = 1 + hits.length;
  const current = options.find((option) => option.value === value);
  const display = current ? current.label : value || emptyLabel;

  const pick = (index: number) => {
    if (index <= 0) {
      onChange("");
    } else {
      onChange(hits[index - 1].item.value);
    }
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, navCount - 1));
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink hover:bg-surface-alt"
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
          setActive(0);
        }}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      </button>

      {open && (
        <>
          {/* 바깥 클릭 닫기 */}
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          {/* absolute overlay — 늘/줄어도 버튼·주변 레이아웃 불변 (SR-4) */}
          <div className="absolute left-0 z-[1001] mt-1 w-full min-w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-sm border border-hairline px-2 py-1 text-fine text-ink outline-none"
            />
            <div ref={listRef} className="max-h-56 overflow-y-auto">
              {/* 미지정 (index 0) */}
              <button
                type="button"
                className={`block w-full px-3 py-1 text-left text-caption text-ink-tertiary hover:bg-surface-alt ${
                  active === 0 ? "bg-surface-alt" : ""
                }`}
                onMouseEnter={() => setActive(0)}
                onClick={() => pick(0)}
              >
                {emptyLabel}
              </button>
              {hits.length === 0 ? (
                <p className="px-3 py-1 text-fine text-ink-tertiary">…</p>
              ) : (
                hits.map(({ item, matches }, idx) => {
                  const labelRanges = matches.find((m) => m.field === "label")?.ranges ?? [];
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-caption text-ink hover:bg-surface-alt ${
                        active === idx + 1 ? "bg-surface-alt" : ""
                      }`}
                      onMouseEnter={() => setActive(idx + 1)}
                      onClick={() => pick(idx + 1)}
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
