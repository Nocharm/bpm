// 홈 대시보드 — 내 부서 맵 현황. 헤더는 "내 부서"만, 부서명은 헤더 우측 드롭다운(내 조직 경로의 상위까지 범위 확장, 선택은
// localStorage bpm.home.dashDeptScope에 영속). 목록·지표는 고른 부서가 직접 소유한 맵만(하위 부서 맵은 건수 한 줄로만 —
// 사용자 지시 2026-09-11). 건수를 누르면 하위 부서 모달(dept-sub-maps-modal) — 거기서 고른 부서는 내 조직 체인 밖이어도 범위가
// 되며 드롭다운 맨 위에 끼워 넣는다. 고아 참조·SP 미지정 지표 + 상태 분포 + 최근 갱신 3행, 맵 수·트리 보기는 하단 행. 부서 없는 유저는 빈 상태.
"use client";

import { Building2, Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import type { MapSummary } from "@/lib/api";
import { countByBucket, countByStatus, sortForStatus, summarizeDept } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import { splitDeptMaps } from "@/lib/org-tree";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { DeptSubMapsModal } from "@/components/maps/dept-sub-maps-modal";
import { useGoToMenu } from "@/components/maps/go-to-menu";
import { Distribution, DistributionTabs, VersionChip, toStatusItems, useBucketItems, useDistTab } from "@/components/maps/status-distribution";

const ROW_CAP = 3;
const SCOPE_KEY = "bpm.home.dashDeptScope";

// 내 org_path의 조상 경로 목록 — 리프부터 루트까지 ("A/B/C" → ["A/B/C", "A/B", "A"])
function listScopePaths(orgPath: string): string[] {
  const segs = orgPath.split("/").filter(Boolean);
  return segs.map((_, i) => segs.slice(0, segs.length - i).join("/"));
}

// 범위로 허용되는 경로 — 내 조상 체인, 또는 내 최상위 조직 아래 어딘가(하위 부서 모달에서 고른 부서)
function isAllowedScope(orgPath: string, path: string): boolean {
  const root = orgPath.split("/").filter(Boolean)[0] ?? "";
  return listScopePaths(orgPath).includes(path) || (Boolean(root) && path.startsWith(root + "/"));
}

// 저장된 범위 복원 — 허용 범위 밖이면(부서 이동 등) 리프로 되돌린다
function readScope(orgPath: string): string {
  if (typeof window === "undefined" || !orgPath) return orgPath;
  try {
    const saved = window.localStorage.getItem(SCOPE_KEY) ?? "";
    return saved && isAllowedScope(orgPath, saved) ? saved : orgPath;
  } catch {
    return orgPath;
  }
}

interface DeptMapsCardProps {
  maps: MapSummary[]; // 접근 가능한 전체(필터 전) — 범위 경로로 여기서 거른다
  orgPath: string; // 내 조직 경로("" = 부서 없음)
  deptLabel: string; // 리프 부서명(표시용)
  onSelect: (id: number) => void;
  onShowInTree: () => void; // 좌측 트리 내 부서 섹션으로
  onRevealDept: (path: string) => void; // 좌측 부서 트리에서 해당 부서까지 펼침
}

const SCOPE_PILL = "inline-flex h-6 max-w-48 items-center gap-1 rounded-sm border border-hairline bg-surface px-2 text-fine text-ink-secondary";

export function DeptMapsCard({ maps, orgPath, deptLabel, onSelect, onShowInTree, onRevealDept }: DeptMapsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const [scope, setScope] = useState(() => readScope(orgPath));
  const [subOpen, setSubOpen] = useState(false);
  // 드롭다운 항목 — 내 조상 체인(리프→루트). 모달에서 고른 체인 밖 부서는 맨 위에 끼운다
  const scopePaths = useMemo(() => {
    const chain = listScopePaths(orgPath);
    return scope && !chain.includes(scope) ? [scope, ...chain] : chain;
  }, [orgPath, scope]);
  const { direct: scoped, descendants } = useMemo(() => splitDeptMaps(maps, scope), [maps, scope]);
  const stats = useMemo(() => summarizeDept(scoped), [scoped]);
  const counts = useMemo(() => countByStatus(scoped), [scoped]);
  const buckets = useMemo(() => countByBucket(scoped), [scoped]);
  const [tab, setTab] = useDistTab("dept");
  const toBucketItems = useBucketItems();
  const recent = useMemo(() => sortForStatus(scoped, null).slice(0, ROW_CAP), [scoped]);
  const scopeLeaf = scope.split("/").filter(Boolean).at(-1) ?? deptLabel;
  // 범위 드롭다운 — 앵커 버튼 아래에 리프→루트 순으로, 현재 선택은 체크. 저장은 핸들러에서(StrictMode 이펙트 리셋 회피)
  const { menu, openAt } = useGoToMenu();
  const pickScope = (path: string) => {
    setScope(path);
    try {
      window.localStorage.setItem(SCOPE_KEY, path);
    } catch {
      // 저장 실패(프라이빗 모드 등)는 이번 세션 선택만 유지
    }
  };
  const subCountButton = (
    <button
      type="button"
      data-id="home-dept-sub-count"
      title={t("home.dash.subDeptOpen")}
      onClick={(e) => { e.stopPropagation(); setSubOpen(true); }}
      className="inline-flex items-center gap-1 rounded-sm hover:text-accent"
    >
      {t("home.dash.deptSubMaps")}{" "}
      <b className="font-semibold tabular-nums text-ink">{descendants.length}</b>
    </button>
  );
  // 헤더 우측 — 부서명. 상위 부서가 있으면 드롭다운, 리프뿐이면 정적 필
  const scopeAside = !orgPath ? null : scopePaths.length > 1 ? (
    <button
      type="button"
      data-id="home-dept-scope"
      aria-haspopup="menu"
      title={t("home.dash.deptPick")}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openAt(
          { clientX: rect.left, clientY: rect.bottom + 4 },
          scopePaths.map((path) => ({
            label: path.split("/").at(-1) ?? path,
            active: path === scope,
            icon: path === scope ? <Check size={14} strokeWidth={1.5} /> : <Building2 size={14} strokeWidth={1.5} />,
            onSelect: () => pickScope(path),
          })),
        );
      }}
      className={`${SCOPE_PILL} hover:border-ink-tertiary hover:bg-surface-alt hover:text-ink`}
    >
      <span className="truncate">{scopeLeaf}</span>
      <ChevronDown size={12} strokeWidth={1.5} className="shrink-0" />
    </button>
  ) : (
    <span data-id="home-dept-scope" className={SCOPE_PILL}>
      <span className="truncate">{scopeLeaf}</span>
    </span>
  );
  return (
    <DashboardSection
      dataId="home-dept-maps"
      icon={<Building2 size={16} strokeWidth={1.5} />}
      title={t("home.dash.deptTitle")}
      aside={
        <>
          {scopeAside}
          {scoped.length > 0 && <DistributionTabs card="home-dept-maps" value={tab} onChange={setTab} />}
        </>
      }
      // 직속 맵이 없어도 하위 부서에 맵이 있으면 헤더 우측 건수 링크로 모달을 연다
      more={scoped.length === 0 && descendants.length > 0 ? { label: t("home.dash.deptSubMore", { n: descendants.length }), onClick: () => setSubOpen(true) } : undefined}
      empty={
        scoped.length === 0 ? (
          <DashboardEmpty icon={<Building2 size={14} strokeWidth={1.5} />} text={orgPath ? t("home.dash.deptEmpty") : t("home.dash.deptNone")} />
        ) : undefined
      }
    >
      {scoped.length > 0 && (
        <>
          <div className="flex gap-3.5 px-3 pb-2.5 text-fine text-ink-tertiary">
            <span data-id="home-dept-stale">
              {t("home.dash.deptStaleRefs")}{" "}
              <b className={`font-semibold tabular-nums ${stats.staleRefs > 0 ? "text-warn" : "text-ink"}`}>{stats.staleRefs}</b>
            </span>
            <span data-id="home-dept-sp-missing">
              {t("home.dash.deptSpMissing")}{" "}
              <b className={`font-semibold tabular-nums ${stats.spMissing > 0 ? "text-warn" : "text-ink"}`}>{stats.spMissing}</b>
            </span>
            {descendants.length > 0 && subCountButton}
          </div>
          {tab === "status" ? <Distribution items={toStatusItems(counts)} /> : <Distribution items={toBucketItems(buckets)} />}
          <div className="px-3 pb-1.5 text-fine text-ink-tertiary">{t("home.dash.deptRecent")}</div>
          {recent.map((m) => (
            <DashboardMapRow
              key={m.id}
              map={m}
              meta={tab === "version" ? <span className="inline-flex items-center gap-1.5"><VersionChip map={m} />{ago(m.updated_at)}</span> : ago(m.updated_at)}
              onSelect={onSelect}
            />
          ))}
          {/* 맵 수 + 트리 보기는 목록 맨 아래(내 문서의 링크아웃 행과 같은 자리) */}
          <DashboardFoot label={t("home.dash.deptFoot", { n: stats.total })} onClick={onShowInTree} />
        </>
      )}
      {menu}
      {subOpen && (
        <DeptSubMapsModal
          scope={scope}
          maps={descendants}
          onPickDept={(path) => { pickScope(path); onRevealDept(path); }}
          onSelectMap={onSelect}
          onClose={() => setSubOpen(false)}
        />
      )}
    </DashboardSection>
  );
}
