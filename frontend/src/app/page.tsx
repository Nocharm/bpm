"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { MapCard } from "@/components/maps/map-card";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

export default function MapListPage() {
  const { t } = useI18n();

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 마스터-디테일 선택 / selected map for the detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  // 가시성은 서버가 이미 적용(GET /maps는 접근 가능한 맵만 반환, my_role 동봉) — 클라 재계산 폐기 /
  // Server already filters GET /maps by access and sets my_role; no client recompute.
  const visibleMaps = useMemo(
    () => maps.filter((m) => m.my_role !== null),
    [maps],
  );

  // 선택 파생 — selectedId가 비었거나 삭제된 맵이면 첫 맵으로 폴백(이펙트 없이) /
  // Derive selection: fall back to the first map when none/stale (no effect needed).
  const effectiveSelected =
    selectedId !== null && visibleMaps.some((m) => m.id === selectedId)
      ? selectedId
      : (visibleMaps[0]?.id ?? null);

  return (
    // 페이지는 뷰포트 높이를 채우고 스크롤 안 함 — 리스트만 내부 스크롤 / Page fills height; only the list scrolls.
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      {/* 헤더 — 제목 좌 · New map 우상단 / Title left, New map top-right */}
      <div className="mx-auto mb-4 flex w-full max-w-[72rem] shrink-0 items-center justify-between gap-4">
        <h1 className="text-tagline text-ink">BPM — {t("home.title")}</h1>
        <button
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("perm.createDialog.title")}
        </button>
      </div>

      {error && (
        <p className="mx-auto mb-3 w-full max-w-[72rem] shrink-0 text-caption text-error">{error}</p>
      )}

      {/* 마스터-디테일 — 리스트·상세 같은 폭(flex-1+동일 max-w), min-w로 안 깨지게, 전체 max-w로 중앙 /
          List + detail share equal width (flex-1, same max-w), min-w guards wrapping, centered by max-w. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[72rem] flex-1 gap-4">
        {visibleMaps.length === 0 ? (
          <p className="min-w-[18rem] max-w-[34rem] flex-1 rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
            {t("home.empty")}
          </p>
        ) : (
          <ul className="flex min-w-[18rem] max-w-[34rem] flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {visibleMaps.map((processMap) => (
              <MapCard
                key={processMap.id}
                map={processMap}
                selected={effectiveSelected === processMap.id}
                onSelect={setSelectedId}
              />
            ))}
          </ul>
        )}

        {effectiveSelected !== null && (
          // 상세 — 리스트와 같은 폭. 내부 스크롤·하단 버튼바는 MapDetailCard가 처리 / equal width; scroll+footer inside
          <aside className="hidden min-w-[18rem] max-w-[34rem] flex-1 flex-col rounded-sm border border-hairline bg-surface-alt xl:flex">
            <MapDetailCard
              key={effectiveSelected}
              mapId={effectiveSelected}
              onDelete={(id) => void handleDelete(id)}
            />
          </aside>
        )}
      </div>

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
    </div>
  );
}
