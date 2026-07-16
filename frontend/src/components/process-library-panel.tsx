// 프로세스 라이브러리 패널 — 등록된 맵 목록을 검색하고 캔버스로 드래그해 하위프로세스 노드를 생성.
"use client";

import { Network, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { listLibraryProcesses, type LibraryProcess } from "@/lib/api";
import { filterByQuery } from "@/lib/search";
import { closesCycle } from "@/lib/subprocess-embed";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

export interface ProcessLibraryPanelProps {
  currentMapId: number;
  onClose: () => void;
}

export function ProcessLibraryPanel({ currentMapId, onClose }: ProcessLibraryPanelProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LibraryProcess[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listLibraryProcesses().then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 패널은 열릴 때마다 새로 마운트되므로 모든 오픈 경로에서 검색창에 포커스된다.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // 순환 참조 판별 맵 — map_id → refs[]
  const refsByMap = useMemo(
    () => new Map(rows.map((r) => [r.map_id, r.refs])),
    [rows],
  );

  // 부분일치+초성+로마자+시퀀스 매칭(filterByQuery) — 이름·부서 대상, 랭크순 정렬
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return filterByQuery(rows, q, (r) => [
      { field: "name", text: r.name },
      { field: "department", text: r.department ?? "" },
    ]).map((h) => h.item);
  }, [rows, query]);
  // 25개씩 증분 렌더 — 라이브러리 맵이 수백 개여도 패널 오픈 부하 없음
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(filtered, query);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, row: LibraryProcess) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/bpm-process", String(row.map_id));
    // stash name + pinned version to avoid needing a shared-state lookup on drop
    e.dataTransfer.setData("application/bpm-process-name", row.name);
    const pinned = row.latest_published_version_id ?? row.latest_version_id;
    e.dataTransfer.setData(
      "application/bpm-process-pinned",
      pinned !== null ? String(pinned) : "",
    );
  }

  return (
    <div
      data-id="process-library-panel"
      className="flex w-56 flex-col border-r border-hairline bg-surface"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <Network size={14} strokeWidth={1.5} />
          {t("library.title")}
        </div>
        <button
          type="button"
          className="rounded-sm p-0.5 text-ink/50 hover:bg-surface-alt hover:text-ink"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* search */}
      <div className="border-b border-hairline px-2 py-1.5">
        <div className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5">
          <Search size={12} strokeWidth={1.5} className="shrink-0 text-ink/40" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.search")}
            className="min-w-0 flex-1 bg-transparent text-fine text-ink outline-none placeholder:text-ink/40"
          />
        </div>
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          // 전체가 비면 지정 안내(지정된 맵만 노출), 검색 결과만 비면 기존 문구
          <p data-id="library-empty-state" className="px-3 py-4 text-center text-fine text-ink/40">
            {rows.length === 0 ? t("library.emptyDesignated") : t("library.empty")}
          </p>
        ) : (
          visible.map((row) => {
            const blocked =
              row.map_id === currentMapId || closesCycle(row.map_id, currentMapId, refsByMap);
            return (
              <div
                key={row.map_id}
                draggable={!blocked}
                onDragStart={blocked ? undefined : (e) => handleDragStart(e, row)}
                title={blocked ? t("library.cycleBlocked") : row.name}
                className={[
                  "flex cursor-grab items-center gap-2 border-b border-hairline px-3 py-2 text-caption text-ink",
                  blocked
                    ? "cursor-not-allowed opacity-40"
                    : "hover:bg-surface-alt active:cursor-grabbing",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Network size={12} strokeWidth={1.5} className="shrink-0 text-ink/50" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="min-w-0 truncate">{row.name}</span>
                  {row.department && (
                    // 지정 부서 칩 — 지정 어트리뷰트의 대표값 (spec 2026-07-06)
                    <span
                      data-id="library-department-chip"
                      className="self-start rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine text-accent"
                    >
                      {row.department}
                    </span>
                  )}
                </span>
              </div>
            );
          })
        )}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>
    </div>
  );
}
