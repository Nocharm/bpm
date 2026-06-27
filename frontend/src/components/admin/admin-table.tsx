// 어드민 콘솔 표 공통 셸 — 둥근 카드 컨테이너 + 헤더/행 스타일 통일 (A5, Image #1) /
// Shared admin-table shell: rounded card container with uniform header/row styling.

import type { ReactNode } from "react";

// 공통 셀 클래스 — 각 표가 자체 컬럼을 유지하되 패딩/톤은 통일 / shared cell classes.
export const ADMIN_TH = "px-4 py-2.5 text-left text-fine font-normal text-ink-tertiary";
export const ADMIN_TD = "px-4 py-2.5 text-caption text-ink";
export const ADMIN_HEAD_ROW = "border-b border-hairline bg-surface-alt";
export const ADMIN_ROW = "border-b border-divider last:border-0 hover:bg-surface-alt";

// 둥근 카드 컨테이너 + 표 — 헤더/행은 호출부에서 공통 클래스로 구성 /
// Rounded card wrapping a <table>; caller supplies thead/tbody with the shared classes.
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-hairline bg-surface">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

// 역할 배지 — 격상 역할은 색 pill, 기본 역할(user/member)은 무지 텍스트 (Image #1) /
// Role pill: elevated roles get a colored outline pill; base roles render as plain text.
export function RolePill({ role }: { role: string }) {
  const key = role.toLowerCase();
  if (key === "admin" || key === "sysadmin") {
    return (
      <span className="inline-flex rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent">
        {role}
      </span>
    );
  }
  if (key === "manager") {
    return (
      <span className="inline-flex rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
        {role}
      </span>
    );
  }
  return <span className="text-ink-secondary">{role}</span>;
}
