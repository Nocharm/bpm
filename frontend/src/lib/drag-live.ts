/** 일반 드래그 동결(#R2) 라이브 표시좌표 + 변경 신호 — 페이지 리렌더 없이 국소 구독자(영역 박스 층)만 깨운다. */

export interface LivePoint {
  x: number;
  y: number;
}

// 제스처 노드의 라이브 표시좌표 — RF 스토어 직행 echo(page.tsx handleNodesChange)와 displayNodes 재계산 시
// 오버레이가 함께 읽는다. 단일 에디터 인스턴스 전제 모듈 캐시(마운트·제스처 시작/종료 시 clear).
export const generalDragLive = new Map<string, LivePoint>();

let liveVersion = 0;
const listeners = new Set<() => void>();

// 라이브 좌표가 바뀐 뒤 호출 — useSyncExternalStore 구독자만 다시 렌더된다.
export function notifyDragLive(): void {
  liveVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDragLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDragLiveVersion(): number {
  return liveVersion;
}
