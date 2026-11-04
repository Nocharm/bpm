// 맵이 휴지통(삭제 대기)에 있는 실행 알림 칩 — 알림 벨·홈 알림 칸·인박스 카드가 같은 표시를 쓴다(실행을 열 수 없다는 뜻).
"use client";

import { useI18n } from "@/lib/i18n";

interface RunTrashChipProps {
  dataId: string;
}

export function RunTrashChip({ dataId }: RunTrashChipProps) {
  const { t } = useI18n();
  return (
    <span
      data-id={dataId}
      title={t("notif.runInTrashHint")}
      className="shrink-0 rounded-xs border border-notice-border bg-notice px-1 text-[10px] font-semibold leading-4 text-warn"
    >
      {t("notif.runInTrash")}
    </span>
  );
}
