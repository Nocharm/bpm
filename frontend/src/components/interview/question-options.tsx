"use client";

// 질문 툴박스 — 보기 선택 UI. 화살표/숫자 키 이동 + Enter 선택 + 클릭 (실사용 피드백 3차).
// 일반 문자를 치면 자유 답변 입력창으로 포커스를 넘긴다(onFreeType).

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, PenLine } from "lucide-react";

interface QuestionOptionsProps {
  options: string[];
  disabled: boolean;
  onSelect: (option: string) => void;
  onFreeType?: () => void;
}

export function QuestionOptions({ options, disabled, onSelect, onFreeType }: QuestionOptionsProps) {
  const [selected, setSelected] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 보기가 나타나면 키보드 조작이 바로 되도록 포커스 — 입력창은 문자 입력 시 자동 복귀
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    // 마지막 행은 "Other" — 자유답변 입력창으로 (클로드코드 질문 픽커와 동일 UX)
    const total = options.length + 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selected === options.length) {
        onFreeType?.();
      } else {
        onSelect(options[selected]);
      }
    } else if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < options.length) {
        e.preventDefault();
        onSelect(options[idx]);
      }
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      onFreeType?.();
    }
  }

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      role="listbox"
      aria-label="Answer options"
      onKeyDown={handleKeyDown}
      className="rounded-md border border-accent-tint-border bg-surface shadow-sm outline-none focus:border-accent"
      data-id="iv-question-options"
    >
      <ul className="py-1">
        {options.map((option, i) => (
          <li key={option}>
            <button
              role="option"
              aria-selected={i === selected}
              className={
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption " +
                (i === selected ? "bg-accent-tint text-ink" : "text-ink-secondary hover:bg-surface-alt")
              }
              disabled={disabled}
              onMouseEnter={() => setSelected(i)}
              onClick={() => onSelect(option)}
              data-id="iv-question-option"
            >
              <span className={"w-4 shrink-0 text-fine " + (i === selected ? "text-accent" : "text-ink-muted")}>
                {i + 1}.
              </span>
              <span className="flex-1">{option}</span>
              {i === selected ? (
                <CornerDownLeft size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
              ) : null}
            </button>
          </li>
        ))}
        <li>
          <button
            role="option"
            aria-selected={selected === options.length}
            className={
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption " +
              (selected === options.length
                ? "bg-accent-tint text-ink"
                : "text-ink-tertiary hover:bg-surface-alt")
            }
            disabled={disabled}
            onMouseEnter={() => setSelected(options.length)}
            onClick={() => onFreeType?.()}
            data-id="iv-question-other"
          >
            <span className="w-4 shrink-0">
              <PenLine
                size={14}
                strokeWidth={1.5}
                className={selected === options.length ? "text-accent" : "text-ink-muted"}
              />
            </span>
            <span className="flex-1 italic">Other — type my own answer</span>
            {selected === options.length ? (
              <CornerDownLeft size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
            ) : null}
          </button>
        </li>
      </ul>
      <div className="border-t border-hairline px-3 py-1 text-fine text-ink-muted">
        ↑↓ move · Enter select · 1–{Math.min(options.length, 9)} quick pick
      </div>
    </div>
  );
}
