"use client";

// 업무 묶음(부서/담당자) 박스 — 멤버 bounding box로 산정돼 노드 뒤에 깔리는 파스텔 컨테이너(시각 전용).
// 이름/색/이동/나가기는 group-title-bar.tsx 가 박스 상단에 별도로 렌더.
export function GroupBox({
  color,
  width,
  height,
  targeted = false,
}: {
  color: string;
  width: number;
  height: number;
  targeted?: boolean; // 드래그 노드가 합류 대상으로 이 박스 위에 머무는 중 — 펄스 강조
}) {
  const stroke = color || "var(--color-border-strong)";
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-md border ${targeted ? "group-target" : ""}`}
      style={{
        width,
        height,
        borderColor: stroke,
        // 반투명 fill — 여러 그룹이 겹쳐도 z-index와 무관하게 모두 비쳐 보이게(다중 태그)
        background: `color-mix(in srgb, ${stroke} 16%, transparent)`,
      }}
    />
  );
}
