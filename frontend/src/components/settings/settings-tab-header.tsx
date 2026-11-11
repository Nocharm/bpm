// 설정 탭 머리글 한 벌(제목 · 한 줄 설명 · 오른쪽 동작) — /settings의 모든 탭 패널이 공유한다(고아 참조·대시보드 제외).
import type { ReactNode } from "react";

interface SettingsTabHeaderProps {
  title: string;
  description?: ReactNode;
  /** 머리 오른쪽에 놓는 동작(내보내기·새로 만들기 등) */
  actions?: ReactNode;
}

export function SettingsTabHeader({ title, description, actions }: SettingsTabHeaderProps) {
  return (
    <header data-id="settings-panel-header" className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-body-strong text-ink">{title}</h2>
        {description && <p className="mt-1 text-caption text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
