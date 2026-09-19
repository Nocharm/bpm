// 업무 체계 레벨 필(L1~L5) — 홈 드릴다운 헤더·요약 카드·탐색 모달·대시보드가 공유. 같은 액센트 색을 레벨이 깊어질수록
// 옅게(100→75→55→30→12%) 깔아 색만으로도 레벨이 구분된다(사용자 지시 2026-09-19). SVG(탐색 다이어그램 태그)는
// LEVEL_FILL_OPACITY로 같은 사다리를 쓴다.

// 레벨 인덱스(1~5) → 배경 불투명도. 범위 밖은 마지막 값
export const LEVEL_FILL_OPACITY = [1, 0.75, 0.55, 0.3, 0.12] as const;

const LEVEL_CLASS = [
  "bg-accent text-on-accent",
  "bg-accent/75 text-on-accent",
  "bg-accent/55 text-on-accent",
  "bg-accent/30 text-accent",
  "bg-accent-tint text-accent",
] as const;

export function getLevelPillClass(level: number): string {
  return LEVEL_CLASS[Math.min(Math.max(level, 1), LEVEL_CLASS.length) - 1];
}

// 레벨 이하 글자색이 흰색인지(L1~L3) — SVG 태그 텍스트 색 결정용
export function isLevelInverted(level: number): boolean {
  return level <= 3;
}

interface LevelPillProps {
  level: number;
  // sm=11px 행 배지(요약 카드 하위 행·검색 결과), md=기본(헤더·제목)
  size?: "sm" | "md";
  className?: string;
  dataId?: string;
}

export function LevelPill({ level, size = "md", className = "", dataId }: LevelPillProps) {
  const sizing = size === "sm" ? "px-1.5 py-0.5 text-[11px] leading-none" : "px-2 py-0.5 text-fine";
  return (
    <span
      data-id={dataId}
      data-level={level}
      className={`inline-flex shrink-0 items-center rounded-full font-semibold ${sizing} ${getLevelPillClass(level)} ${className}`}
    >
      L{level}
    </span>
  );
}
