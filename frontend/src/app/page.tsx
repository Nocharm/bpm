"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { copyMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { filterByQuery } from "@/lib/search";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { MapCard } from "@/components/maps/map-card";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { PromptDialog } from "@/components/prompt-dialog";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

export default function MapListPage() {
  const { t } = useI18n();

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 마스터-디테일 선택 / selected map for the detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mapQuery, setMapQuery] = useState("");
  // 승인본 복사 — 이름 입력 모달(중복 시 error 유지) + 생성 후 새 카드 강조(쉬머) (F12).
  const [copyTarget, setCopyTarget] = useState<{ id: number; name: string } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

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
        showToast(t("home.deletedToast")); // 휴지통 이동 + 복구 안내 (DL)
      } catch (err) {
        setError(err instanceof Error ? err.message : t("err.deleteMap"));
      }
    },
    [refresh, showToast, t],
  );

  // 복사 버튼(맵 상세) → 이름 입력 모달 오픈
  const handleCopyOpen = useCallback((mapId: number, name: string) => {
    setCopyError(null);
    setCopyTarget({ id: mapId, name });
  }, []);

  // 복사 모달 제출 — 중복 이름이면 모달 유지하고 error 표시, 성공하면 목록 갱신 + 새 카드 강조.
  const handleCopySubmit = useCallback(
    async (name: string) => {
      if (copyTarget === null) {
        return;
      }
      try {
        const created = await copyMap(copyTarget.id, name);
        setCopyTarget(null);
        setCopyError(null);
        await refresh();
        setSelectedId(created.id);
        setHighlightId(created.id);
        showToast(t("home.copyCreated"));
        window.setTimeout(() => setHighlightId(null), 2500); // 쉬머 후 해제
      } catch (err) {
        setCopyError(err instanceof Error ? err.message : String(err));
      }
    },
    [copyTarget, refresh, showToast, t],
  );

  // 가시성은 서버가 이미 적용(GET /maps는 접근 가능한 맵만 반환, my_role 동봉) — 클라 재계산 폐기 /
  // Server already filters GET /maps by access and sets my_role; no client recompute.
  const visibleMaps = useMemo(
    () => maps.filter((m) => m.my_role !== null),
    [maps],
  );

  // 검색 필터 — 빈 쿼리면 전체 통과 / search filter; empty query returns all.
  const mapHits = useMemo(
    () =>
      filterByQuery(visibleMaps, mapQuery, (m) => [
        { field: "name", text: m.name },
        { field: "description", text: m.description ?? "" },
      ]),
    [visibleMaps, mapQuery],
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
      {/* 헤더 — 제목 좌 · 검색 중앙 · New map 우상단 / Title left, search center, New map top-right */}
      <div className="mx-auto mb-4 flex w-full max-w-[72rem] shrink-0 items-center justify-between gap-4">
        <h1 data-id="home-title" className="text-tagline text-ink">Business Process Map — {t("home.title")}</h1>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <input
            type="text"
            data-id="home-map-search"
            className="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
            placeholder={t("home.searchPlaceholder")}
            value={mapQuery}
            onChange={(e) => setMapQuery(e.target.value)}
          />
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
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
        {mapHits.length === 0 ? (
          <p className="min-w-[18rem] max-w-[34rem] flex-1 rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
            {t("home.empty")}
          </p>
        ) : (
          <ul className="flex min-w-[18rem] max-w-[34rem] flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {mapHits.map(({ item: processMap, matches }) => (
              <li key={processMap.id} className="flex flex-col">
                <MapCard
                  map={processMap}
                  selected={effectiveSelected === processMap.id}
                  highlighted={highlightId === processMap.id}
                  onSelect={setSelectedId}
                  nameRanges={matches.find((m) => m.field === "name")?.ranges ?? []}
                />
                {/* 폭이 좁을 때(< xl)만 — 선택 카드 아래 펼침 아코디언 / inline accordion below the selected card on narrow screens */}
                <div
                  data-id="map-detail-accordion"
                  className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth xl:hidden ${
                    effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {effectiveSelected === processMap.id && (
                      <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                        <MapDetailCard
                          mapId={processMap.id}
                          onDelete={(id) => void handleDelete(id)}
                          onCopy={handleCopyOpen}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {effectiveSelected !== null && (
          // ≥ xl — 우측 사이드 패널(현행) / wide screens: side panel
          <aside
            data-id="map-detail-aside"
            className="hidden min-w-[18rem] max-w-[34rem] flex-1 flex-col rounded-sm border border-hairline bg-surface-alt xl:flex"
          >
            <MapDetailCard
              key={effectiveSelected}
              mapId={effectiveSelected}
              onDelete={(id) => void handleDelete(id)}
              onCopy={handleCopyOpen}
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

      {copyTarget && (
        <PromptDialog
          title={t("home.copyTitle")}
          label={t("home.copyNameLabel")}
          defaultValue={`${copyTarget.name} (Copy)`}
          confirmLabel={t("home.copyFromApproved")}
          cancelLabel={t("common.cancel")}
          error={copyError}
          onConfirm={(name) => void handleCopySubmit(name)}
          onClose={() => {
            setCopyTarget(null);
            setCopyError(null);
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
