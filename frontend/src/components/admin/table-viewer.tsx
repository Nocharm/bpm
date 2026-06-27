"use client";

// DB 테이블 뷰어 — sysadmin 전용 읽기전용 표. 테이블 선택 → 헤더 정렬·필터 + 무한 스크롤(하단 도달 시 append) (A1) /
// Read-only DB table viewer (sysadmin): pick a table → server-side sort/filter + infinite scroll.
// 데이터 소스: GET /api/admin/tables, /api/admin/tables/{name} (읽기전용, 서버측 정렬/필터/페이징).

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";

import { getDbTable, listDbTables, type TableData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const PAGE_SIZE = 50; // 무한 스크롤 1회 로드 행수 / rows per scroll-load
const FILTER_DEBOUNCE_MS = 300;
const SPINNER_MIN_MS = 420; // 추가 로드 스피너 최소 노출 — 빠른 로컬 DB에서 깜빡임 방지
const SCROLL_THRESHOLD_PX = 80; // 하단 80px 도달 시 다음 페이지

type Order = "asc" | "desc";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function TableViewer() {
  const { t } = useI18n();

  const [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<TableData["rows"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0); // 마지막으로 로드 완료한 page (.then에서 설정)
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("asc");
  const [filterInput, setFilterInput] = useState("");
  const [query, setQuery] = useState(""); // debounced filter applied to fetch

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false); // 스크롤 트리거 동기 가드 — 한 번에 한 페이지만

  const loaded = rows.length;
  const hasMore = loaded < total;
  // 요청한 page가 아직 로드 안 됐으면 조회 중 — 동기 setState(effect) 없이 파생.
  const isFetching = Boolean(selected) && page > loadedPage;

  // 테이블 목록 (mount) / Table names.
  useEffect(() => {
    let active = true;
    void listDbTables()
      .then((names) => {
        if (active) setTables(names);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  // 필터 입력 디바운스 → query (+ 1페이지로 리셋) / Debounce filter; reset to page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(filterInput.trim());
      setPage(1);
      setLoadedPage(0);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filterInput]);

  // 데이터 조회 — page 1=교체, page>1=append. 정렬/필터/테이블 변경은 핸들러에서 page=1·loadedPage=0으로 리셋.
  useEffect(() => {
    if (!selected) return; // 미선택 — onChange에서 이미 초기화
    let active = true;
    loadingRef.current = true;
    const fetchP = getDbTable(selected, {
      page,
      size: PAGE_SIZE,
      sort: sort ?? undefined,
      order,
      q: query || undefined,
    });
    // 추가 로드(스크롤)만 스피너 최소 노출 적용 — 첫 페이지는 즉시 표시.
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
  }, [selected, page, sort, order, query]);

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

  return (
    <div className="flex flex-col gap-3">
      {/* 툴바 — 테이블 선택 + 필터 + 로드/전체 행수 / Toolbar: selector + filter + loaded count */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none focus:border-accent"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setColumns([]);
            setRows([]);
            setTotal(0);
            setPage(1);
            setLoadedPage(0);
            setSort(null);
            setOrder("asc");
            setFilterInput("");
            setQuery("");
          }}
        >
          <option value="">{t("db.selectTable")}</option>
          {tables.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {selected && (
          <>
            <input
              type="text"
              className="w-56 rounded-sm border border-hairline bg-transparent px-2 py-1.5 text-caption text-ink outline-none focus:border-accent placeholder:text-ink-tertiary"
              placeholder={t("db.filterPlaceholder")}
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
            />
            {total > 0 && (
              <span className="text-fine text-ink-tertiary">
                {t("db.rowsLoaded", { loaded, total })}
              </span>
            )}
          </>
        )}
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {!selected && <p className="text-caption text-ink-tertiary">{t("db.pickPrompt")}</p>}

      {/* 표 — 내부 스크롤 컨테이너(무한 스크롤) + sticky 헤더 / Scroll container with sticky header */}
      {selected && columns.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-[60vh] overflow-auto rounded-sm border border-hairline"
        >
          <table className="w-full text-fine">
            <thead className="sticky top-0 z-[1]">
              <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-2 py-1.5">
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
                  <td className="px-2 py-3 text-center text-ink-tertiary" colSpan={columns.length}>
                    {t("db.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="border-b border-divider hover:bg-surface-alt">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="max-w-[28rem] truncate px-2 py-1 text-ink"
                        title={formatCell(row[col])}
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 로딩 스피너 / 끝 표시 (스크롤 컨테이너 내부) */}
          {isFetching && (
            <div className="flex items-center justify-center py-3 text-ink-tertiary">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            </div>
          )}
          {!isFetching && !hasMore && loaded > 0 && (
            <p className="py-3 text-center text-fine text-ink-tertiary">{t("db.allLoaded")}</p>
          )}
        </div>
      )}
    </div>
  );
}
