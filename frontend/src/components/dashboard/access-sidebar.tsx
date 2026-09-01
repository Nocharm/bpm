"use client";

// 대시보드 우측 사이드바 — 에디터 인스펙터형. sysadmin 전용 설정 2탭.
// Access: 열람 권한(인원·부서·그룹). Coverage: 커버리지 % 분모가 되는 부서 목록.
// 게이팅(sysadmin 노출 여부)은 이 컴포넌트가 아니라 호출부(설정 패널)가 담당한다.
// 탭 배열 구조라 추후 일반 유저용 탭을 더할 수 있다 (design 2026-07-11).
// 스타일은 새벽 하늘 프레임 안 유리 패널 전제(dashboard-panel이 유일한 호출부) — 밝은 텍스트는
// canvas/불투명도, 액센트는 accent-sky 파생색. SearchSelect는 공용이라 라이트 입력 필드로 남긴다.

import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SearchSelect, type SelectOption } from "@/components/search-select";
import {
  ApiError,
  addDashboardPermission,
  deleteDashboardPermission,
  getCoverageDepts,
  getDirectory,
  listDashboardPermissions,
  listGroups,
  setCoverageDepts,
  type DashboardPermission,
  type Directory,
  type Group,
  type PrincipalType,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

export interface AccessSidebarProps {
  onToast?: (message: string) => void;
  // 커버리지 부서 목록이 바뀌면 호출 — 중앙 "부서별 도입 현황" 카드가 마운트 1회 fetch한
  // summary를 쓰므로, 이 사이드바가 저장한 뒤 그 카드가 재조회하도록 부모에게 알려야 한다.
  onCoverageChange?: () => void;
}

type SidebarTab = "access" | "coverage";

const SIDEBAR_TABS: { id: SidebarTab; labelKey: MessageKey }[] = [
  { id: "access", labelKey: "dashboard.sidebarAccess" },
  { id: "coverage", labelKey: "dashboard.sidebarCoverage" },
];

const PRINCIPAL_TABS: { id: PrincipalType; labelKey: MessageKey }[] = [
  { id: "user", labelKey: "dashboard.principalUser" },
  { id: "department", labelKey: "dashboard.principalDepartment" },
  { id: "group", labelKey: "dashboard.principalGroup" },
];

/** principal_type 원값(user/department/group)을 행 표시용 라벨로 — 서버는 영문 소문자를 그대로 준다. */
function principalLabel(type: PrincipalType, t: (key: MessageKey) => string): string {
  const entry = PRINCIPAL_TABS.find((candidate) => candidate.id === type);
  return entry ? t(entry.labelKey) : type;
}

/** org_path → 한글 부서명. coverage-depts API는 경로 문자열만 주므로 디렉터리에서 조인. */
function resolveDeptLabel(path: string, directory: Directory | null): string {
  const dept = directory?.departments.find((entry) => entry.id === path);
  return dept ? dept.korean_name || dept.name : path;
}

export function AccessSidebar({ onToast, onCoverageChange }: AccessSidebarProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SidebarTab>("access");
  const [permissions, setPermissions] = useState<DashboardPermission[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  // 로드 실패 표식 — 빈 목록과 구별해야 한다. 실패 시 "권한/부서 없음" 문구 대신 이 배너를 보여준다.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [perms, depts, dir, groupList] = await Promise.all([
          listDashboardPermissions(),
          getCoverageDepts(),
          getDirectory(),
          listGroups(),
        ]);
        if (!alive) return;
        setPermissions(perms);
        setCoverage(depts);
        setDirectory(dir);
        setGroups(groupList.filter((group) => group.status === "active"));
      } catch {
        // 토스트는 t/onToast를 effect deps에 끌어들여 매 렌더 재요청을 유발하므로 여기선 쓰지 않는다
        // (mount-only 관례, cf. ai-chat-settings-panel). 대신 본문에 실패 배너를 렌더해 빈 상태와 구별한다.
        if (alive) setLoadFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 피커 후보 — principalType에 따라 바뀐다. 부서는 org_path, 그룹은 id 문자열이 값.
  // 이미 권한이 있는 principal은 후보에서 제외 — 안 그러면 같은 사람을 다시 골라 확정적으로 409가 난다
  // (Coverage 탭 피커와 동일 관례).
  function buildPrincipalOptions(): SelectOption[] {
    const granted = new Set(
      permissions
        .filter((row) => row.principal_type === principalType)
        .map((row) => row.principal_id),
    );
    if (principalType === "user") {
      return (directory?.users ?? [])
        .filter((entry) => !granted.has(entry.id))
        .map((entry) => ({
          value: entry.id,
          label: entry.name,
          sub: entry.department,
          keywords: `${entry.id} ${entry.korean_name ?? ""}`,
        }));
    }
    if (principalType === "department") {
      return (directory?.departments ?? [])
        .filter((dept) => !granted.has(dept.id))
        .map((dept) => ({
          value: dept.id,
          label: dept.korean_name || dept.name,
          sub: dept.id,
          keywords: dept.name,
        }));
    }
    return groups
      .filter((group) => !granted.has(String(group.id)))
      .map((group) => ({
        value: String(group.id),
        label: group.name,
        sub: group.description,
      }));
  }

  async function handleGrant(principalId: string): Promise<void> {
    if (!principalId) return;
    try {
      const created = await addDashboardPermission(principalType, principalId);
      setPermissions((prev) => [created, ...prev]);
    } catch (err) {
      // 중복 부여(409)는 원인이 드러나야 한다 — 조용히 삼키면 사용자가 왜 안 되는지 알 수 없다.
      if (err instanceof ApiError && err.status === 409) {
        onToast?.(t("dashboard.accessDuplicate"));
      } else {
        onToast?.(humanizeApiError(err, t));
      }
    }
  }

  async function handleRevoke(permissionId: number): Promise<void> {
    try {
      await deleteDashboardPermission(permissionId);
      setPermissions((prev) => prev.filter((row) => row.id !== permissionId));
    } catch (err) {
      onToast?.(humanizeApiError(err, t));
    }
  }

  // 커버리지는 항상 전체 목록을 PUT — 서버가 통째 교체(멱등)한다. 부분 갱신 API는 없다.
  async function saveCoverage(next: string[]): Promise<void> {
    try {
      const saved = await setCoverageDepts(next);
      setCoverage(saved);
      onToast?.(t("dashboard.coverageSaved"));
      onCoverageChange?.();
    } catch (err) {
      onToast?.(humanizeApiError(err, t));
    }
  }

  return (
    <aside
      data-id="dashboard-sidebar"
      className="relative z-[1] flex w-80 shrink-0 flex-col border-l border-surface/15 bg-surface/5"
    >
      <div className="flex border-b border-surface/15">
        {SIDEBAR_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-id={`dashboard-sidebar-tab-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={`flex-1 px-3 py-2 text-caption transition-colors ${
              tab === entry.id
                ? "border-b-2 border-accent-sky text-accent-sky"
                : "text-canvas/50 hover:bg-surface/10 hover:text-canvas"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      <div className="bpm-sky-scroll flex-1 overflow-y-auto p-4">
        {loadFailed ? (
          // 로드 실패는 빈 목록과 구별되어야 한다 — "권한 없음" 문구 대신 실패 배너만 렌더.
          <div
            data-id="dashboard-sidebar-load-failed"
            className="flex items-center gap-2 rounded-sm border border-surface/15 bg-surface/10 px-3 py-2"
          >
            <TriangleAlert
              size={16}
              strokeWidth={1.5}
              className="shrink-0"
              // error 원색은 남색 하늘에서 가라앉는다 — 밝힌 파생색(inline mix)으로만 사용
              style={{ color: "color-mix(in srgb, var(--color-error) 55%, white)" }}
            />
            <span className="min-w-0 flex-1 text-caption text-canvas/80">
              {t("dashboard.sidebarLoadFailed")}
            </span>
          </div>
        ) : tab === "access" ? (
          <div className="flex flex-col gap-3">
            <p className="text-fine text-canvas/60">{t("dashboard.accessDesc")}</p>

            <div className="flex gap-1">
              {PRINCIPAL_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setPrincipalType(entry.id)}
                  className={`flex-1 rounded-sm px-2 py-1 text-fine transition-colors ${
                    principalType === entry.id
                      ? "bg-accent-sky/15 text-accent-sky"
                      : "border border-surface/20 text-canvas/70 hover:bg-surface/10"
                  }`}
                >
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>

            {/* value="" 고정 — 목록에서 고르는 즉시 추가되는 원샷 피커(그룹 벌크모달과 동일 관례) */}
            <SearchSelect
              value=""
              options={buildPrincipalOptions()}
              emptyLabel={t("dashboard.accessAdd")}
              placeholder={t("dashboard.accessAdd")}
              onChange={(value) => void handleGrant(value)}
            />

            {permissions.length === 0 ? (
              <p className="text-fine text-canvas/60">{t("dashboard.accessEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {permissions.map((row) => (
                  <li
                    key={row.id}
                    data-id="dashboard-access-row"
                    className="flex items-center gap-2 rounded-sm border border-surface/15 bg-surface/5 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-canvas">
                        {row.display_name}
                      </span>
                      <span className="block truncate text-fine text-canvas/55">
                        {principalLabel(row.principal_type, t)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(row.id)}
                      aria-label={t("dashboard.accessRemove")}
                      title={t("dashboard.accessRemove")}
                      className="shrink-0 rounded-sm p-1 text-canvas/50 hover:bg-surface/10 hover:text-canvas"
                    >
                      <X size={16} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-fine text-canvas/60">{t("dashboard.coverageDesc")}</p>

            <SearchSelect
              value=""
              options={(directory?.departments ?? [])
                .filter((dept) => !coverage.includes(dept.id))
                .map((dept) => ({
                  value: dept.id,
                  label: dept.korean_name || dept.name,
                  sub: dept.id,
                  keywords: dept.name,
                }))}
              emptyLabel={t("dashboard.coverageAdd")}
              placeholder={t("dashboard.coverageAdd")}
              onChange={(value) => {
                if (value) void saveCoverage([...coverage, value]);
              }}
            />

            <ul className="flex flex-col gap-1">
              {coverage.map((path) => (
                <li
                  key={path}
                  data-id="dashboard-coverage-row"
                  className="flex items-center gap-2 rounded-sm border border-surface/15 bg-surface/5 px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-canvas">
                      {resolveDeptLabel(path, directory)}
                    </span>
                    <span className="block truncate text-fine text-canvas/55">{path}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void saveCoverage(coverage.filter((entry) => entry !== path))}
                    aria-label={t("dashboard.accessRemove")}
                    title={t("dashboard.accessRemove")}
                    className="shrink-0 rounded-sm p-1 text-canvas/50 hover:bg-surface/10 hover:text-canvas"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
