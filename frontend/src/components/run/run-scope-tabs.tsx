"use client";

// 실행 공개 범위 작은 탭 "나만 · 공유" — 새 실행 창 제목 오른쪽과 실행 바 오른쪽이 같이 쓴다(design run-check §4.1·§4.3).
// 누를 수 없는 쪽(공유 → 나만 되돌리기 등)은 aria-disabled로 두고 툴팁으로 이유를 보인다(disabled면 호버가 죽는다).

import { useI18n } from "@/lib/i18n";
import { Tooltip } from "@/components/tooltip";

interface RunScopeTabsProps {
  // data-id 앞부분 — `${prefix}-solo`, `${prefix}-shared`
  dataIdPrefix: string;
  isShared: boolean;
  // 공유 탭 글자(실행 바는 "공유 · n명")
  sharedLabel: string;
  onSolo: () => void;
  onShared: () => void;
  soloDisabledReason?: string;
  sharedDisabledReason?: string;
}

export function RunScopeTabs({
  dataIdPrefix,
  isShared,
  sharedLabel,
  onSolo,
  onShared,
  soloDisabledReason,
  sharedDisabledReason,
}: RunScopeTabsProps) {
  const { t } = useI18n();
  const renderTab = (
    key: "solo" | "shared",
    label: string,
    isPressed: boolean,
    disabledReason: string | undefined,
    onPress: () => void,
  ) => {
    const isDisabled = disabledReason !== undefined;
    const tab = (
      <button
        type="button"
        data-id={`${dataIdPrefix}-${key}`}
        aria-pressed={isPressed}
        aria-disabled={isDisabled}
        className={`rounded-xs px-2 py-0.5 text-fine transition-colors ${
          isPressed
            ? "bg-accent-tint font-semibold text-accent"
            : isDisabled
              ? "cursor-not-allowed text-ink-tertiary"
              : "text-ink-secondary hover:bg-surface-alt"
        }`}
        onClick={() => {
          if (!isDisabled && !isPressed) onPress();
        }}
      >
        {label}
      </button>
    );
    return isDisabled ? (
      <Tooltip key={key} content={disabledReason}>
        {tab}
      </Tooltip>
    ) : (
      <span key={key} className="inline-flex">
        {tab}
      </span>
    );
  };

  return (
    <div
      role="group"
      aria-label={t("run.scope.label")}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5"
    >
      {renderTab("solo", t("run.scope.solo"), !isShared, soloDisabledReason, onSolo)}
      {renderTab("shared", sharedLabel, isShared, sharedDisabledReason, onShared)}
    </div>
  );
}
