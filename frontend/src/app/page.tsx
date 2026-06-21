"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import { usePermissions } from "@/lib/mock/permissions-store";
import { isVisibleToUser } from "@/lib/mock/permissions-logic";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

export default function MapListPage() {
  const { t } = useI18n();
  const permState = usePermissions();
  const currentUser = useCurrentMockUser();

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string) => {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.loadMaps"));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await listMaps();
        if (active) {
          setMaps(result);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t("err.loadMaps"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handleDelete = useCallback(
    async (mapId: number) => {
      try {
        await deleteMap(mapId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("err.deleteMap"));
      }
    },
    [refresh, t],
  );

  // 공개범위 필터 — currentUser가 null이면 전체 노출(안전 폴백) /
  // Visibility filter — show all when currentUser is null (safety fallback).
  const visibleMaps = useMemo(() => {
    if (!currentUser) return maps;
    return maps.filter((m) => {
      const mapId = String(m.id);
      // isVisibleToUser covers sysadmin (returns true), public maps, and explicit grants.
      // created_by fallback: pre-existing maps with no mock overlay are visible to their creator.
      return (
        isVisibleToUser(permState, currentUser.id, mapId) ||
        m.created_by === currentUser.id
      );
    });
  }, [maps, permState, currentUser]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-tagline text-ink">BPM — {t("home.title")}</h1>

      <div className="mb-6">
        <button
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("perm.createDialog.title")}
        </button>
      </div>

      {error && <p className="mb-4 text-caption text-error">{error}</p>}

      <ul className="divide-y divide-divider rounded-sm border border-hairline bg-surface">
        {visibleMaps.length === 0 && (
          <li className="p-4 text-caption text-ink-tertiary">{t("home.empty")}</li>
        )}
        {visibleMaps.map((processMap) => (
          <li key={processMap.id} className="flex items-center justify-between p-4 hover:bg-surface-alt">
            <Link
              href={`/maps/${processMap.id}`}
              className="text-body-strong text-ink hover:underline"
            >
              {processMap.name}
            </Link>
            <button
              className="inline-flex items-center gap-1 text-caption text-error hover:bg-surface-alt"
              onClick={() => void handleDelete(processMap.id)}
            >
              <Trash2 size={16} strokeWidth={1.5} />
              {t("home.delete")}
            </button>
          </li>
        ))}
      </ul>

      {dialogOpen && (
        <CreateMapDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            void refresh();
            showToast(t("perm.createDialog.toastSuccess"));
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
