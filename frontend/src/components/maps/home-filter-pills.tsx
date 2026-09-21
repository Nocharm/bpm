"use client";

// 홈 필터 필 — page.tsx에서 분리(측정 복제용 재사용, Task 8). 두 줄(사용자 지시 2026-09-21):
// primary = 공개 범위(단일) · 상태 · 권한 · 정렬(단일) — 두 뷰 공용,
// secondary = 이슈 · SP · L5 캔버스 · 업무 체계 등록 — 부서 뷰 전용(업무 체계 뷰는 전부 등록된 맵이라 무의미).
// display 단계(full/label/icon)를 받아 각 FilterDropdown에 그대로 전달한다.

import {
  ArrowDownUp,
  Building2,
  CircleDot,
  CircleSlash2,
  Crown,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Network,
  PencilLine,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { MAP_SORT_KEYS, type MapSortKey } from "@/lib/map-sort";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";
import type { FilterDisplayMode } from "@/lib/filter-display";
import { FilterDropdown } from "@/components/maps/filter-dropdown";

// 상태 필터 필 순서 — 초안/검토중/승인됨/반려/게시 / status filter pills order.
const STATUS_ORDER = ["draft", "pending", "approved", "rejected", "published", "confirmed"] as const;
const SORT_LABEL: Record<MapSortKey, "home.sortUpdated" | "home.sortName" | "home.sortCreated"> = {
  updated: "home.sortUpdated",
  name: "home.sortName",
  created: "home.sortCreated",
};

export type VisibilityFilter = "all" | "public" | "private";

export interface HomeFilterPillsProps {
  display: FilterDisplayMode;
  // true: dataId 미부여(중복 셀렉터 방지) — 측정 복제용 / true when rendered as an offscreen measurement clone.
  measureOnly?: boolean;
  // 라이브 줄은 균등 분할로 채운다(측정 복제는 자연폭)
  stretch?: boolean;
  row: "primary" | "secondary";
  visFilter: VisibilityFilter;
  onSetVis: (v: VisibilityFilter) => void;
  statusFilter: Set<string>;
  onToggleStatus: (v: string) => void;
  permFilter: Set<string>;
  onTogglePerm: (v: string) => void;
  sortKey: MapSortKey;
  onSetSort: (v: MapSortKey) => void;
  owningFilter: Set<string>;
  onToggleOwning: (v: string) => void;
  spFilter: Set<string>;
  onToggleSp: (v: string) => void;
  canvasFilter: Set<string>;
  onToggleCanvas: (v: string) => void;
  registeredFilter: Set<string>;
  onToggleRegistered: (v: string) => void;
}

export function HomeFilterPills(props: HomeFilterPillsProps) {
  const { t } = useI18n();
  const { display, measureOnly, row, stretch } = props;
  const dataId = (id: string) => (measureOnly ? undefined : id);
  const optIcon = (Icon: typeof Crown) => <Icon size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;

  if (row === "secondary") {
    return (
      <>
        <FilterDropdown
          label={t("home.filterOwning")}
          dataId={dataId("home-owning-filter")}
          icon={<Building2 size={14} strokeWidth={1.5} />}
          display={display}
          stretch={stretch}
          options={[
            { value: "missing", label: t("home.owningMissingOption"), icon: optIcon(TriangleAlert) },
            { value: "stale_refs", label: t("home.staleRefsOption"), icon: optIcon(TriangleAlert) },
          ]}
          selected={props.owningFilter}
          onToggle={props.onToggleOwning}
        />
        <FilterDropdown
          label={t("home.filterSp")}
          dataId={dataId("home-sp-filter")}
          icon={<Workflow size={14} strokeWidth={1.5} />}
          display={display}
          stretch={stretch}
          options={[
            { value: "sp", label: t("home.spOption"), icon: optIcon(Workflow) },
            { value: "non_sp", label: t("home.spNonOption"), icon: optIcon(CircleSlash2) },
          ]}
          selected={props.spFilter}
          onToggle={props.onToggleSp}
        />
        <FilterDropdown
          label={t("home.filterCanvas")}
          dataId={dataId("home-canvas-filter")}
          icon={<Workflow size={14} strokeWidth={1.5} />}
          display={display}
          stretch={stretch}
          options={[
            { value: "canvas", label: t("home.canvasOption"), icon: optIcon(Workflow) },
            { value: "non_canvas", label: t("home.canvasNonOption"), icon: optIcon(EyeOff) },
          ]}
          selected={props.canvasFilter}
          onToggle={props.onToggleCanvas}
        />
        <FilterDropdown
          label={t("home.filterRegistered")}
          dataId={dataId("home-registered-filter")}
          icon={<Network size={14} strokeWidth={1.5} />}
          display={display}
          stretch={stretch}
          options={[
            { value: "registered", label: t("home.registeredOption"), icon: optIcon(Network) },
            { value: "unregistered", label: t("home.unregisteredOption"), icon: optIcon(CircleSlash2) },
          ]}
          selected={props.registeredFilter}
          onToggle={props.onToggleRegistered}
        />
      </>
    );
  }

  return (
    <>
      {/* 공개 범위 — 단일 선택: 같은 값을 다시 고르면 전체로 돌아간다(세그먼트 폐기, 다른 필과 같은 단추) */}
      <FilterDropdown
        label={t("home.filterVisibility")}
        dataId={dataId("home-visibility-filter")}
        icon={<Globe size={14} strokeWidth={1.5} />}
        display={display}
          stretch={stretch}
        options={[
          { value: "public", label: t("perm.visibilityPublic"), icon: optIcon(Globe) },
          { value: "private", label: t("perm.visibilityPrivate"), icon: optIcon(Lock) },
        ]}
        selected={new Set(props.visFilter === "all" ? [] : [props.visFilter])}
        onToggle={(v) => props.onSetVis(v === props.visFilter ? "all" : v === "public" ? "public" : "private")}
      />
      <FilterDropdown
        label={t("home.filterStatus")}
        dataId={dataId("home-status-filter")}
        icon={<CircleDot size={14} strokeWidth={1.5} />}
        display={display}
          stretch={stretch}
        options={STATUS_ORDER.map((s) => ({
          value: s,
          label: t(VERSION_STATUS_LABEL[s]),
          icon: (
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${VERSION_STATUS_STYLE[s]}`}
            />
          ),
        }))}
        selected={props.statusFilter}
        onToggle={props.onToggleStatus}
      />
      <FilterDropdown
        label={t("home.filterRole")}
        dataId={dataId("home-role-filter")}
        icon={<ShieldCheck size={14} strokeWidth={1.5} />}
        display={display}
          stretch={stretch}
        options={[
          { value: "owner", label: t("perm.roleOwner"), icon: optIcon(Crown) },
          { value: "editor", label: t("perm.roleEditor"), icon: optIcon(PencilLine) },
          { value: "viewer", label: t("perm.roleViewer"), icon: optIcon(Eye) },
        ]}
        selected={props.permFilter}
        onToggle={props.onTogglePerm}
      />
      {/* 정렬 — 단일 선택, 항상 하나가 켜져 있다(기본 최근 수정순). 필터 해제 대상은 아니다 */}
      <FilterDropdown
        label={t("home.filterSort")}
        dataId={dataId("home-sort-filter")}
        icon={<ArrowDownUp size={14} strokeWidth={1.5} />}
        display={display}
          stretch={stretch}
        options={MAP_SORT_KEYS.map((k) => ({ value: k, label: t(SORT_LABEL[k]) }))}
        selected={new Set([props.sortKey])}
        onToggle={(v) => {
          if (v === "updated" || v === "name" || v === "created") props.onSetSort(v);
        }}
      />
    </>
  );
}
