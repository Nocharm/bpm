// 1클릭 지연 이동 — 클릭 즉시 prefetch하고 NAV_DELAY_MS 뒤에 이동, 그 사이 같은 대상을 다시 클릭하면 취소(실수 클릭 복귀).
// 전역에서 한 번에 하나만 대기한다 — 다른 대상을 시작하면 이전 대기는 취소된다(홈 대시보드 타일·프로필 버튼·맵 열기 공용,
// 마우스 위치 "…로 이동" 메뉴 대체 — 사용자 지시 2026-09-11).
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 대기 시간(ms) — 취소할 여유가 있으면서 기다림으로 느껴지지 않는 값. nav-ring 애니메이션(globals.css)과 같은 길이.
export const NAV_DELAY_MS = 1000;

let activeOwner: object | null = null;
let activeCancel: (() => void) | null = null;

export function useDelayedNav(): {
  pending: string | null; // 대기 중인 href (없으면 null)
  toggle: (href: string) => void; // 시작 / 같은 href면 취소
  cancel: () => void;
} {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 훅 인스턴스 식별자 — 전역 "대기 중 하나" 소유권 비교용(렌더 중 ref.current 읽기는 린트 위반이라 state로)
  const [owner] = useState<object>(() => ({}));

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPending(null);
    if (activeOwner === owner) {
      activeOwner = null;
      activeCancel = null;
    }
  };

  const toggle = (href: string) => {
    if (pending === href) {
      cancel();
      return;
    }
    activeCancel?.();
    activeOwner = owner;
    activeCancel = cancel;
    router.prefetch(href);
    setPending(href);
    timer.current = setTimeout(() => {
      timer.current = null;
      activeOwner = null;
      activeCancel = null;
      setPending(null);
      router.push(href);
    }, NAV_DELAY_MS);
  };

  // 언마운트 시 대기 중인 이동은 버린다 — 화면을 떠난 뒤 엉뚱한 곳으로 튀지 않게
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (activeOwner === owner) {
        activeOwner = null;
        activeCancel = null;
      }
    },
    [owner],
  );

  return { pending, toggle, cancel };
}
