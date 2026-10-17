/** 드래그-오버 드롭 대상(노드 4방향 링·영역 합류 강조) 스토어 — 바뀌어도 에디터 페이지는 다시 렌더하지 않고 구독한 오버레이만 갱신한다. */
import { useSyncExternalStore } from "react";

import type { DropZone } from "@/lib/canvas";

// 화면(컨테이너 상대) 사각형 + 링 반경 — 활성 시점에 계산해 저장(렌더 중 DOM 측정 회피)
export type ScreenRect = { left: number; top: number; width: number; height: number; radius: number };

export interface DropTarget {
  id: string;
  zone: DropZone | null;
  rect: ScreenRect;
  // 시작/끝 규칙 위반으로 비활성화된 흐름존 — 활성 시점에 계산
  frontBlocked: boolean;
  backBlocked: boolean;
  // 다른 종류 노드라 비활성화된 스왑존(subprocess↔process 예외 외)
  swapBlocked: boolean;
}

type Update<T> = T | ((current: T) => T);

// 단일 에디터 인스턴스 전제 모듈 상태(lib/drag-live와 같은 전제) — 마운트 시 비운다.
let dropTarget: DropTarget | null = null;
let groupDropTarget: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDropTarget(): DropTarget | null {
  return dropTarget;
}

export function getGroupDropTarget(): string | null {
  return groupDropTarget;
}

// useState 세터와 같은 모양 — 같은 값을 돌려주면 구독자를 깨우지 않는다.
export function setDropTarget(update: Update<DropTarget | null>): void {
  const next = typeof update === "function" ? update(dropTarget) : update;
  if (next !== dropTarget) {
    dropTarget = next;
    notify();
  }
}

export function setGroupDropTarget(update: Update<string | null>): void {
  const next = typeof update === "function" ? update(groupDropTarget) : update;
  if (next !== groupDropTarget) {
    groupDropTarget = next;
    notify();
  }
}

export function useDropTarget(): DropTarget | null {
  return useSyncExternalStore(subscribe, getDropTarget, getDropTarget);
}

export function useGroupDropTarget(): string | null {
  return useSyncExternalStore(subscribe, getGroupDropTarget, getGroupDropTarget);
}
