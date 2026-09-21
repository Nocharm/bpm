"use client";

// 홈 필터 필 — page.tsx에서 분리(측정 복제용 재사용, Task 8). 두 줄(사용자 지시 2026-09-21, 2차 재구성):
// top = 정렬(공개 범위 탭·해제 아이콘은 page.tsx가 같은 줄에 직접 그린다),
// main = Status · Role · (부서 뷰) Issues · Type. Status/Role/Type은 UI 언어와 무관하게 영어 고정(사용자 지시),
// Type = SP·L5 캔버스·업무 체계 등록을 한 필로 통합(서로 배타적 성격, 그룹 안 OR).
// display 단계(full/label/icon)를 받아 각 FilterDropdown에 그대로 전달한다.

import {
  ArrowDownUp,
  Building2,
  CircleDot,
  CircleSlash2,
  Crown,
  Eye,
  Network,
  PencilLine,
  Shapes,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { getDisabledKinds, type MapKind } from "@/lib/map-kind";
import { MAP_SORT_KEYS, type MapSortKey } from "@/lib/map-sort";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_STYLE } from "@/lib/version-status";
import type { FilterDisplayMode } from "@/lib/filter-display";
import { FilterDropdown } from "@/components/maps/filter-dropdown";

// 상태 필터 필 순서 — 초안/검토중/승인됨/반려/게시/확정 / status filter pills order.
const STATUS_ORDER = ["draft", "pending", "approved", "rejected", "published", "confirmed"] as const;
const SORT_LABEL: Record<MapSortKey, "home.sortUpdated" | "home.sortName" | "home.sortCreated"> = {
  updated: "home.sortUpdated",
  name: "home.sortName",
  created: "home.sortCreated",
};

export interface HomeFilterPillsProps {
  display: FilterDisplayMode;
  // true: dataId 미부여(중복 셀렉터 방지) — 측정 복제용 / true when rendered as an offscreen measurement clone.
  measureOnly?: boolean;
  // 라이브 줄은 내용 폭 비례로 행을 채운다(측정 복제는 자연폭)
  stretch?: boolean;
  row: "top" | "main";
  homeView: "departments" | "framework";
  statusFilter: Set<string>;
  onToggleStatus: (v: string) => void;
  permFilter: Set<string>;
  onTogglePerm: (v: string) => void;
  sortKey: MapSortKey;
  onSetSort: (v: MapSortKey) => void;
  owningFilter: Set<string>;
  onToggleOwning: (v: string) => void;
  kindFilter: Set<string>;
  onToggleKind: (v: string) => void;
}

export function HomeFilterPills(props: HomeFilterPillsProps) {
  const { t } = useI18n();
  const { display, measureOnly, row, stretch, homeView } = props;
  const dataId = (id: string) => (measureOnly ? undefined : id);
  const optIcon = (Icon: typeof Crown) => <Icon size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
  // Type — 현재 선택과 교집합이 없는 옵션은 비활성(lib/map-kind 배타 표)
  const disabledKinds = getDisabledKinds(props.kindFilter);
  const kindOption = (value: MapKind, label: string, Icon: typeof Crown) => ({
    value,
    label,
    icon: optIcon(Icon),
    disabled: disabledKinds.has(value),
    disabledHint: "No overlap with the current selection",
  });

  if (row === "top") {
    // 정렬 — 단일 선택, 항상 하나가 켜져 있다(기본 최근 수정순). 필터 해제 대상은 아니다
    return (
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
    );
  }

  return (
    <>
      <FilterDropdown
        label="Status"
        dataId={dataId("home-status-filter")}
        icon={<CircleDot size={14} strokeWidth={1.5} />}
        display={display}
        stretch={stretch}
        options={STATUS_ORDER.map((s) => ({
          value: s,
          label: VERSION_STATUS_LABEL_EN[s],
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
        label="Role"
        dataId={dataId("home-role-filter")}
        icon={<ShieldCheck size={14} strokeWidth={1.5} />}
        display={display}
        stretch={stretch}
        options={[
          { value: "owner", label: "Owner", icon: optIcon(Crown) },
          { value: "editor", label: "Editor", icon: optIcon(PencilLine) },
          { value: "viewer", label: "Viewer", icon: optIcon(Eye) },
        ]}
        selected={props.permFilter}
        onToggle={props.onTogglePerm}
      />
      {homeView === "departments" && (
        <>
          {/* 필 라벨은 영어 고정, 옵션은 UI 언어를 따른다(사용자 지시 2026-09-21) */}
          <FilterDropdown
            label="Issues"
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
            label="Type"
            dataId={dataId("home-type-filter")}
            icon={<Shapes size={14} strokeWidth={1.5} />}
            display={display}
            stretch={stretch}
            options={[
              kindOption("sp", "SP maps", Workflow),
              kindOption("non_sp", "Non-SP maps", CircleSlash2),
              kindOption("canvas", "L5 canvases", Workflow),
              kindOption("registered", "In the framework", Network),
              kindOption("unregistered", "Not in the framework", CircleSlash2),
            ]}
            selected={props.kindFilter}
            onToggle={props.onToggleKind}
          />
        </>
      )}
    </>
  );
}
