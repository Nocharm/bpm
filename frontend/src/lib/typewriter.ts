// 주관식 "AI 제안" 타이핑 연출 — 글자별 표시 시각을 미리 계산하고(캡 1.2s), 훅은 타이머로 재생하며 취소 가능. reduced-motion이면 즉시 (2026-09-23).

import { useCallback, useEffect, useRef } from "react";

export const TYPE_MS_PER_CHAR = 25;
export const TYPE_CAP_MS = 1200;

export function buildTypingSchedule(text: string, msPerChar = TYPE_MS_PER_CHAR, capMs = TYPE_CAP_MS): number[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  const step = Math.min(msPerChar, capMs / chars.length);
  return chars.map((_, i) => Math.round(step * (i + 1)));
}

export function useTypewriter(): {
  typeInto: (text: string, onFrame: (partial: string) => void, onDone: () => void) => () => void;
} {
  const timers = useRef<number[]>([]);
  const clear = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);
  // 언마운트 시 남은 타이머 정리
  useEffect(() => clear, [clear]);
  const typeInto = useCallback(
    (text: string, onFrame: (partial: string) => void, onDone: () => void) => {
      clear();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || text.length === 0) {
        onFrame(text);
        onDone();
        return clear;
      }
      const chars = [...text];
      buildTypingSchedule(text).forEach((at, i) => {
        timers.current.push(
          window.setTimeout(() => {
            onFrame(chars.slice(0, i + 1).join(""));
            if (i === chars.length - 1) onDone();
          }, at),
        );
      });
      return clear;
    },
    [clear],
  );
  return { typeInto };
}
