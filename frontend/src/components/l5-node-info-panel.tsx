"use client";
// L5 캔버스 우상단 "기타 정보" 플로팅(framework-l5-tag 자리 대체) — subprocess 호버 시 이양·변경 이력이 있을 때만 표시
import { Info } from "lucide-react";

import { formatKstShort } from "@/lib/datetime";
import { hasSlotHistory } from "@/lib/framework-slot-state";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

export { hasSlotHistory };

export interface L5NodeInfo {
  name: string;
  succeededAt: string | null;
  updatedAt: string | null;
  changedAt: string | null;
  changedAction: string | null;
}

const CHANGE_LABEL: Record<string, MessageKey> = {
  unassign: "framework.nodeInfo.changed.unassign",
  delete: "framework.nodeInfo.changed.delete",
  move: "framework.nodeInfo.changed.move",
  assign: "framework.nodeInfo.changed.assign",
  replace: "framework.nodeInfo.changed.replace",
};

export function L5NodeInfoPanel({ info }: { info: L5NodeInfo | null }) {
  const { t } = useI18n();
  // info === null 체크는 hasSlotHistory(null)===false로 이미 걸러지지만, 아래 info.* 접근을 위한
  // TS 널 내로잉은 이 명시적 비교에서만 나온다(hasSlotHistory는 타입가드가 아닌 평범한 boolean 함수).
  if (info === null || !hasSlotHistory(info)) return null;
  // satisfies로 배열 리터럴 자체를 검증 — .filter() 뒤에 : T[]를 붙이면 contextual typing이 리터럴에
  // 닿지 못해 key가 전부 string으로 widen된다(tsc). 삼항(&&/??아님)은 changedAction의 string 타입이
  // 결과 유니온에 섞여 key가 MessageKey로 좁혀지지 않는 문제를 피한다.
  const rows = (
    [
      { key: "framework.nodeInfo.succeededAt", value: info.succeededAt },
      { key: "framework.nodeInfo.updatedAt", value: info.updatedAt },
      {
        key:
          info.changedAction && CHANGE_LABEL[info.changedAction]
            ? CHANGE_LABEL[info.changedAction]
            : "framework.nodeInfo.changed.other",
        value: info.changedAt,
      },
    ] satisfies { key: MessageKey; value: string | null }[]
  ).filter((r) => r.value);
  return (
    <div
      data-id="l5-node-info-panel"
      // framework-l5-tag와 같은 자리(우상단)를 대체 — 태그 쪽에서 hasSlotHistory(hoverNodeInfo)일 때만
      // 숨겨 정확히 한쪽만 보인다. 태그보다 옅게(80%+blur) + edge-row-in 재사용한 짧은 fade/slide 진입.
      className="motion-safe:animate-[edge-row-in_150ms_var(--ease-smooth)] pointer-events-none absolute right-5 top-5 z-20 flex w-72 flex-col gap-1 rounded-md border border-hairline bg-surface/80 p-3 shadow-md backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 text-caption-strong text-ink">
        <Info size={14} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
        <span className="truncate">{info.name}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fine">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-ink-tertiary">{t(r.key)}</dt>
            <dd className="text-ink tabular-nums">{formatKstShort(r.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
