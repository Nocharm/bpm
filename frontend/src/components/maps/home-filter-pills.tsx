"use client";

// 홈 상태·권한·오우닝·SP 필터 필 4종 — page.tsx에서 분리(측정 복제용 재사용, Task 8).
// display 단계(full/label/icon)를 받아 각 FilterDropdown에 그대로 전달한다.

import { Building2, CircleDot, CircleSlash2, Crown, Eye, PencilLine, ShieldCheck, TriangleAlert, Workflow } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";
import type { FilterDisplayMode } from "@/lib/filter-display";
import { FilterDropdown } from "@/components/maps/filter-dropdown";

// 상태 필터 필 순서 — 초안/검토중/승인됨/반려/게시 / status filter pills order.
const STATUS_ORDER = ["draft", "pending", "approved", "rejected", "published", "confirmed"] as const;

export function HomeFilterPills({
  display,
  measureOnly,
  homeView,
  statusFilter,
  onToggleStatus,
  permFilter,
  onTogglePerm,
  owningFilter,
  onToggleOwning,
  spFilter,
  onToggleSp,
}: {
  display: FilterDisplayMode;
  // true: dataId 미부여(중복 셀렉터 방지) — 측정 복제용 / true when rendered as an offscreen measurement clone.
  measureOnly?: boolean;
  homeView: "departments" | "framework";
  statusFilter: Set<string>;
  onToggleStatus: (v: string) => void;
  permFilter: Set<string>;
  onTogglePerm: (v: string) => void;
  owningFilter: Set<string>;
  onToggleOwning: (v: string) => void;
  spFilter: Set<string>;
  onToggleSp: (v: string) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <FilterDropdown
        label={t("home.filterStatus")}
        dataId={measureOnly ? undefined : "home-status-filter"}
        icon={<CircleDot size={14} strokeWidth={1.5} />}
        display={display}
        options={STATUS_ORDER.map((s) => ({
          value: s,
          label: t(VERSION_STATUS_LABEL[s]),
          icon: (
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${VERSION_STATUS_STYLE[s]}`}
            />
          ),
        }))}
        selected={statusFilter}
        onToggle={onToggleStatus}
      />
      <FilterDropdown
        label={t("home.filterRole")}
        dataId={measureOnly ? undefined : "home-role-filter"}
        icon={<ShieldCheck size={14} strokeWidth={1.5} />}
        display={display}
        options={[
          { value: "owner", label: t("perm.roleOwner"), icon: <Crown size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
          { value: "editor", label: t("perm.roleEditor"), icon: <PencilLine size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
          { value: "viewer", label: t("perm.roleViewer"), icon: <Eye size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
        ]}
        selected={permFilter}
        onToggle={onTogglePerm}
      />
      {homeView === "departments" && (
        <>
          <FilterDropdown
            label={t("home.filterOwning")}
            dataId={measureOnly ? undefined : "home-owning-filter"}
            icon={<Building2 size={14} strokeWidth={1.5} />}
            display={display}
            options={[
              {
                value: "missing",
                label: t("home.owningMissingOption"),
                icon: <TriangleAlert size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />,
              },
            ]}
            selected={owningFilter}
            onToggle={onToggleOwning}
          />
          <FilterDropdown
            label={t("home.filterSp")}
            dataId={measureOnly ? undefined : "home-sp-filter"}
            icon={<Workflow size={14} strokeWidth={1.5} />}
            display={display}
            options={[
              {
                value: "sp",
                label: t("home.spOption"),
                icon: <Workflow size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />,
              },
              {
                value: "non_sp",
                label: t("home.spNonOption"),
                icon: <CircleSlash2 size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />,
              },
            ]}
            selected={spFilter}
            onToggle={onToggleSp}
          />
        </>
      )}
    </>
  );
}
