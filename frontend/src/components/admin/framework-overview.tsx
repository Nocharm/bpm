"use client";

// 설정 Framework 탭 — Status 뷰. L5 연계 캔버스 배치 현황판(경로·최신 확정·게이트 상태·Open).
// root_id 생략 1회 호출로 sysadmin=전사·카테고리 관리자=자기 스코프를 서버가 판정한다
// (backend/app/routers/categories.py get_framework_overview, Track C Task 4/7).

import Link from "next/link";
import { useEffect, useState } from "react";

import { getFrameworkOverview, type FrameworkOverviewRow } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "@/components/admin/admin-table";
import { SkeletonRows } from "@/components/permissions/loading-skeleton";

export function FrameworkOverview() {
  const { t } = useI18n();
  const [rows, setRows] = useState<FrameworkOverviewRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void getFrameworkOverview()
      .then((res) => {
        if (active) setRows(res.rows);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // 상태 필 — 캔버스 없음(중립) / Ready(added) / Blocked(error) + 실패 게이트 코드 필 나열
  // (라벨은 framework.gate.* 재사용 — framework-confirm-section.tsx의 게이트 체크리스트와 동일 소스).
  function renderStatus(row: FrameworkOverviewRow) {
    if (row.linkage_map_id === null) {
      return (
        <span className="inline-flex items-center rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
          {t("framework.overview.noCanvas")}
        </span>
      );
    }
    if (row.ready) {
      return (
        <span className="inline-flex items-center rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
          {t("framework.overview.ready")}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center rounded-sm border border-error px-1.5 py-0.5 text-fine text-error">
          {t("framework.overview.blocked")}
        </span>
        {row.failures.map((f) => (
          <span
            key={f.code}
            className="inline-flex items-center rounded-sm border border-error/40 bg-error/10 px-1.5 py-0.5 text-fine text-error"
          >
            {t(`framework.gate.${f.code}` as MessageKey)} ({f.count})
          </span>
        ))}
      </span>
    );
  }

  return (
    <div data-id="framework-overview" className="flex flex-col gap-2">
      {error ? (
        <p data-id="framework-overview-error" className="p-4 text-caption text-error">
          {t("framework.overview.error")}
        </p>
      ) : rows === null ? (
        <SkeletonRows count={4} />
      ) : rows.length === 0 ? (
        <p data-id="framework-overview-empty" className="p-4 text-caption text-ink-tertiary">
          {t("framework.overview.empty")}
        </p>
      ) : (
        <TableCard>
          <thead>
            <tr className={ADMIN_HEAD_ROW}>
              <th className={ADMIN_TH}>{t("framework.overview.pathHeader")}</th>
              <th className={ADMIN_TH}>{t("framework.overview.latestHeader")}</th>
              <th className={ADMIN_TH}>{t("framework.overview.statusHeader")}</th>
              <th className={ADMIN_TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category_id} data-id={`framework-overview-row-${row.category_id}`} className={ADMIN_ROW}>
                <td className={ADMIN_TD}>{row.path}</td>
                <td className={ADMIN_TD}>
                  {row.latest_fw ? (
                    <span className="flex flex-col">
                      <span className="text-ink">{row.latest_fw}</span>
                      {row.confirmed_at && (
                        <span className="text-fine text-ink-tertiary">{formatKstShort(row.confirmed_at)}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-tertiary">{t("framework.notConfirmedShort")}</span>
                  )}
                </td>
                <td className={ADMIN_TD}>{renderStatus(row)}</td>
                <td className={ADMIN_TD}>
                  {row.linkage_map_id !== null && (
                    <Link
                      href={`/maps/${row.linkage_map_id}`}
                      data-id={`framework-overview-open-${row.category_id}`}
                      className="text-fine text-accent hover:underline"
                    >
                      {t("framework.overview.openAction")}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </div>
  );
}
