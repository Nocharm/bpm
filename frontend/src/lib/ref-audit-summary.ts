"use client";

// 고아 참조 빨간 점 소스 — 직접 고칠 수 있는 곳 수(summary.actionable). 상단 바·설정 레일이 같은 훅을 쓰고,
// 적용 직후 notifyRefAuditChanged()로 창 이벤트를 쏘면 마운트된 구독자가 다시 받는다 (design 2026-10-23 §9).

import { useEffect, useState } from "react";

import { getRefAuditSummary } from "@/lib/api";

export const REF_AUDIT_CHANGED_EVENT = "bpm:ref-audit-changed";

/** 적용·재스캔이 끝났음을 알린다 — 마운트된 useRefAuditSummary가 다시 조회한다. */
export function notifyRefAuditChanged(): void {
  window.dispatchEvent(new Event(REF_AUDIT_CHANGED_EVENT));
}

/** 즉시 한 번 + 변경 이벤트마다 조회한다. 실패는 0(경고 로그), 해제 후·낡은 응답은 무시. 해제 함수를 돌려준다. */
export function subscribeRefAuditSummary(onValue: (actionable: number) => void): () => void {
  let isAlive = true;
  let latestRequest = 0; // 순서가 뒤바뀌어 도착한 낡은 응답이 최신 값을 덮지 않게 한다
  const load = async () => {
    latestRequest += 1;
    const request = latestRequest;
    let actionable = 0;
    try {
      actionable = (await getRefAuditSummary()).actionable;
    } catch (error) {
      console.warn("ref-audit summary fetch failed", error);
    }
    if (isAlive && request === latestRequest) onValue(actionable);
  };
  const handleChanged = () => void load();
  void load();
  window.addEventListener(REF_AUDIT_CHANGED_EVENT, handleChanged);
  return () => {
    isAlive = false;
    window.removeEventListener(REF_AUDIT_CHANGED_EVENT, handleChanged);
  };
}

/** 빨간 점 숫자 — enabled(로그인)일 때만 조회한다. 꺼져 있으면 0. */
export function useRefAuditSummary(enabled: boolean): number {
  const [actionable, setActionable] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeRefAuditSummary(setActionable);
  }, [enabled]);
  return enabled ? actionable : 0;
}
