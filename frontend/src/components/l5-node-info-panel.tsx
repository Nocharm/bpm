"use client";
// L5 캔버스 좌하단 "기타 정보" 플로팅 — subprocess 노드 호버 시 이양·업데이트·해제 시각 (spec 2026-09-06 §7.1)
import { Info } from "lucide-react";

import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

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
  if (info === null) return null;
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
      // bottom-36(144px) — 미니맵(MinimapFade, position="bottom-left")이 15-120px(RF 패널 margin 15px +
      // 187×105 미니맵)을 점유해 그 위로 띄운다.
      className="pointer-events-none absolute bottom-36 left-4 z-20 flex w-64 flex-col gap-1 rounded-md border border-hairline bg-surface/95 p-3 shadow-md"
    >
      <div className="flex items-center gap-1.5 text-caption-strong text-ink">
        <Info size={14} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
        <span className="truncate">{info.name}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-fine text-ink-tertiary">{t("framework.nodeInfo.empty")}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fine">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-ink-tertiary">{t(r.key)}</dt>
              <dd className="text-ink tabular-nums">{formatKstShort(r.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
