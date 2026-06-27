"use client";

// 삭제 예정(휴지통) — 소프트삭제된 맵 목록 + 복구. 오너는 본인 것만, sysadmin은 전체(서버 필터). (DL)

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { listDeletedMaps, restoreMap, type MapSummary } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// 백엔드 RECOVERY_WINDOW(routers/maps.py)와 일치 — 변경 시 양쪽 함께 / mirrors backend RECOVERY_WINDOW.
const RETENTION_DAYS = 7;

export function DeletedMapsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0); // 복구 후 재조회 트리거
  // 마운트 시점 1회 — 렌더 중 Date.now()는 순수성 규칙 위반이라 상태로 고정 / lazy now for purity.
  const [now] = useState(() => Date.now());

  // deleted_at + 보존기간 - now → "N일/시간 뒤 삭제" / remaining time until permanent deletion.
  const purgeLabel = (deletedAt: string): string => {
    const dueMs = new Date(deletedAt).getTime() + RETENTION_DAYS * DAY_MS - now;
    if (dueMs <= HOUR_MS) return t("trash.purgeSoon");
    const days = Math.floor(dueMs / DAY_MS);
    if (days >= 1) return t("trash.purgeInDays", { n: days });
    return t("trash.purgeInHours", { n: Math.floor(dueMs / HOUR_MS) });
  };

  // 초기/재조회 — 인라인 async + active 가드(set-state-in-effect 회피)
  useEffect(() => {
    let active = true;
    void listDeletedMaps()
      .then((rows) => {
        if (active) setMaps(rows);
      })
      .catch((err) => {
        if (active) onToast(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [onToast, reloadKey]);

  const handleRestore = async (id: number) => {
    try {
      await restoreMap(id);
      onToast(t("trash.restored"));
      setReloadKey((k) => k + 1);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-body-strong text-ink">{t("trash.tab")}</h2>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("trash.hint")}</p>
      </div>
      {maps === null ? (
        <p className="text-caption text-ink-tertiary">…</p>
      ) : maps.length === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("trash.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {maps.map((m) => (
            <div
              key={m.id}
              data-id="deleted-map-row"
              className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-caption text-ink">{m.name}</span>
                {m.deleted_at && (
                  <span
                    className="text-fine text-ink-tertiary"
                    title={`${t("trash.deletedAt")}: ${formatKst(m.deleted_at)}`}
                  >
                    {purgeLabel(m.deleted_at)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt"
                onClick={() => void handleRestore(m.id)}
              >
                <RotateCcw size={14} strokeWidth={1.5} />
                {t("trash.restore")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
