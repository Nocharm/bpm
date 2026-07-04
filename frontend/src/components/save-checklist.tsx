"use client";

// 저장(그래프 검증) 조건 체크리스트 — 캔버스 좌상단 반투명 패널. 접었다 펼침.
// 각 조건은 현재 노드 상태에 맞춰 자동 체크(충족=체크+취소선, 미충족=빈 박스). 저장이 왜 안 되는지 한눈에.

import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export interface SaveCheckItem {
  key: string;
  label: string;
  ok: boolean;
}

export function SaveChecklist({ title, items }: { title: string; items: SaveCheckItem[] }) {
  const [open, setOpen] = useState(false);
  const failed = items.filter((item) => !item.ok).length;
  const allOk = failed === 0;

  return (
    <div className="pointer-events-auto w-max max-w-[240px] select-none rounded-md border border-hairline bg-surface/75 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-alt/60"
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        ) : (
          <ChevronRight size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        )}
        <span className="text-fine font-semibold text-ink-secondary">{title}</span>
        <span
          className={`ml-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-fine font-semibold ${
            allOk ? "text-accent" : "bg-error/10 text-error"
          }`}
        >
          {allOk ? <Check size={12} strokeWidth={2.5} /> : failed}
        </span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 border-t border-divider px-2 py-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                  item.ok ? "border-accent bg-accent text-on-accent" : "border-ink-tertiary/50"
                }`}
              >
                {item.ok && <Check size={10} strokeWidth={3} />}
              </span>
              <span className={`text-fine ${item.ok ? "text-ink-tertiary line-through" : "text-ink"}`}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
