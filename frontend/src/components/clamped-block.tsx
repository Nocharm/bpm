// 긴 글을 몇 줄에서 접고 "더 보기"로 펴는 읽기 전용 블록 — 에디터 인스펙터의 노드 설명이 쓴다.
"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

interface ClampedBlockProps {
  children: ReactNode;
  dataId: string;
  className: string;
  moreLabel: string;
  lessLabel: string;
  onDoubleClick?: () => void;
}

/** 5줄까지만 보이고 넘치면 토글을 단다. 대상이 바뀌면 호출부가 key로 다시 마운트해 접힌 상태로 돌린다. */
export function ClampedBlock({ children, dataId, className, moreLabel, lessLabel, onDoubleClick }: ClampedBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

  // 접힌 상태에서만 넘침을 잰다(펼친 뒤엔 넘침이 없어 토글이 사라지면 안 된다). 패널 폭이 바뀌면 다시 잰다.
  useEffect(() => {
    const el = blockRef.current;
    if (!el || isExpanded) {
      return;
    }
    const observer = new ResizeObserver(() => setIsOverflowing(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded, children]);

  return (
    <>
      <div
        ref={blockRef}
        data-id={dataId}
        className={`${className} ${isExpanded ? "" : "line-clamp-5"}`}
        onDoubleClick={onDoubleClick}
      >
        {children}
      </div>
      {isOverflowing && (
        <button
          type="button"
          data-id={`${dataId}-toggle`}
          className="mt-1 rounded-xs px-1 text-fine text-accent hover:bg-accent-tint"
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? lessLabel : moreLabel}
        </button>
      )}
    </>
  );
}
