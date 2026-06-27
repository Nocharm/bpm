"use client";

// 삭제 예정(휴지통) — 소프트삭제된 사용자 그룹 목록 + 복구(확인 모달). 관리 가능분만(sysadmin 전체). (L5)

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { listDeletedGroups, restoreGroup, type Group } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// 백엔드 GROUP_RETENTION(routers/groups.py)과 일치 — 변경 시 양쪽 함께 / mirrors backend GROUP_RETENTION.
const RETENTION_DAYS = 7;

export function DeletedGroupsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingRestore, setPendingRestore] = useState<Group | null>(null); // 복구 확인 대상
  // 마운트 1회 — 렌더 중 Date.now() 금지(순수성) / lazy now for purity.
  const [now] = useState(() => Date.now());

  const purgeLabel = (deletedAt: string): string => {
    const dueMs = new Date(deletedAt).getTime() + RETENTION_DAYS * DAY_MS - now;
    if (dueMs <= HOUR_MS) return t("trash.purgeSoon");
    const days = Math.floor(dueMs / DAY_MS);
    if (days >= 1) return t("trash.purgeInDays", { n: days });
    return t("trash.purgeInHours", { n: Math.floor(dueMs / HOUR_MS) });
  };

  // 초기/재조회 — 인라인 async + active 가드(set-state-in-effect 회피, deleted-maps-panel과 동일).
  useEffect(() => {
    let active = true;
    void listDeletedGroups()
      .then((rows) => {
        if (active) setGroups(rows);
      })
      .catch((err) => {
        if (active) onToast(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [onToast, reloadKey]);

  const handleRestore = async (group: Group) => {
    try {
      await restoreGroup(group.id);
      onToast(t("trash.groupRestored"));
      setReloadKey((k) => k + 1);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-body-strong text-ink">{t("trash.groups")}</h2>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("trash.groupsHint")}</p>
      </div>
      {groups === null ? (
        <p className="text-caption text-ink-tertiary">…</p>
      ) : groups.length === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("trash.groupsEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((g) => (
            <div
              key={g.id}
              data-id="deleted-group-row"
              className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-caption text-ink">{g.name}</span>
                {g.deleted_at && (
                  <span
                    className="text-fine font-semibold text-error"
                    title={`${t("trash.deletedAt")}: ${formatKst(g.deleted_at)}`}
                  >
                    {purgeLabel(g.deleted_at)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt"
                onClick={() => setPendingRestore(g)}
              >
                <RotateCcw size={14} strokeWidth={1.5} />
                {t("trash.restore")}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingRestore && (
        <ConfirmDialog
          icon={<RotateCcw size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmRestoreTitle")}
          message={t("perm.group.confirmRestoreBody")}
          confirmLabel={t("trash.restore")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const target = pendingRestore;
            setPendingRestore(null);
            void handleRestore(target);
          }}
          onClose={() => setPendingRestore(null)}
        />
      )}
    </div>
  );
}
