"use client";

// 노드 드래그-오버 4방향 드롭 링(앞·뒤·스왑·영역) — 드롭 대상 스토어(lib/drop-target)를 직접 구독해 링이 바뀌어도 에디터 페이지는 다시 렌더하지 않는다. 맵 에디터 전용.
import { ArrowLeft, ArrowLeftRight, ArrowRight, Boxes } from "lucide-react";

import { useDropTarget } from "@/lib/drop-target";
import { useI18n } from "@/lib/i18n";

interface DropZoneOverlayProps {
  isFrameworkMap: boolean;
  l5Charcoal: boolean;
}

export function DropZoneOverlay({ isFrameworkMap, l5Charcoal }: DropZoneOverlayProps) {
  const { t } = useI18n();
  const dropTarget = useDropTarget();
  if (!dropTarget) {
    return null;
  }
  const r = dropTarget.rect;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // 링 반경 — screenRectOf에서 줌 무관 고정값으로 계산됨 (hit-test와 공용)
  const radius = r.radius;
  // 부채꼴: 노드 근처(ri)에서 바깥(ro)으로 팬, 아이콘/라벨은 중간 반경(rm)
  const ri = radius * 0.8; // 밴드 두께 축소 — 가장자리(ro)는 유지, 안쪽만 바깥으로
  const ro = radius + 48;
  const rm = (ri + ro) / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const HALF = rad(19); // 활성 부채꼴 반각(=38° 폭) — 각폭 좁혀 조각 사이 간극 확대
  const DHALF = rad(16); // 대각 점선 부채꼴 반각
  const CR = 7; // 모서리 라운드 반경(px) — 이미지처럼 둥근 부채꼴
  const pt = (rr: number, a: number) =>
    `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  // 라운드 모서리 annular sector — 각도 화면좌표(y-down, 0°=동). 방사형 변은 곧게(중심 방향)
  // 두어 각도 차만큼 조각 사이 간극이 바깥으로 갈수록 넓어진다. 네 모서리만 CR로 둥글림.
  const sector = (axis: number, half: number, r0: number, r1: number) => {
    const a0 = axis - half;
    const a1 = axis + half;
    const di = CR / r0; // 내호 각도 오프셋
    const dO = CR / r1; // 외호 각도 오프셋
    const R0 = r0.toFixed(2);
    const R1 = r1.toFixed(2);
    return [
      `M ${pt(r0 + CR, a0)}`,
      `L ${pt(r1 - CR, a0)}`,
      `Q ${pt(r1, a0)} ${pt(r1, a0 + dO)}`,
      `A ${R1} ${R1} 0 0 1 ${pt(r1, a1 - dO)}`,
      `Q ${pt(r1, a1)} ${pt(r1 - CR, a1)}`,
      `L ${pt(r0 + CR, a1)}`,
      `Q ${pt(r0, a1)} ${pt(r0, a1 - di)}`,
      `A ${R0} ${R0} 0 0 0 ${pt(r0, a0 + di)}`,
      `Q ${pt(r0, a0)} ${pt(r0 + CR, a0)}`,
      "Z",
    ].join(" ");
  };
  // 사용 4방향 — group=상(N)/back=우(E)/swap=하(S)/front=좌(W)
  const zones = [
    { zone: "group", axis: rad(-90), Icon: Boxes, label: t("dropzone.group") },
    { zone: "back", axis: rad(0), Icon: ArrowRight, label: t("dropzone.back") },
    { zone: "swap", axis: rad(90), Icon: ArrowLeftRight, label: t("dropzone.swap") },
    { zone: "front", axis: rad(180), Icon: ArrowLeft, label: t("dropzone.front") },
  ] as const;
  const diagAxes = [rad(-45), rad(45), rad(135), rad(-135)]; // NE·SE·SW·NW — 추후 확장
  const blockedOf = (zone: string) =>
    (zone === "front" && dropTarget.frontBlocked) ||
    (zone === "back" && dropTarget.backBlocked) ||
    (zone === "swap" && dropTarget.swapBlocked);
  // L5 하늘 프레임 위에서는 회색 기반색이 묻힌다 — 밝은 캔버스색·하늘 액센트로 바꾼다 (2026-09-23)
  const zoneNeutral = isFrameworkMap ? "var(--color-canvas)" : "var(--color-ink-tertiary)";
  // 드롭 영역 오버레이는 하늘 프레임 밖에서 그려질 수 있어 토큰 스코프 대신 실제 하늘 여부로 — 라이트로 토글한 L5도 원색
  const zoneAccent = l5Charcoal ? "var(--color-accent-sky)" : "var(--color-accent)";
  return (
    <div className="pointer-events-none absolute inset-0 z-[1100]">
      <svg className="zone-fan absolute inset-0 h-full w-full overflow-visible">
        {/* 추후 확장 — 점선 대각 부채꼴 */}
        {diagAxes.map((axis, i) => (
          <path
            key={`d${i}`}
            d={sector(axis, DHALF, ri, ro)}
            style={{
              fill: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 10 : 4}%, transparent)`,
              stroke: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 45 : 36}%, transparent)`,
              strokeWidth: 1.5,
              strokeDasharray: "4 4",
              strokeLinejoin: "round",
            }}
          />
        ))}
        {/* 사용 4방향 부채꼴 */}
        {zones.map(({ zone, axis }) => {
          const active = dropTarget.zone === zone;
          const blocked = blockedOf(zone);
          const style = blocked
            ? {
                fill: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 14 : 7}%, transparent)`,
                stroke: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 35 : 25}%, transparent)`,
                strokeWidth: 1.5,
              }
            : active
              ? {
                  fill: `color-mix(in srgb, ${zoneAccent} 34%, transparent)`,
                  stroke: zoneAccent,
                  strokeWidth: 2.5,
                }
              : {
                  fill: `color-mix(in srgb, ${zoneAccent} ${isFrameworkMap ? 24 : 18}%, transparent)`,
                  stroke: `color-mix(in srgb, ${zoneAccent} ${isFrameworkMap ? 55 : 32}%, transparent)`,
                  strokeWidth: 1.5,
                };
          return (
            <path
              key={zone}
              d={sector(axis, HALF, ri, ro)}
              style={{ ...style, strokeLinejoin: "round" }}
            />
          );
        })}
      </svg>
      {/* 대각 + 표시(추후 확장) */}
      {diagAxes.map((axis, i) => (
        <span
          key={`p${i}`}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-body font-light text-ink-tertiary/40"
          style={{ left: cx + rm * Math.cos(axis), top: cy + rm * Math.sin(axis) }}
        >
          +
        </span>
      ))}
      {/* 아이콘 + 라벨 */}
      {zones.map(({ zone, axis, Icon, label }) => {
        const active = dropTarget.zone === zone;
        const blocked = blockedOf(zone);
        // L5 하늘 프레임에선 라벨이 어두운 하늘과 밝은 노드 양쪽 위에 놓인다 — 보라 글자는 하늘에 묻히고
        // 흰 글자는 노드에 묻히므로 잉크색 반투명 알약 위의 밝은 글자로 고정한다(둘 다 읽힘, 2026-09-23)
        const tone = blocked
          ? (isFrameworkMap ? "text-canvas opacity-40" : "text-ink-tertiary opacity-40")
          : active
            ? (l5Charcoal ? "text-accent-sky" : "text-accent")
            : (isFrameworkMap ? "text-canvas" : "text-accent/80");
        const pill = isFrameworkMap ? "rounded-md bg-ink/70 px-1.5 py-1" : "";
        return (
          <div
            key={`l${zone}`}
            className={`zone-pop absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${pill} ${tone}`}
            style={{ left: cx + rm * Math.cos(axis), top: cy + rm * Math.sin(axis) }}
          >
            <Icon size={18} strokeWidth={1.5} />
            <span className="text-fine font-semibold leading-none">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
