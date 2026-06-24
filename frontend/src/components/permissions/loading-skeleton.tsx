// 로딩 스켈레톤 — 데이터 도착 전 "데이터 없음" 대신 표시(F8). animate-pulse 셰이드로 로딩 중임을 알린다.

/** 행 형태 스켈레톤 — 협업자 목록 로딩용. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
          <div className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-surface-alt" />
          <div className="h-3 flex-1 animate-pulse rounded-sm bg-surface-alt" />
          <div className="h-4 w-14 shrink-0 animate-pulse rounded-sm bg-surface-alt" />
        </div>
      ))}
    </div>
  );
}

/** 필 형태 스켈레톤 — 결재자 목록 로딩용. */
export function SkeletonPills({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="h-6 w-20 animate-pulse rounded-sm bg-surface-alt" />
      ))}
    </div>
  );
}
