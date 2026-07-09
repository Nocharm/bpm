"use client";

// 직원 디렉터리 + AD 전체 동기화 — 어드민 콘솔 "Employees" 탭 / Employee directory + AD sync.
// 서버 /api/employees·/sync는 require_admin으로 보호됨(프론트 게이팅과 별개).

import { useEffect, useState } from "react";

import {
  listEmployees,
  syncEmployees,
  type EmployeeRow,
  type SyncSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, RolePill, TableCard } from "./admin-table";
import { KoreanNameModal } from "./korean-name-modal";

export function EmployeeTable() {
  const { t } = useI18n();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showKrModal, setShowKrModal] = useState(false);
  // 직원 ~5000행 전량 렌더 부하 방지 — 25행씩 증분(스크롤 끝 센티널 행)
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(rows, "");

  useEffect(() => {
    void listEmployees().then(setRows).catch(() => setRows([]));
  }, []);

  const onSync = async () => {
    setBusy(true);
    setMsg("");
    try {
      const s: SyncSummary = await syncEmployees();
      setMsg(`scanned ${s.scanned} · upserted ${s.upserted} · excluded ${s.excluded}`);
      void listEmployees().then(setRows).catch(() => setRows([]));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-body-strong text-ink">{t("admin.title")}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-id="kr-add-btn"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={() => setShowKrModal(true)}
          >
            {t("admin.krAdd")}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void onSync()}
            disabled={busy}
          >
            {busy ? t("admin.syncing") : t("admin.sync")}
          </button>
        </div>
      </div>
      {msg && <p className="text-fine text-ink-tertiary">{msg}</p>}
      <TableCard>
        <thead>
          <tr className={ADMIN_HEAD_ROW}>
            <th className={ADMIN_TH}>loginId</th>
            <th className={ADMIN_TH}>name</th>
            <th className={ADMIN_TH}>korean name</th>
            <th className={ADMIN_TH}>korean dept</th>
            <th className={ADMIN_TH}>title</th>
            <th className={ADMIN_TH}>department</th>
            <th className={ADMIN_TH}>role</th>
            <th className={ADMIN_TH}>source</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.login_id} className={ADMIN_ROW}>
              <td className={ADMIN_TD}>{r.login_id}</td>
              <td className={ADMIN_TD}>{r.name}</td>
              <td className={ADMIN_TD}>{r.korean_name}</td>
              <td className={ADMIN_TD}>{r.korean_dept}</td>
              <td className={ADMIN_TD}>{r.title}</td>
              <td className={ADMIN_TD}>{r.department}</td>
              <td className={ADMIN_TD}>
                <RolePill role={r.role} />
              </td>
              <td className={`${ADMIN_TD} text-ink-tertiary`}>{r.source}</td>
            </tr>
          ))}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td className={ADMIN_TD} colSpan={8} />
            </tr>
          )}
        </tbody>
      </TableCard>
      {showKrModal && (
        <KoreanNameModal
          rows={rows}
          onClose={() => setShowKrModal(false)}
          onApplied={() => void listEmployees().then(setRows).catch(() => setRows([]))}
        />
      )}
    </div>
  );
}
