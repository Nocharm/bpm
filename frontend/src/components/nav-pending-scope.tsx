// 지연 이동 대기 스코프 — 안쪽 행/타일/버튼이 useDelayedNav로 대기를 시작하면 이 영역 전체를 반투명 레이어로 덮고 가운데에
// 링 + "…로 이동 중" + "클릭하면 취소"를 띄운다(레이어 클릭 = 취소). 홈 대시보드 섹션(DashboardSection)·활동 타일·프로필이 공유.
// 자기 컨테이너를 가진 섹션은 useNavPendingScope + NavPendingOverlay를 직접 쓰고, 나머지는 NavPendingScope 래퍼로 감싼다.
"use client";

import { useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { DelayedNavScopeContext, type DelayedNavPending } from "@/lib/use-delayed-nav";
import { NavRing } from "@/components/nav-ring";
import { SectionOverlay } from "@/components/section-overlay";

export function useNavPendingScope(): [DelayedNavPending | null, (p: DelayedNavPending | null) => void] {
  const [pending, setPending] = useState<DelayedNavPending | null>(null);
  return [pending, setPending];
}

export function NavPendingOverlay({ pending, compact = false }: { pending: DelayedNavPending | null; compact?: boolean }) {
  const { t } = useI18n();
  if (!pending) return null;
  return (
    <SectionOverlay
      dataId="nav-pending-overlay"
      icon={<NavRing size={compact ? 14 : 18} />}
      title={pending.label}
      sub={compact ? t("home.dash.clickToCancelShort") : t("home.dash.clickToCancel")}
      onClick={pending.cancel}
      compact={compact}
    />
  );
}

interface NavPendingScopeProps {
  dataId?: string;
  className?: string; // 레이아웃 클래스 — 래퍼가 relative를 덧붙인다
  compact?: boolean; // 타일 한 칸처럼 작은 스코프 — 레이어를 컴팩트 변형으로
  children: ReactNode;
}

export function NavPendingScope({ dataId, className = "", compact = false, children }: NavPendingScopeProps) {
  const [pending, setPending] = useNavPendingScope();
  return (
    <DelayedNavScopeContext.Provider value={setPending}>
      <div data-id={dataId} className={`relative ${className}`}>
        {children}
        <NavPendingOverlay pending={pending} compact={compact} />
      </div>
    </DelayedNavScopeContext.Provider>
  );
}
