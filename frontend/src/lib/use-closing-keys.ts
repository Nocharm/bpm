// 아코디언 접힘 애니메이션의 고스트 렌더 — 닫기 시 상태/영속은 즉시 커밋하고(지연 커밋은 그 사이
// 이동/새로고침에 접힘이 유실된다), key를 closing 집합에 넣어 콘텐츠를 잠시 더 렌더하며
// .accordion-close(globals.css)를 재생한 뒤 집합에서 빼 언마운트한다. 재펼침은 cancelClose로 취소.
// 홈 부서 목록·미지정·나의 부서·업무 체계 트리가 공유.
"use client";

import { useEffect, useRef, useState } from "react";

// globals.css .accordion-close 재생 시간(240ms)과 동기 — 바꾸면 양쪽 함께 조정한다.
export const ACCORDION_CLOSE_MS = 240;

/** 섹션 콘텐츠 래퍼 클래스 — 닫히는 중이면 close, 사용자가 편 뒤면 open(애니메이션),
 * 그 전(첫 페인트·저장값 복원)에는 애니메이션 없는 같은 레이아웃(accordion-static). */
export function pickSectionClass(isClosing: boolean, interacted: boolean): string {
  if (isClosing) return "accordion-close";
  return interacted ? "accordion-open" : "accordion-static";
}

export function useClosingKeys<K>(): {
  closingKeys: Set<K>;
  beginClose: (key: K) => void;
  cancelClose: (key: K) => void;
  getSectionClass: (key: K) => string;
} {
  const [closingKeys, setClosingKeys] = useState<Set<K>>(new Set());
  const timersRef = useRef<Map<K, number>>(new Map());
  // 진입 애니메이션은 "사용자가 편 것"에만 재생한다 — 첫 페인트·localStorage 복원·목록 도착으로
  // 여러 섹션이 한꺼번에 마운트되면 accordion-open이 우르르 겹쳐 재생된다(사용자 피드백 2026-08-19).
  // beginClose/cancelClose는 토글 핸들러에서만 불리므로 그 자체가 "조작했다"는 신호다.
  const [interacted, setInteracted] = useState(false);

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
    setInteracted(true);
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
    setInteracted(true); // 펼침 토글도 여기로 온다 — 닫는 중이 아니어도 조작 신호로 받는다
    const id = timersRef.current.get(key);
    if (id === undefined) return;
    window.clearTimeout(id);
    timersRef.current.delete(key);
    removeKey(key);
  };

  const getSectionClass = (key: K): string => pickSectionClass(closingKeys.has(key), interacted);

  return { closingKeys, beginClose, cancelClose, getSectionClass };
}
