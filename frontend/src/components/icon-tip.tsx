"use client";

// 아이콘 전용 버튼의 호버 툴팁 박스 — 네이티브 title 대신 디자인 토큰 박스로 라벨 표시(창 최상단 바 등).
import { type ReactNode } from "react";

interface IconTipProps {
  label: string;
  align?: "left" | "right"; // 박스 가로 정렬 — 우측 끝 버튼은 right(기본), 좌측 버튼은 left
  children: ReactNode;
}

export function IconTip({ label, align = "right", children }: IconTipProps) {
  return (
    <div className="group relative shrink-0">
      {children}
      <div
        data-id="icon-tip"
        className={`pointer-events-none absolute top-full z-30 mt-1.5 hidden whitespace-nowrap rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink shadow-lg group-hover:block ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {label}
      </div>
    </div>
  );
}
