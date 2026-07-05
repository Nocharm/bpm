"use client";

// 대용량 목록 증분 렌더 훅 — 처음 chunk개만 렌더하고, 목록 끝 센티널이 보이면 chunk개씩 추가.
// 데이터는 이미 메모리에 있으므로(디렉터리 ~5000명 등) fetch가 아닌 DOM 렌더만 증분한다.
// IntersectionObserver는 조상 overflow 클리핑을 반영하므로 스크롤 컨테이너가 무엇이든 동작.

import { useCallback, useEffect, useRef, useState } from "react";

export const INFINITE_CHUNK = 25; // 1회 렌더 행 수 — 피커/목록 1~2화면 분량

interface InfiniteSlice<T> {
  visible: T[];
  hasMore: boolean;
  /** 목록 맨 끝에 붙일 센티널 ref — hasMore일 때만 마운트할 것. */
  sentinelRef: (node: HTMLElement | null) => void;
}

export function useInfiniteSlice<T>(
  items: T[],
  resetKey: string,
  chunk: number = INFINITE_CHUNK,
): InfiniteSlice<T> {
  const [count, setCount] = useState(chunk);
  // 검색어 등 목록 조건이 바뀌면 처음부터 — 렌더 중 상태 보정(set-state-in-effect 회피 공식 패턴)
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setCount(chunk);
  }

  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // 리셋(검색어 변경 등) 시 스크롤 컨테이너를 맨 위로 — 바닥에 남은 스크롤 위치가
  // 센티널을 화면 안에 둬 리셋 직후 연쇄 로드되는 것을 방지(검색 UX상으로도 상단 복귀가 맞음).
  useEffect(() => {
    let el = nodeRef.current?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
    el?.scrollTo({ top: 0 });
  }, [resetKey]);

  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const io = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => current + chunk);
          // 재관찰로 초기 알림을 다시 받음 — 추가분이 컨테이너를 못 채우면 연쇄 로드로 채움
          io.unobserve(node);
          io.observe(node);
        }
      });
      io.observe(node);
      observerRef.current = io;
    },
    [chunk],
  );

  const hasMore = count < items.length;
  return { visible: hasMore ? items.slice(0, count) : items, hasMore, sentinelRef };
}
