"use client";

// 업무 묶음 박스 — 멤버 사각형들의 직교(90°) union 외곽선. bbox 한 장이 아니라 멤버에 달라붙어
// "빈 구석의 비멤버 노드가 그룹 안처럼 보이는" 문제를 없앤다. 반투명 fill이라 겹쳐도 모두 비쳐 보임.
// 이름/색/이동/나가기는 group-title-bar.tsx 가 박스 상단에 별도로 렌더.
export function GroupBox({
  color,
  width,
  height,
  fill,
  outline,
  targeted = false,
}: {
  color: string;
  width: number;
  height: number;
  fill: string; // 채움 영역 path (canvas.ts orthogonalUnion)
  outline: string; // 외곽선 path
  targeted?: boolean; // 드래그 노드가 합류 대상으로 이 박스 위에 머무는 중 — 펄스 강조
}) {
  const stroke = color || "var(--color-border-strong)";
  return (
    <svg
      width={width}
      height={height}
      className={`pointer-events-none ${targeted ? "group-target" : ""}`}
      style={{ overflow: "visible" }}
    >
      <path d={fill} style={{ fill: `color-mix(in srgb, ${stroke} 16%, transparent)` }} />
      <path
        d={outline}
        fill="none"
        style={{ stroke }}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
