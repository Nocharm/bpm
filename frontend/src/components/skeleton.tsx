// 스켈레톤 플레이스홀더 — 데이터 도착 전 최종 레이아웃과 같은 자리를 잡아 두는 shimmer 블록.
// 빈 상태("맵 없음"·아이디 폴백)를 먼저 그렸다가 데이터로 갈아끼우는 깜빡임을 없애기 위한 공용 조각.
// shimmer 애니메이션과 reduced-motion 가드는 globals.css `.skeleton`.

/** 임의 크기 블록 — 크기·모양은 호출부가 className(height·width·radius)으로 지정한다. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block rounded-sm ${className}`} />;
}

/** 텍스트 한 줄 — 폰트 크기와 무관하게 줄 높이만 흉내낸다(기본 text-caption 대역). */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`h-3 ${className}`} />;
}

/** 필(뱃지) 자리 — 이름 필처럼 인라인으로 흐르는 자리를 채운다. */
export function SkeletonPill({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`skeleton inline-block h-4 w-16 rounded-sm align-middle ${className}`} />
  );
}

/** 맵 카드 자리 — 홈 좌측 목록의 카드 1장 높이에 맞춘 박스. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`rounded-sm border border-hairline bg-surface p-3 ${className}`}>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-4 w-4 shrink-0 rounded-full" />
        <SkeletonLine className="w-2/5" />
        <SkeletonBlock className="ml-auto h-4 w-12 shrink-0" />
      </div>
      <SkeletonLine className="mt-2 w-3/5" />
    </div>
  );
}
