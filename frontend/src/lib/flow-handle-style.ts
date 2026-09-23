// React Flow 핸들·노드 호버 강조 스타일의 단일 소스 — 에디터(maps/[mapId]/page.tsx)와 캠페인 연결 캔버스가 같은 문자열을 쓴다.
// 서비스 노드 룩이 바뀌면 여기 한 곳만 고친다(별도 트랙 금지, 사용자 요청 2026-09-24).
// Turbopack이 dev에서 .react-flow__* 규칙을 purge해 globals.css 대신 raw <style>로 주입한다(lessons canvas §5).

/** `scope`는 다른 RF 인스턴스(미리보기 모달 등)에 번지지 않게 앞에 붙일 래퍼 셀렉터(예: ".bpm-fw-relations-flow"). */
export function buildFlowHandleStyle(scope = ""): string {
  const p = scope ? `${scope} ` : "";
  return (
    `${p}.react-flow__handle{width:11px;height:11px;border-radius:3px;background:color-mix(in srgb,var(--color-ink-tertiary) 20%,transparent);border:1px solid color-mix(in srgb,var(--color-ink-tertiary) 50%,transparent);opacity:0;transition:opacity 120ms var(--ease-smooth),background 120ms var(--ease-smooth),border-color 120ms var(--ease-smooth)}` +
    `${p}.react-flow__node:hover .react-flow__handle{opacity:1}` +
    `${p}.react-flow__handle:hover{opacity:1;background:color-mix(in srgb,var(--color-ink-tertiary) 42%,transparent);border-color:var(--color-ink-secondary)}` +
    `${p}.react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}`
  );
}
