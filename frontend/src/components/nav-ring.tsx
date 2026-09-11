// 지연 이동 카운트다운 링 — 1초 동안 원이 채워지며 돌고, 완료 전 클릭으로 취소할 수 있음을 보여준다(useDelayedNav 짝).
// 홈 대시보드 활동 타일·프로필 버튼·맵 행/카드 열기 버튼이 아이콘 자리에 공유.
"use client";

interface NavRingProps {
  size?: number; // px — 대체할 아이콘과 같은 크기
}

export function NavRing({ size = 16 }: NavRingProps) {
  const r = (size - 3) / 2; // stroke 1.5 안쪽에 맞춘 반지름
  const c = 2 * Math.PI * r;
  return (
    <svg
      data-id="nav-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="nav-ring shrink-0 text-accent"
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} className="opacity-25" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={c}
        className="nav-ring-arc"
        style={{ strokeDashoffset: c }}
      />
    </svg>
  );
}
