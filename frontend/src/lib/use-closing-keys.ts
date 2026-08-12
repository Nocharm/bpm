// 아코디언 접힘 애니메이션의 고스트 렌더 — 닫기 시 상태/영속은 즉시 커밋하고(지연 커밋은 그 사이
// 이동/새로고침에 접힘이 유실된다), key를 closing 집합에 넣어 콘텐츠를 잠시 더 렌더하며
// .accordion-close(globals.css)를 재생한 뒤 집합에서 빼 언마운트한다. 재펼침은 cancelClose로 취소.
// 홈 부서 목록·미지정·나의 부서·업무 체계 트리가 공유.
"use client";

import { useEffect, useRef, useState } from "react";

// globals.css .accordion-close 재생 시간(240ms)과 동기 — 바꾸면 양쪽 함께 조정한다.
export const ACCORDION_CLOSE_MS = 240;

export function useClosingKeys<K>(): {
  closingKeys: Set<K>;
  beginClose: (key: K) => void;
  cancelClose: (key: K) => void;
} {
  const [closingKeys, setClosingKeys] = useState<Set<K>>(new Set());
  const timersRef = useRef<Map<K, number>>(new Map());

  // 언마운트 시 잔여 타이머 정리.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers.values()) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  const removeKey = (key: K) => {
    setClosingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const beginClose = (key: K): void => {
    if (timersRef.current.has(key)) return; // 이미 닫히는 중 — 중복 클릭 무시
    setClosingKeys((prev) => new Set(prev).add(key));
    const id = window.setTimeout(() => {
      timersRef.current.delete(key);
      removeKey(key);
    }, ACCORDION_CLOSE_MS);
    timersRef.current.set(key, id);
  };

  // 닫히는 중 재펼침 — 고스트를 즉시 걷어 accordion-close가 열림 상태를 덮지 않게 한다.
  const cancelClose = (key: K): void => {
    const id = timersRef.current.get(key);
    if (id === undefined) return;
    window.clearTimeout(id);
    timersRef.current.delete(key);
    removeKey(key);
  };

  return { closingKeys, beginClose, cancelClose };
}
