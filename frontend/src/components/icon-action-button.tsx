"use client";

// 아이콘 전용 버튼 — 평소 아이콘만, 호버 시 라벨이 정렬 방향으로 펼쳐진다(grid-cols 0fr→1fr 전이). (L4)
// align="left": 아이콘 우측으로 펼침 · align="right": 라벨이 좌측으로 펼쳐져 버튼이 왼쪽으로 길어짐.
// 라벨 폭 전이는 page.tsx의 grid-template 전이 기법과 동일.

import { type ReactNode } from "react";

type Tone = "plain" | "accent" | "error";

const TONE: Record<Tone, string> = {
  plain: "border-hairline text-ink hover:bg-surface-alt",
  accent: "border-accent text-accent hover:bg-accent-tint",
  error: "border-error text-error hover:bg-surface-alt",
};

export function IconActionButton({
  icon,
  label,
  onClick,
  align = "left",
  tone = "plain",
  type = "button",
  hint,
  onHoverChange,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  align?: "left" | "right";
  tone?: Tone;
  type?: "button" | "submit";
  // 호버 시 부모에 안내문구 보고(헤더 하단 등에 표시) / report hint to parent on hover.
  hint?: string;
  onHoverChange?: (hint: string | null) => void;
}) {
  const reportHover = (on: boolean) => onHoverChange?.(on ? (hint ?? label) : null);
  // 펼쳐지는 라벨 — grid-cols 0fr→1fr로 폭을 0에서 콘텐츠까지 부드럽게 / collapsible label.
  const labelWrap = (
    <span className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-350 ease-smooth group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]">
      <span className="overflow-hidden">
        <span className={`block whitespace-nowrap ${align === "right" ? "pr-1" : "pl-1"}`}>
          {label}
        </span>
      </span>
    </span>
  );
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseEnter={() => reportHover(true)}
      onMouseLeave={() => reportHover(false)}
      onFocus={() => reportHover(true)}
      onBlur={() => reportHover(false)}
      className={`group inline-flex shrink-0 items-center rounded-sm border px-1.5 py-1 text-fine ${TONE[tone]}`}
    >
      {align === "right" && labelWrap}
      <span className="flex shrink-0 items-center">{icon}</span>
      {align === "left" && labelWrap}
    </button>
  );
}
