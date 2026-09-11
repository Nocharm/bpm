// 홈 대시보드 — 내 부서 맵 현황. 헤더는 "내 부서"만, 부서명은 헤더 우측 드롭다운(내 조직 경로의 상위까지 범위 확장, 선택은
// localStorage bpm.home.dashDeptScope에 영속). 고아 참조·SP 미지정 지표 + 상태 분포 + 최근 갱신 3행, 맵 수·트리 보기는 하단 행.
// 부서 없는 유저는 빈 상태.
"use client";

import { Building2, Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import type { MapSummary } from "@/lib/api";
import { countByStatus, sortForStatus, summarizeDept } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import { filterMyDeptMaps } from "@/lib/org-tree";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { useGoToMenu } from "@/components/maps/go-to-menu";
import { StatusBar, StatusLegend } from "@/components/maps/status-distribution";

const ROW_CAP = 3;
const SCOPE_KEY = "bpm.home.dashDeptScope";

// 내 org_path의 조상 경로 목록 — 리프부터 루트까지 ("A/B/C" → ["A/B/C", "A/B", "A"])
function listScopePaths(orgPath: string): string[] {
  const segs = orgPath.split("/").filter(Boolean);
  return segs.map((_, i) => segs.slice(0, segs.length - i).join("/"));
}

// 저장된 범위 복원 — 현재 경로의 조상이 아니면(부서 이동 등) 리프로 되돌린다
function readScope(orgPath: string): string {
  if (typeof window === "undefined" || !orgPath) return orgPath;
  try {
    const saved = window.localStorage.getItem(SCOPE_KEY) ?? "";
    return listScopePaths(orgPath).includes(saved) ? saved : orgPath;
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
}

const SCOPE_PILL = "inline-flex h-6 max-w-48 items-center gap-1 rounded-sm border border-hairline bg-surface px-2 text-fine text-ink-secondary";

export function DeptMapsCard({ maps, orgPath, deptLabel, onSelect, onShowInTree }: DeptMapsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const [scope, setScope] = useState(() => readScope(orgPath));
  const scopePaths = useMemo(() => listScopePaths(orgPath), [orgPath]);
  const scoped = useMemo(() => (scope ? filterMyDeptMaps(maps, scope) : []), [maps, scope]);
  const stats = useMemo(() => summarizeDept(scoped), [scoped]);
  const counts = useMemo(() => countByStatus(scoped), [scoped]);
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
      className={`${SCOPE_PILL} hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent-elevated`}
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
      aside={scopeAside}
    >
      {scoped.length === 0 ? (
        <DashboardEmpty
          icon={<Building2 size={14} strokeWidth={1.5} />}
          text={orgPath ? t("home.dash.deptEmpty") : t("home.dash.deptNone")}
        />
      ) : (
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
          </div>
          <StatusBar counts={counts} />
          <StatusLegend counts={counts} selected={null} />
          <div className="px-3 pb-1.5 text-fine text-ink-tertiary">{t("home.dash.deptRecent")}</div>
          {recent.map((m) => <DashboardMapRow key={m.id} map={m} meta={ago(m.updated_at)} onSelect={onSelect} />)}
          {/* 맵 수 + 트리 보기는 목록 맨 아래(내 문서의 링크아웃 행과 같은 자리) */}
          <DashboardFoot label={t("home.dash.deptFoot", { n: stats.total })} onClick={onShowInTree} />
        </>
      )}
      {menu}
    </DashboardSection>
  );
}
