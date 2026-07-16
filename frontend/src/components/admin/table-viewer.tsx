"use client";

// DB 테이블 뷰어 — sysadmin 전용 읽기전용. 테이블 pill 선택(행수) → 카드(헤더 바 + 무한 스크롤) (A1+A6, Image #2) /
// Read-only DB viewer (sysadmin): table pills (with counts) → a card with a header bar + infinite scroll.
// 데이터: GET /api/admin/tables(이름+행수), /api/admin/tables/{name}(서버측 정렬/필터/페이징).

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Table2, Trash2 } from "lucide-react";

import { getDbTable, listDbTables, type TableData, type TableInfo } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

import { NotificationPurgeModal } from "./notification-purge-modal";

const PAGE_SIZE = 50; // 무한 스크롤 1회 로드 행수 / rows per scroll-load
const FILTER_DEBOUNCE_MS = 300;
const SPINNER_MIN_MS = 420; // 추가 로드 스피너 최소 노출 — 빠른 로컬 DB 깜빡임 방지
const SCROLL_THRESHOLD_PX = 80; // 하단 80px 도달 시 다음 페이지

type Order = "asc" | "desc";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function TableViewer() {
  const { t } = useI18n();

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<TableData["rows"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0); // 마지막 로드 완료 page (.then에서 설정)
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("asc");
  const [filterInput, setFilterInput] = useState("");
  const [query, setQuery] = useState(""); // debounced filter applied to fetch
  const [refreshTick, setRefreshTick] = useState(0); // 퍼지 등 page 불변 갱신 강제 트리거 — setPage(1) no-op(이미 1) 대응

  // notifications 전용 기간 퍼지 — 다른 테이블에선 노출되지 않음 (selected === "notifications" 가드)
  const [purgeFrom, setPurgeFrom] = useState("");
  const [purgeTo, setPurgeTo] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeResult, setPurgeResult] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false); // 스크롤 트리거 동기 가드

  const loaded = rows.length;
  const hasMore = loaded < total;
  const isFetching = Boolean(selected) && page > loadedPage;

  // 테이블 목록(+행수) (mount) / Table names with row counts.
  useEffect(() => {
    let active = true;
    void listDbTables()
      .then((info) => {
        if (active) setTables(info);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  // 필터 입력 디바운스 → query (+ page 1 리셋) / Debounce filter; reset to page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(filterInput.trim());
      setPage(1);
      setLoadedPage(0);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filterInput]);

  // 데이터 조회 — page 1=교체, page>1=append. 정렬/필터/테이블 변경은 핸들러에서 page 1 리셋.
  useEffect(() => {
    if (!selected) return;
    let active = true;
    loadingRef.current = true;
    const fetchP = getDbTable(selected, {
      page,
      size: PAGE_SIZE,
      sort: sort ?? undefined,
      order,
      q: query || undefined,
    });
    // 추가 로드(스크롤)만 스피너 최소 노출 — 첫 페이지는 즉시 표시.
    const settled =
      page > 1
        ? Promise.all([fetchP, new Promise((r) => setTimeout(r, SPINNER_MIN_MS))]).then(([res]) => res)
        : fetchP;
    settled
      .then((result) => {
        if (!active) return;
        setColumns(result.columns);
        setTotal(result.total);
        setRows((prev) => (page === 1 ? result.rows : [...prev, ...result.rows]));
        setLoadedPage(page);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        loadingRef.current = false;
      });
    return () => {
      active = false;
    };
  }, [selected, page, sort, order, query, refreshTick]);

  // 테이블 pill 선택 — 누적/정렬/필터 초기화 / Pick a table; reset accumulation, sort, filter.
  const selectTable = (name: string) => {
    setSelected(name);
    setColumns([]);
    setRows([]);
    setTotal(0);
    setPage(1);
    setLoadedPage(0);
    setSort(null);
    setOrder("asc");
    setFilterInput("");
    setQuery("");
  };

  // 헤더 클릭 정렬 — 같은 컬럼이면 방향 토글, page 1로 리셋 / Header sort; reset to page 1.
  const onSort = (col: string) => {
    if (sort === col) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setOrder("asc");
    }
    setPage(1);
    setLoadedPage(0);
  };

  // 하단 80px 도달 시 다음 페이지 append (loadingRef로 중복 방지) / Load next page near bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingRef.current || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX) {
      loadingRef.current = true;
      setPage((p) => p + 1);
    }
  };

  // 셀 렌더 — visibility 컬럼은 public/private 배지, 그 외 텍스트 / visibility column as a badge.
  function renderCell(col: string, value: unknown) {
    const text = formatCell(value);
    if (col === "visibility" && (text === "public" || text === "private")) {
      return (
        <span
          className={`inline-flex rounded-sm border px-1.5 py-0.5 text-fine ${
            text === "public" ? "border-added text-added" : "border-divider text-ink-tertiary"
          }`}
        >
          {text}
        </span>
      );
    }
    return text;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-strong text-ink">{t("db.tablesTab")}</p>

      {/* 테이블 선택 pill — 아이콘 + 이름 + 행수 / table selector pills */}
      <div className="flex flex-wrap gap-2">
        {tables.map((tbl) => {
          const active = tbl.name === selected;
          return (
            <button
              key={tbl.name}
              type="button"
              onClick={() => selectTable(tbl.name)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-caption transition-colors ${
                active
                  ? "border-accent-tint-border bg-accent-tint text-accent"
                  : "border-hairline text-ink-secondary hover:bg-surface-alt hover:text-ink"
              }`}
            >
              <Table2 size={14} strokeWidth={1.5} className="shrink-0" />
              {tbl.name}
              <span className="opacity-60">{tbl.count}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {!selected && <p className="text-caption text-ink-tertiary">{t("db.pickPrompt")}</p>}

      {/* 카드 — 헤더 바(테이블명 + 필터 + 카운트) + 무한 스크롤 표 / Card: header bar + scroll table */}
      {selected && (
        <div className="overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface-alt px-4 py-2.5">
            <span className="text-caption-strong text-ink">{selected}</span>
            <div className="flex items-center gap-3">
              <input
                type="text"
                className="w-48 rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink outline-none focus:border-accent placeholder:text-ink-tertiary"
                placeholder={t("db.filterPlaceholder")}
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
              />
              {total > 0 && (
                <span className="shrink-0 text-fine text-ink-tertiary">
                  {t("db.rowsTotalShown", { total, loaded })}
                </span>
              )}
              {selected === "notifications" && (
                <span className="flex items-center gap-1.5 text-fine text-ink-tertiary">
                  <input type="date" value={purgeFrom} onChange={(e) => setPurgeFrom(e.target.value)}
                    className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink" />
                  –
                  <input type="date" value={purgeTo} onChange={(e) => setPurgeTo(e.target.value)}
                    className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink" />
                  <button
                    type="button"
                    disabled={!purgeFrom || !purgeTo || purgeTo < purgeFrom}
                    onClick={() => setPurgeOpen(true)}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-error disabled:opacity-40"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                    {t("db.purgeButton")}
                  </button>
                  {purgeResult !== null && (
                    <span className="text-ink-tertiary">{t("db.purgeDeleted", { count: purgeResult })}</span>
                  )}
                </span>
              )}
            </div>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="max-h-[60vh] overflow-auto">
            <table className="w-full text-fine">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                  {columns.map((col) => (
                    <th key={col} className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-ink"
                        onClick={() => onSort(col)}
                      >
                        {col}
                        {sort === col &&
                          (order === "asc" ? (
                            <ArrowUp size={12} strokeWidth={1.5} />
                          ) : (
                            <ArrowDown size={12} strokeWidth={1.5} />
                          ))}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !isFetching ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-center text-ink-tertiary"
                      colSpan={columns.length || 1}
                    >
                      {t("db.empty")}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr key={i} className="border-b border-divider last:border-0 hover:bg-surface-alt">
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="max-w-[28rem] truncate px-3 py-2 text-ink"
                          title={formatCell(row[col])}
                        >
                          {renderCell(col, row[col])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* 추가 로드 스피너 / 끝 표시 (스크롤 컨테이너 내부) */}
            {isFetching && (
              <div className="flex items-center justify-center gap-2 py-3 text-fine text-ink-tertiary">
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                {t("db.loading")}
              </div>
            )}
            {!isFetching && !hasMore && loaded > 0 && (
              <p className="py-3 text-center text-fine text-ink-tertiary">{t("db.allLoaded")}</p>
            )}
          </div>
        </div>
      )}

      {purgeOpen && (
        <NotificationPurgeModal
          from={purgeFrom}
          to={purgeTo}
          onClose={() => setPurgeOpen(false)}
          onPurged={(deleted) => {
            setPurgeResult(deleted);
            setPage(1);
            setLoadedPage(0);
            setRows([]);
            setRefreshTick((t) => t + 1); // page가 이미 1이면 setPage(1)이 no-op → effect 재실행 강제
            void listDbTables().then(setTables); // pill 행수 갱신
          }}
        />
      )}
    </div>
  );
}
