// 프로세스 라이브러리 패널 — 등록된 맵 목록을 검색하고 캔버스로 드래그해 하위프로세스 노드를 생성.
// 미등록(미지정) 맵은 토글로 노출 — 같은 드래그로 놓으면 캔버스 쪽에서 경고 확인+등록 요청이 이어진다.
// 하단 New map은 검색어가 있을 때만 — 그 이름으로 생성 즉시 링크 (spec 2026-07-19).
"use client";

import { Network, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { listLibraryProcesses, type LibraryProcess } from "@/lib/api";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { filterByQuery } from "@/lib/search";
import { closesCycle } from "@/lib/subprocess-embed";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

export interface ProcessLibraryPanelProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  onClose: () => void;
  // 새 맵 생성 즉시 링크 — 에디터의 addLinkNodeFromMap 스레딩
  onAddLinkNode: (linkedMapId: number, name: string) => void;
}

export function ProcessLibraryPanel({
  currentMapId,
  linkedMapIds,
  onClose,
  onAddLinkNode,
}: ProcessLibraryPanelProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LibraryProcess[]>([]);
  // 미등록(미지정) 맵 노출 토글 — 켜면 include_undesignated로 재조회(가시성 필터는 서버)
  const [showUnregistered, setShowUnregistered] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listLibraryProcesses(showUnregistered).then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, [showUnregistered]);

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
    // 미등록 맵은 최신 추종으로만 링크(핀 없음) — 드롭 쪽에서 경고 확인+등록 요청 체인을 연다
    const pinned = row.designated ? (row.latest_published_version_id ?? row.latest_version_id) : null;
    e.dataTransfer.setData(
      "application/bpm-process-pinned",
      pinned !== null ? String(pinned) : "",
    );
    if (!row.designated) e.dataTransfer.setData("application/bpm-process-unregistered", "1");
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
        <label
          data-id="library-unregistered-toggle"
          className="mt-1.5 flex cursor-pointer items-center gap-1.5 px-0.5 text-fine text-ink-tertiary"
        >
          <input
            type="checkbox"
            checked={showUnregistered}
            onChange={() => setShowUnregistered((v) => !v)}
          />
          {t("library.showUnregistered")}
        </label>
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
            const alreadyLinked = linkedMapIds.has(row.map_id);
            const blocked =
              row.map_id === currentMapId ||
              alreadyLinked ||
              closesCycle(row.map_id, currentMapId, refsByMap);
            const blockedReason = alreadyLinked ? t("library.alreadyLinked") : t("library.cycleBlocked");
            const unregistered = !row.designated;
            // 미등록 맵도 다른 맵과 같은 드래그로 — 드롭 시 캔버스 쪽에서 경고 확인+등록 요청 체인
            return (
              <div
                key={row.map_id}
                data-map-id={row.map_id}
                draggable={!blocked}
                onDragStart={blocked ? undefined : (e) => handleDragStart(e, row)}
                title={blocked ? blockedReason : row.name}
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
                  {unregistered ? (
                    <span
                      data-id="library-unregistered-badge"
                      className="self-start rounded-xs border border-hairline px-1 py-px text-fine text-ink-tertiary"
                    >
                      {t("library.notRegistered")}
                    </span>
                  ) : (
                    row.department && (
                      // 지정 부서 칩 — 지정 어트리뷰트의 대표값 (spec 2026-07-06)
                      <span
                        data-id="library-department-chip"
                        className="self-start rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine text-accent"
                      >
                        {row.department}
                      </span>
                    )
                  )}
                </span>
              </div>
            );
          })
        )}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>

      {/* footer — 검색어가 있을 때만: 그 이름으로 새 맵 생성, 생성 즉시 현재 맵에 링크 */}
      {query.trim() !== "" && (
        <div className="border-t border-divider p-1">
          <button
            type="button"
            data-id="library-new-map"
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-caption font-medium text-accent hover:bg-surface-alt"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} strokeWidth={1.5} className="shrink-0" />
            {t("library.newMapNamedPrefix") !== "" && (
              <span className="shrink-0">{t("library.newMapNamedPrefix")}</span>
            )}
            <span className="min-w-0 max-w-[8rem] truncate rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine">
              &quot;{query.trim()}&quot;
            </span>
            {t("library.newMapNamedSuffix") !== "" && (
              <span className="shrink-0">{t("library.newMapNamedSuffix")}</span>
            )}
          </button>
        </div>
      )}
      {showCreate && (
        <CreateMapDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
          initialName={query.trim() || undefined}
          onCreatedMap={(createdMapId, createdName) => {
            setShowCreate(false);
            onAddLinkNode(createdMapId, createdName);
          }}
        />
      )}
    </div>
  );
}
