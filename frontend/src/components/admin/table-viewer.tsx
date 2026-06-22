"use client";

// DB 테이블 뷰어 — sysadmin 전용 읽기전용 표. 테이블 선택 → 헤더 정렬·필터·페이징(서버측) /
// Read-only DB table viewer (sysadmin). Pick a table → server-side sort/filter/paging.
// 데이터 소스: GET /api/admin/tables, /api/admin/tables/{name} (읽기전용).

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

import { getDbTable, listDbTables, type TableData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// 100행 초과부터 페이징이 의미 있도록 페이지 크기 = 100 / page size so paging kicks in past 100 rows.
const PAGE_SIZE = 100;
const FILTER_DEBOUNCE_MS = 300;

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
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("asc");
  const [filterInput, setFilterInput] = useState("");
  const [query, setQuery] = useState(""); // debounced filter applied to fetch

  // 테이블 목록 / Table names on mount.
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

  // 필터 입력 디바운스 → query (+ 1페이지로) / Debounce filter; reset to page 1 in the timer.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(filterInput.trim());
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filterInput]);

  // 데이터 조회 / Fetch rows for the current table + controls. (selected 없으면 no-op)
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void getDbTable(selected, {
      page,
      size: PAGE_SIZE,
      sort: sort ?? undefined,
      order,
      q: query || undefined,
    })
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [selected, page, sort, order, query]);

  // 헤더 클릭 정렬 — 같은 컬럼이면 방향 토글 / Header click sorts; same column toggles direction.
  const onSort = useCallback(
    (col: string) => {
      if (sort === col) {
        setOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSort(col);
        setOrder("asc");
      }
      setPage(1);
    },
    [sort],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <div className="flex flex-col gap-3">
      {/* 툴바 — 테이블 선택 + 필터 + 행수 / Toolbar: selector + filter + count */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none focus:border-accent"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setData(null);
            setPage(1);
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
            {data && (
              <span className="text-fine text-ink-tertiary">
                {t("db.rowsTotal", { total: data.total })}
              </span>
            )}
          </>
        )}
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {!selected && (
        <p className="text-caption text-ink-tertiary">{t("db.pickPrompt")}</p>
      )}

      {/* 표 / Table */}
      {selected && data && (
        <div className="overflow-x-auto rounded-sm border border-hairline">
          <table className="w-full text-fine">
            <thead>
              <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                {data.columns.map((col) => (
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
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    className="px-2 py-3 text-center text-ink-tertiary"
                    colSpan={data.columns.length}
                  >
                    {t("db.empty")}
                  </td>
                </tr>
              ) : (
                data.rows.map((row, i) => (
                  <tr key={i} className="border-b border-divider hover:bg-surface-alt">
                    {data.columns.map((col) => (
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
        </div>
      )}

      {/* 페이징 — 총 행이 페이지 크기를 넘을 때만 (100행 초과) / Pager only when total exceeds page size */}
      {selected && data && data.total > data.size && (
        <div className="flex items-center justify-end gap-2 text-caption text-ink">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 hover:bg-surface-alt disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
            {t("db.prev")}
          </button>
          <span className="text-fine text-ink-tertiary">
            {t("db.page", { page, pages: totalPages })}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 hover:bg-surface-alt disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            {t("db.next")}
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
