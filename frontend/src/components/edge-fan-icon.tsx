// 연결선 펼침 아이콘 — 한 점에서 원호로 갈라지는 세 갈래(lib/edge-fanout의 모양). PNG 옵션 창(png-export-modal)과
// 비교 PNG 옵션 창(compare-png-export-modal)의 "연결선 펼침" 칩이 공유.

export function EdgeFanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M1,8 H15 M1,8 C5,8 6,3 10,3 H15 M1,8 C5,8 6,13 10,13 H15" />
    </svg>
  );
}
