"use client";

// 알림 기간 퍼지 모달 — preview(고유 묶음)를 체크박스로 확정 후 하드 삭제 (sysadmin, design 2026-07-16)

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  previewNotificationPurge,
  purgeNotifications,
  type NotificationPurgeGroup,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const keyOf = (g: NotificationPurgeGroup) => `${g.type}::${g.message}`;

export function NotificationPurgeModal({
  from,
  to,
  onClose,
  onPurged,
}: {
  from: string;
  to: string;
  onClose: () => void;
  onPurged: (deleted: number) => void;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<NotificationPurgeGroup[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 언마운트 후 setState 가드 — runPurge catch 보호 (preview effect의 alive와 동일 목적)
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    previewNotificationPurge(from, to)
      .then((data) => {
        if (!alive) return;
        setGroups(data);
        setChecked(new Set(data.map(keyOf))); // 기본 전체 선택
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runPurge = async () => {
    if (!groups || busy) return;
    setBusy(true);
    setError(null);
    try {
      const confirmed = groups
        .filter((g) => checked.has(keyOf(g)))
        .map((g) => ({ type: g.type, message: g.message }));
      const result = await purgeNotifications(from, to, confirmed);
      onPurged(result.deleted);
      onClose();
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const totalRows = (groups ?? [])
    .filter((g) => checked.has(keyOf(g)))
    .reduce((sum, g) => sum + g.count, 0);

  return (
    <div
      className="fixed inset-0 z-[1340] flex items-center justify-center bg-ink/30"
      onClick={() => {
        if (!busy) onClose(); // purge in-flight 중 닫힘 차단 — onPurged가 다른 테이블 상태를 오염시키는 경로 방지
      }}
    >
      <div
        className="flex max-h-[80vh] w-[36rem] flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-body-strong text-ink">{t("db.purgeTitle")}</p>
        <p className="text-caption text-ink-secondary">
          {t("db.purgeRange", { from, to })}
        </p>
        {error && <p className="text-caption text-error">{error}</p>}
        {groups === null ? (
          // preview 로드 실패(error) 시 스피너 숨김 — 에러와 무한 로딩 동시 표시 모순 방지
          !error && (
            <div className="flex items-center gap-2 py-6 text-caption text-ink-tertiary">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
              {t("db.loading")}
            </div>
          )
        ) : groups.length === 0 ? (
          <p className="py-6 text-caption text-ink-tertiary">{t("db.purgeEmpty")}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-hairline">
            {groups.map((g) => {
              const key = keyOf(g);
              return (
                <li key={key} className="border-b border-divider last:border-0">
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-alt">
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      onChange={() => toggle(key)}
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-caption text-ink">{g.message}</span>
                      <span className="text-fine text-ink-tertiary">
                        {g.type} · {t("db.purgeRecipients", { count: g.count })} ·{" "}
                        {formatKstShort(g.first_at)} – {formatKstShort(g.last_at)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          >
            {t("db.purgeCancel")}
          </button>
          <button
            type="button"
            disabled={busy || checked.size === 0 || (groups ?? []).length === 0}
            onClick={() => void runPurge()}
            className="inline-flex items-center gap-1 rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent disabled:opacity-40"
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t("db.purgeConfirm", { count: totalRows })}
          </button>
        </div>
      </div>
    </div>
  );
}
