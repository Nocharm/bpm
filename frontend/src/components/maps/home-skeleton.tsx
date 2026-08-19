"use client";

// 홈 첫 진입 자리 — 맵 목록·부서 트리가 도착하기 전 같은 레이아웃(좌 1 : 우 2)을 회색으로 잡아 둔다.
// 빈 상태(WelcomePlaceholder)를 먼저 그리면 "맵이 없다"는 잘못된 화면이 1초쯤 보였다가 뒤집힌다.

import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

export function HomeSkeleton() {
  return (
    <div data-id="home-skeleton" className="flex min-h-0 w-full flex-1 gap-4">
      {/* 좌측 — 뷰 토글 · 검색 · 필터 행 · 부서 트리(카드 몇 장) */}
      <div className="flex min-h-0 min-w-[18rem] flex-1 flex-col gap-2">
        <SkeletonBlock className="h-8 w-full" />
        <SkeletonBlock className="h-9 w-full" />
        <div className="flex gap-1.5">
          <SkeletonBlock className="h-6 w-16" />
          <SkeletonBlock className="h-6 w-16" />
          <SkeletonBlock className="h-6 w-20" />
        </div>
        <div className="mt-1 flex flex-col gap-3">
          {[0, 1].map((section) => (
            <div key={section} className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 px-1">
                <SkeletonBlock className="h-3.5 w-3.5 rounded-full" />
                <SkeletonLine className="w-28" />
              </div>
              <div className="flex flex-col gap-2 pl-5 pr-2">
                {[0, 1].map((card) => (
                  <SkeletonCard key={card} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 우측 — 대시보드/상세 패널 자리 (≥split에서만 보이는 것도 실제 레이아웃과 동일) */}
      <div className="hidden min-w-[24rem] flex-[2] flex-col gap-3 rounded-sm border border-hairline bg-surface-alt p-4 split:flex">
        <SkeletonLine className="w-32" />
        <SkeletonBlock className="h-40 w-full" />
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
