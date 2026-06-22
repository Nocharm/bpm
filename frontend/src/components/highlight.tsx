// 매치 구간 하이라이트 — ranges(원문 char 인덱스)를 <mark> 토큰 스타일로 / inline highlight.

import { Fragment } from "react";

import type { MatchRange } from "@/lib/search";

export function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((r, i) => {
    if (r.start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, r.start)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="rounded-[2px] bg-accent-tint text-accent">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = Math.max(cursor, r.end);
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
