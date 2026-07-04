"use client";

// 흐름 조작 의미 아이콘 — 노드가 흐름에 껴들거나(Insert), 기존 연결을 유지하며 합류(Keep)하는 애니메이션.
// EdgeActionModal(Insert)·FlowConflictModal(Keep/Insert between) 공용. 키프레임은 globals.css `.edge-*`.
// replayKey 변경 시 SVG 리마운트→재생. 정지 상태(애니 없이)도 완성된 아이콘(겹침 없음).

// 강조 포인트(껴드는 노드·새로 연결되는 엣지) — 데이터가 아닌 토큰이므로 var 사용.
const ACCENT_STROKE = { stroke: "var(--color-accent)" };

// Insert — 노드가 흐름 gap에 껴듦(강조색 박스 드롭 + 커넥터 페이드).
export function InsertGlyph({ replayKey = 0 }: { replayKey?: number }) {
  return (
    <svg
      key={replayKey}
      className="text-ink-tertiary transition-colors group-hover:text-accent"
      width={40}
      height={24}
      viewBox="0 0 40 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="7" width="8" height="10" rx="2" />
      <rect x="30" y="7" width="8" height="10" rx="2" />
      <line className="edge-conn" x1="10" y1="12" x2="16" y2="12" />
      <line className="edge-conn" x1="24" y1="12" x2="30" y2="12" />
      <rect className="edge-box-mid" x="16" y="7" width="8" height="10" rx="2" style={ACCENT_STROKE} />
    </svg>
  );
}

// Keep — 기존 X→B 유지 + 새 노드 A 팝인 후 새 엣지 A→B(강조색)가 그려져 B로 합류(둘 다 B로).
export function KeepGlyph({ replayKey = 0 }: { replayKey?: number }) {
  return (
    <svg
      key={replayKey}
      className="text-ink-tertiary transition-colors group-hover:text-accent"
      width={32}
      height={24}
      viewBox="0 0 40 30"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="29" y="11" width="8" height="8" rx="2" />
      <rect className="edge-keep-node" x="3" y="19" width="8" height="8" rx="2" />
      <path d="M11 7 H25 V13 H29" />
      <path className="edge-keep-edge" pathLength={1} d="M11 23 H25 V17 H29" style={ACCENT_STROKE} />
    </svg>
  );
}
