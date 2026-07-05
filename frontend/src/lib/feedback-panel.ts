// 피드백 사이드 패널 열림 상태 — 전역 스토어. TopNav가 패널을 렌더/구독하고,
// 어느 화면의 "피드백 보내기" 버튼이든 openFeedbackPanel()로 연다.

let isOpen = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openFeedbackPanel(): void {
  if (isOpen) return;
  isOpen = true;
  emit();
}

export function closeFeedbackPanel(): void {
  if (!isOpen) return;
  isOpen = false;
  emit();
}

export function subscribeFeedbackPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFeedbackPanelOpen(): boolean {
  return isOpen;
}
