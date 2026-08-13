"use client";

// 부서 탭 — 조직도 트리 테이블(들여쓰기·접기) + 소멸 부서 재지정(대상은 트리 모달로 선택).
// 경로 세그먼트 내 "/"는 백엔드가 전각 슬래시로 새니타이즈해 split 안전 (2026-08 9910 검증 개편).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  type AdminUser,
  type DeptRemapItem,
  type DirectoryDept,
  getAdminUsers,
  getDeptRemap,
  getDirectory,
  postDeptRemap,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { formatRosterName, getDeptMembers } from "@/lib/korean-dept";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";
import { buildDeptPathTree, DeptTreePicker } from "./dept-tree-picker";
import { ExportCsvButton } from "./export-csv-button";

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary";

const ROSTER_TOOLTIP_W = 288; // w-72 — 우측 가장자리 근처 행 호버 시 뷰포트 밖으로 넘치지 않게 클램프
const ROSTER_MARGIN = 8; // 뷰포트 가장자리 최소 여백 (search-select.tsx MARGIN과 동일 값)

/**
 * 인원수 호버 명단 툴팁 — 이름 필(언어 토글 연동), 25행 청킹.
 * `dept-table-scroll`(max-h-[60vh] overflow-y-auto)이 클립 컨테이너가 되어 하단 행에서
 * absolute 배치가 잘리므로 body 포털 + fixed 좌표로 렌더(search-select.tsx 패턴 참고).
 * 포털이라 트리거↔패널이 DOM상 남남 — pt-1 브리지(gap 없는 시각적 여백)는 유지하되,
 * 호버 연속성은 짧은 닫기 지연(cancel-on-enter)으로 보장. 스크롤 중 위치는 재계산하지
 * 않음 — 스크롤로 트리거가 커서 밑에서 벗어나면 mouseleave가 자연히 닫는다.
 */
function RosterHover({ members, count }: { members: AdminUser[]; count: number }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(members, "");

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const openTooltip = () => {
    cancelClose();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = Math.max(ROSTER_MARGIN, window.innerWidth - ROSTER_MARGIN - ROSTER_TOOLTIP_W);
      setPos({ left: Math.min(rect.left, maxLeft), top: rect.bottom });
    }
    setOpen(true);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <span ref={triggerRef} onMouseEnter={openTooltip} onMouseLeave={scheduleClose}>
      <span className="cursor-help text-ink-secondary underline decoration-dotted">{count}</span>
      {open &&
        pos &&
        createPortal(
          <div
            className="fixed z-[1350] pt-1"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
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
          </div>,
          document.body,
        )}
    </span>
  );
}

interface DeptRow {
  path: string;
  name: string;
  koreanName: string;
  depth: number;
  hasChildren: boolean;
}

/** 조직도 트리 평탄화 — 전 직원 경로의 전 프리픽스를 노드로, collapsedSet에 있는 경로의 자식은 생략.
 *  화면 렌더(collapsed 상태 반영)와 CSV 전체 내보내기(빈 Set — 접힘 무관 전체 행)에서 공유. */
function flattenDeptRows(
  adminPaths: string[],
  adminKorean: Map<string, string>,
  dirDepts: DirectoryDept[],
  collapsedSet: Set<string>,
): DeptRow[] {
  const koreanByPath = new Map<string, string>();
  for (const d of dirDepts) if (d.korean_name) koreanByPath.set(d.id, d.korean_name);
  for (const [p, k] of adminKorean) if (!koreanByPath.has(p)) koreanByPath.set(p, k);
  const roots = buildDeptPathTree(
    adminPaths.map((p) => ({
      id: p,
      name: p.split("/").at(-1) ?? p,
      korean_name: koreanByPath.get(p) ?? "",
    })),
  );
  const flat: DeptRow[] = [];
  const walk = (node: { path: string; name: string; koreanName: string; depth: number; children: unknown[] }): void => {
    flat.push({
      path: node.path,
      name: node.name,
      koreanName: node.koreanName || (koreanByPath.get(node.path) ?? ""),
      depth: node.depth,
      hasChildren: node.children.length > 0,
    });
    if (!collapsedSet.has(node.path)) {
      for (const c of node.children) walk(c as typeof node);
    }
  };
  roots.forEach(walk);
  return flat;
}

export function DepartmentTable() {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  // 관리 테이블 소스 — 전 직원(퇴직자 포함) 경로. 선택 모달은 active만(dirDepts).
  const [adminPaths, setAdminPaths] = useState<string[]>([]);
  const [adminKorean, setAdminKorean] = useState<Map<string, string>>(new Map());
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 재지정 적용 후 재조회 트리거 — reloadKey 범프(effect 내 함수 dep 회피)
  const [reloadKey, setReloadKey] = useState(0);
  // 소멸 부서(조직개편 잔재) 참조 목록 + 행별 재지정 대상 선택
  const [missingRefs, setMissingRefs] = useState<DeptRemapItem[]>([]);
  const [remapTargets, setRemapTargets] = useState<Record<string, string>>({});
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [remapBusy, setRemapBusy] = useState(false);
  const [remapMsg, setRemapMsg] = useState("");

  useEffect(() => {
    getAdminUsers()
      .then((data) => {
        setUsers(data.users);
        setAdminPaths(data.departments.map((d) => d.org_levels.join("/")).filter(Boolean));
        setAdminKorean(
          new Map(
            data.departments
              .filter((d) => d.korean_name)
              .map((d) => [d.org_levels.join("/"), d.korean_name]),
          ),
        );
      })
      .catch((err: unknown) => setError(humanizeApiError(err, t)));
    // active 기준 부서(피커·한글명 보강) — 퇴직자만 남은 부서는 여기 안 온다
    getDirectory()
      .then((dir) => setDirDepts(dir.departments))
      .catch(() => setDirDepts([]));
    getDeptRemap()
      .then(setMissingRefs)
      .catch(() => setMissingRefs([]));
  }, [reloadKey, t]);

  const applyRemap = async (fromPath: string) => {
    const toPath = remapTargets[fromPath];
    if (!toPath) return;
    setRemapBusy(true);
    setRemapMsg("");
    try {
      const res = await postDeptRemap(fromPath, toPath);
      setRemapMsg(
        `${fromPath} → ${toPath} · grants ${res.map_grants} · group members ${res.group_members} · owning maps ${res.owning_maps}`,
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      setRemapMsg(humanizeApiError(err, t));
    } finally {
      setRemapBusy(false);
    }
  };

  // 조직도 트리 — 전 직원 경로의 전 프리픽스를 노드로(중간 부서 포함), 접기 상태 반영해 평탄화
  const rows: DeptRow[] = useMemo(
    () => flattenDeptRows(adminPaths, adminKorean, dirDepts, collapsed),
    [adminPaths, adminKorean, dirDepts, collapsed],
  );

  // CSV는 접힘 상태와 무관하게 전체 트리 — 빈 Set으로 전 행 평탄화
  const getExportRows = (): string[][] => {
    const full = flattenDeptRows(adminPaths, adminKorean, dirDepts, new Set());
    return [
      [t("perm.sysadmin.deptColName"), t("admin.deptKrCol"), t("perm.sysadmin.deptColCount")],
      ...full.map((row) => [
        row.name,
        row.koreanName,
        String(getDeptMembers(users, row.path.split("/")).length),
      ]),
    ];
  };

  if (error) {
    return (
      <div className="text-caption text-error">Failed to load departments: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 소멸 부서 재지정 — 조직개편으로 사라진 경로를 참조하는 권한/그룹 멤버/오우닝 일괄 이동 */}
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
                  owning: String(ref.owning_maps),
                })}
              </span>
              <button
                type="button"
                data-id="dept-remap-target-btn"
                className="max-w-[16rem] truncate rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink hover:bg-surface-alt"
                title={remapTargets[ref.path] ?? ""}
                onClick={() => setPickingFor(ref.path)}
              >
                {remapTargets[ref.path] ?? t("admin.deptRemapPick")}
              </button>
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

      <div className="flex justify-end">
        <ExportCsvButton
          dataId="departments-export-csv"
          filename={`bpm-departments-${new Date().toISOString().slice(0, 10)}.csv`}
          getRows={getExportRows}
          disabled={rows.length === 0}
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto" data-id="dept-table-scroll">
        <TableCard>
          <thead>
            <tr className={ADMIN_HEAD_ROW}>
              <th className={ADMIN_TH}>{t("perm.sysadmin.deptColName")}</th>
              <th className={ADMIN_TH}>{t("admin.deptKrCol")}</th>
              <th className={ADMIN_TH}>{t("perm.sysadmin.deptColCount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const members = getDeptMembers(users, row.path.split("/"));
              return (
                <tr key={row.path} className={ADMIN_ROW} data-id="dept-row">
                  <td className={ADMIN_TD}>
                    <span
                      className="flex items-center gap-1"
                      style={{ paddingLeft: `${row.depth * 16}px` }}
                    >
                      {row.hasChildren ? (
                        <button
                          type="button"
                          data-id="dept-row-toggle"
                          className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt"
                          aria-label={collapsed.has(row.path) ? "expand" : "collapse"}
                          onClick={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.path)) next.delete(row.path);
                              else next.add(row.path);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(row.path) ? (
                            <ChevronRight size={13} strokeWidth={1.5} />
                          ) : (
                            <ChevronDown size={13} strokeWidth={1.5} />
                          )}
                        </button>
                      ) : (
                        <span className="w-[18px] shrink-0" />
                      )}
                      <span className="truncate" title={row.path}>{row.name}</span>
                    </span>
                  </td>
                  <td className={ADMIN_TD} data-id="dept-kr-cell">{row.koreanName}</td>
                  <td className={ADMIN_TD}>
                    <RosterHover members={members} count={members.length} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      </div>

      {pickingFor !== null && (
        <DeptTreePicker
          title={t("admin.deptPickTitle")}
          departments={dirDepts.map((d) => ({ id: d.id, name: d.name, korean_name: d.korean_name }))}
          onPick={(path) => {
            setRemapTargets((prev) => ({ ...prev, [pickingFor]: path }));
            setPickingFor(null);
          }}
          onClose={() => setPickingFor(null)}
        />
      )}
    </div>
  );
}
