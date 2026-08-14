"use client";

// 직원 디렉터리 + AD 전체 동기화 — 어드민 콘솔 "Employees" 탭 / Employee directory + AD sync.
// 서버 /api/employees·/sync는 require_admin으로 보호됨(프론트 게이팅과 별개).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  getAppSettings,
  listEmployees,
  putAppSettings,
  syncEmployees,
  type AppSettings,
  type EmployeeRow,
  type SyncSummary,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, RolePill, TableCard } from "./admin-table";
import { ExportCsvButton } from "./export-csv-button";

/** 노출 직책 카드 — EDW distinct 직책(available_positions) 중 부서장 표기로 쓸 항목(exposed_positions) 체크·저장.
 *  exposed에는 있는데 available엔 없는 항목(수집 전 기본값 4종)도 목록에 얹어 체크 유지. */
function ExposedPositionsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    void getAppSettings()
      .then((result) => {
        if (alive) {
          setSettings(result);
          setDraft(new Set(result.exposed_positions));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const positions = settings
    ? [
        ...settings.available_positions,
        ...settings.exposed_positions.filter((p) => !settings.available_positions.includes(p)),
      ]
    : [];

  const toggle = (position: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };

  const onSave = async () => {
    setBusy(true);
    setMsg("");
    try {
      const next = await putAppSettings({ exposed_positions: [...draft] });
      setSettings(next);
      setDraft(new Set(next.exposed_positions));
      setMsg(t("admin.exposedPositionsSaved"));
    } catch (err) {
      setMsg(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-alt p-4"
      data-id="exposed-positions-card"
    >
      <p className="text-caption-strong text-ink">{t("admin.exposedPositionsTitle")}</p>
      <p className="text-fine text-ink-tertiary">{t("admin.exposedPositionsHint")}</p>
      {settings !== null &&
        (positions.length === 0 ? (
          <p className="text-fine text-ink-tertiary">{t("admin.exposedPositionsEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {positions.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary"
              >
                <input
                  type="checkbox"
                  checked={draft.has(p)}
                  onChange={() => toggle(p)}
                  className="h-3.5 w-3.5"
                />
                {p}
              </label>
            ))}
          </div>
        ))}
      <div className="flex items-center justify-between gap-3">
        {msg && <p className="text-fine text-ink-tertiary">{msg}</p>}
        <button
          type="button"
          data-id="exposed-positions-save"
          onClick={() => void onSave()}
          disabled={busy || !settings}
          className="ml-auto rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
        >
          {t("admin.exposedPositionsSave")}
        </button>
      </div>
    </div>
  );
}

export function EmployeeTable() {
  const { t } = useI18n();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
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
      // position null = 패스 미실행(N8N_POSITION_URL 미설정 or LDAP off) — 미입력 원인 즉시 판별용
      const positionInfo =
        s.position_refreshed === null
          ? "positions: pass not run"
          : `positions ${s.position_refreshed} · unmatched ${s.position_unmatched ?? 0}${
              s.position_unmatched_sample.length > 0
                ? ` (e.g. ${s.position_unmatched_sample.slice(0, 3).join(", ")})`
                : ""
            }`;
      setMsg(
        s.aborted_reason
          ? `aborted — ${s.aborted_reason}`
          : `scanned ${s.scanned} · upserted ${s.upserted} · deactivated ${s.deactivated} · deleted ${s.deleted} · skipped ${s.skipped} · ${positionInfo}`,
      );
      setRows(await listEmployees());
    } catch (err) {
      setMsg(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  // 화면 표와 동일 컬럼·값 — status는 표와 같은 formatter(active t()), 전체 rows 기준(25행 슬라이스 무관)
  const getExportRows = (): string[][] => [
    ["loginId", "name", "korean name", "korean dept", "title", "department", "role", "status", "source"],
    ...rows.map((r) => [
      r.login_id,
      r.name,
      r.korean_name,
      r.korean_dept,
      r.title,
      r.department,
      r.role,
      r.active ? t("perm.sysadmin.userStatusActive") : t("perm.sysadmin.userStatusInactive"),
      r.source,
    ]),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-body-strong text-ink">{t("admin.title")}</p>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            dataId="employees-export-csv"
            filename={`bpm-employees-${new Date().toISOString().slice(0, 10)}.csv`}
            getRows={getExportRows}
            disabled={rows.length === 0}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void onSync()}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                {t("admin.syncing")}
              </>
            ) : (
              t("admin.sync")
            )}
          </button>
        </div>
      </div>
      {msg && <p className="text-fine text-ink-tertiary">{msg}</p>}
      <ExposedPositionsCard />
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
            <th className={ADMIN_TH}>status</th>
            <th className={ADMIN_TH}>source</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.login_id} className={ADMIN_ROW}>
              <td className={ADMIN_TD}>{r.login_id}</td>
              <td className={ADMIN_TD}>
                <div className="flex items-center gap-2">
                  <span>{r.name}</span>
                  {/* 시스템 관리자 태그 — 읽기 전용(env 관리), 구 사용자 탭에서 이전 */}
                  {r.is_sysadmin && (
                    <span
                      className="rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent"
                      title={t("perm.sysadmin.userSysadminNote")}
                    >
                      {t("perm.sysadmin.userSysadminTag")}
                    </span>
                  )}
                </div>
              </td>
              <td className={ADMIN_TD}>{r.korean_name}</td>
              <td className={ADMIN_TD}>{r.korean_dept}</td>
              <td className={ADMIN_TD}>{r.title}</td>
              <td className={ADMIN_TD}>{r.department}</td>
              <td className={ADMIN_TD}>
                <RolePill role={r.role} />
              </td>
              <td className={ADMIN_TD}>
                {/* AD active 상태 — userAccountControl bit 0x2 파생, 구 사용자 탭에서 이전 */}
                <span className={r.active ? "text-ink" : "text-ink-tertiary"}>
                  {r.active
                    ? t("perm.sysadmin.userStatusActive")
                    : t("perm.sysadmin.userStatusInactive")}
                </span>
              </td>
              <td className={`${ADMIN_TD} text-ink-tertiary`}>{r.source}</td>
            </tr>
          ))}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td className={ADMIN_TD} colSpan={9} />
            </tr>
          )}
        </tbody>
      </TableCard>
    </div>
  );
}
