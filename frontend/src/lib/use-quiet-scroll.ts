"use client";

// 스크롤 중에만 스크롤바를 노출하는 훅 — 대상 요소에 `scroll-quiet` 클래스와 함께 쓴다.
// 늘 떠 있는 막대가 거슬리는 영역(인박스 목록·상세)에서, 스크롤하는 동안만 `is-scrolling`을 붙인다.

import { useEffect, useRef } from "react";

const HIDE_DELAY_MS = 700; // 마지막 스크롤 후 막대를 다시 감추기까지

export function useQuietScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      el.classList.add("is-scrolling");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("is-scrolling"), HIDE_DELAY_MS);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return ref;
}
