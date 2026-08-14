"use client";

// top-nav 인박스 탭 카운트 배지 — 내 승인 대기(listInboxApprovals) 폴링 (설계: 2026-08-08-governance-ux-design.md §C).
// notification-bell 폴링 선례: 일시 실패는 조용히 넘기고 다음 틱에서 회복.

import { useEffect, useState } from "react";

import { listInboxApprovals } from "@/lib/api";

const POLL_MS = 15_000; // 폴링 주기(ms) — 벨(5s)보다 무거운 다중쿼리 엔드포인트라 여유 있게

export function InboxBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const items = await listInboxApprovals();
        if (alive) setCount(items.length);
      } catch {
        // 폴링 지속 — 로그아웃/네트워크 일시 실패는 다음 틱에서 회복
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (count === 0) return null;
  return (
    <span
      data-id="nav-inbox-badge"
      className="inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 text-fine leading-4 text-on-accent"
    >
      {count}
    </span>
  );
}
