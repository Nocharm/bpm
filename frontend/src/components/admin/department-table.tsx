"use client";

// 부서 테이블 — 기본: 부서명 + 한글부서(임포트값) + 부서장 + 인원수(호버 명단). 디버그 토글(org 보기) 시 인원수 대신 가변 orgLevels 컬럼 /
// Department table — name + imported korean name/manager + member count (roster on hover). Org-view swaps count for org columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.

import { useEffect, useState } from "react";

import {
  type AdminDept,
  type AdminUser,
  type DeptRemapItem,
  getAdminUsers,
  getDeptRemap,
  postDeptRemap,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatRosterName, getDeptMembers } from "@/lib/korean-dept";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { SearchSelect } from "@/components/search-select";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";
import { DeptInfoModal } from "./dept-info-modal";

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary";

/** 인원수 호버 명단 툴팁 — 이름 필(언어 토글 연동), 25행 청킹. 충돌 툴팁과 동일한 호버 연속(pt-1 래퍼). */
function RosterHover({ members, count }: { members: AdminUser[]; count: number }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(members, "");
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help text-ink-secondary underline decoration-dotted">{count}</span>
      {open && (
        <div className="absolute left-0 top-full z-10 pt-1">
          <div
            data-id="dept-roster-tooltip"
            className="flex max-h-64 w-72 flex-col items-start gap-1 overflow-y-auto rounded-md border border-hairline bg-surface p-2 shadow-lg"
          >
            {visible.map((m) => (
              <span key={m.login_id} className={PILL}>
                {formatRosterName(m, lang)}
              </span>
            ))}
            {hasMore && <span ref={sentinelRef} className="h-4 w-full" />}
          </div>
        </div>
      )}
    </span>
  );
}

export function DepartmentTable() {
  const { t } = useI18n();
  const [departments, setDepartments] = useState<AdminDept[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOrg, setShowOrg] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  // 임포트/재지정 적용 후 재조회 트리거 — reloadKey 범프(effect 내 함수 dep 회피)
  const [reloadKey, setReloadKey] = useState(0);
  // 소멸 부서(조직개편 잔재) 참조 목록 + 행별 재지정 대상 선택
  const [missingRefs, setMissingRefs] = useState<DeptRemapItem[]>([]);
  const [remapTargets, setRemapTargets] = useState<Record<string, string>>({});
  const [remapBusy, setRemapBusy] = useState(false);
  const [remapMsg, setRemapMsg] = useState("");

  useEffect(() => {
    getAdminUsers()
      .then((data) => {
        setDepartments(data.departments);
        setUsers(data.users);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    getDeptRemap()
      .then(setMissingRefs)
      .catch(() => setMissingRefs([]));
  }, [reloadKey]);

  const applyRemap = async (fromPath: string) => {
    const toPath = remapTargets[fromPath];
    if (!toPath) return;
    setRemapBusy(true);
    setRemapMsg("");
    try {
      const res = await postDeptRemap(fromPath, toPath);
      setRemapMsg(`${fromPath} → ${toPath} · grants ${res.map_grants} · group members ${res.group_members}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setRemapMsg(err instanceof Error ? err.message : "remap failed");
    } finally {
      setRemapBusy(false);
    }
  };

  // 25행씩 증분 렌더.
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(departments, "");

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce((max, d) => Math.max(max, d.org_levels.length), 0);
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);
  const colCount = showOrg ? 3 + maxOrgDepth : 4;

  // 재지정 대상 옵션 — 현 조직 전체 경로 프리픽스(상위 부서 포함)
  const pathSet = new Set<string>();
  for (const d of departments) {
    for (let i = 1; i <= d.org_levels.length; i++) {
      pathSet.add(d.org_levels.slice(0, i).join("/"));
    }
  }
  const pathOptions = [...pathSet].sort().map((p) => ({ value: p, label: p }));

  if (error) {
    return (
      <div className="text-caption text-error">Failed to load departments: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        {/* 디버그 토글 — org 보기 / Debug toggle: org columns */}
        <label className="flex cursor-pointer items-center gap-2 text-fine text-ink-secondary">
          <input
            type="checkbox"
            checked={showOrg}
            onChange={(e) => setShowOrg(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("perm.sysadmin.deptDebugToggle")}
        </label>
        <button
          type="button"
          data-id="dept-info-add-btn"
          className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
          onClick={() => setShowImportModal(true)}
        >
          {t("admin.deptInfoAdd")}
        </button>
      </div>

      <TableCard>
        <thead>
          <tr className={ADMIN_HEAD_ROW}>
            <th className={ADMIN_TH}>{t("perm.sysadmin.deptColName")}</th>
            <th className={ADMIN_TH}>{t("admin.deptKrCol")}</th>
            <th className={ADMIN_TH}>{t("admin.deptManagerCol")}</th>
            {/* org 미보기 시 인원수 열 / member-count column when org view is off */}
            {!showOrg && <th className={ADMIN_TH}>{t("perm.sysadmin.deptColCount")}</th>}
            {showOrg &&
              orgColIndices.map((i) => (
                <th key={i} className={ADMIN_TH}>
                  {t("perm.sysadmin.deptOrgCol", { n: String(i + 1) })}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((dept, idx) => {
            const members = getDeptMembers(users, dept.org_levels);
            return (
              <tr key={idx} className={ADMIN_ROW} data-id="dept-row">
                <td className={ADMIN_TD}>{dept.name}</td>
                {/* 임포트된 한글 부서명·부서장 — dept_info 조인값 (직원 집계 필은 폐기, 2026-07-09) */}
                <td className={ADMIN_TD} data-id="dept-kr-cell">{dept.korean_name}</td>
                <td className={`${ADMIN_TD} text-ink-secondary`} data-id="dept-manager-cell">
                  {dept.manager}
                </td>
                {!showOrg && (
                  <td className={ADMIN_TD}>
                    <RosterHover members={members} count={members.length} />
                  </td>
                )}
                {showOrg &&
                  orgColIndices.map((i) => (
                    <td key={i} className={`${ADMIN_TD} text-ink-tertiary`}>
                      {dept.org_levels[i] ?? ""}
                    </td>
                  ))}
              </tr>
            );
          })}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td className={ADMIN_TD} colSpan={colCount} />
            </tr>
          )}
        </tbody>
      </TableCard>
      {/* 소멸 부서 재지정 — 조직개편으로 사라진 경로를 참조하는 권한/그룹 멤버 일괄 이동 */}
      {missingRefs.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-alt p-4"
          data-id="dept-remap-card"
        >
          <p className="text-caption-strong text-ink">{t("admin.deptRemapTitle")}</p>
          <p className="text-fine text-ink-tertiary">{t("admin.deptRemapHint")}</p>
          {missingRefs.map((ref) => (
            <div key={ref.path} className="flex items-center gap-3" data-id="dept-remap-row">
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-error">
                {ref.path}
              </span>
              <span className="shrink-0 text-fine text-ink-tertiary">
                {t("admin.deptRemapRefs", {
                  grants: String(ref.map_grants),
                  members: String(ref.group_members),
                })}
              </span>
              <SearchSelect
                fitContent
                value={remapTargets[ref.path] ?? ""}
                options={pathOptions}
                emptyLabel={t("admin.deptRemapPick")}
                placeholder={t("field.searchPlaceholder")}
                onChange={(v) => setRemapTargets((prev) => ({ ...prev, [ref.path]: v }))}
              />
              <button
                type="button"
                data-id="dept-remap-apply"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
                disabled={remapBusy || !remapTargets[ref.path]}
                onClick={() => void applyRemap(ref.path)}
              >
                {t("admin.deptRemapApply")}
              </button>
            </div>
          ))}
          {remapMsg && <p className="text-fine text-ink-tertiary">{remapMsg}</p>}
        </div>
      )}
      {showImportModal && (
        <DeptInfoModal
          onClose={() => setShowImportModal(false)}
          onApplied={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
