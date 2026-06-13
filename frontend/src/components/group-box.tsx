"use client";

// 업무 묶음(부서/담당자) 박스 — ViewportPortal 안에서 flow 좌표로 배치되는 시각 전용 컨테이너 (Phase 2).
// 멤버 노드 bounding box로 산정되어 노드 뒤에 깔리는 파스텔 컨테이너.
export function GroupBox({
  label,
  color,
  width,
  height,
}: {
  label: string;
  color: string;
  width: number;
  height: number;
}) {
  const stroke = color || "var(--color-border-strong)";
  return (
    <div
      className="pointer-events-none relative rounded-md border"
      style={{
        width,
        height,
        borderColor: stroke,
        background: `color-mix(in srgb, ${stroke} 10%, white)`,
      }}
    >
      {label && (
        <span
          className="absolute -top-2 left-2 rounded-sm px-1 text-fine font-medium"
          style={{ background: "var(--color-surface)", color: stroke }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
