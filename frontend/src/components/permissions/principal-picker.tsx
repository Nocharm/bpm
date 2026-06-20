"use client";

// 협업자 추가용 피커 — 사용자/부서/그룹을 초성 포함 검색 후 선택 /
// Principal picker: search users/departments/groups (with hangul chosung) and select one.

import { useState } from "react";
import { Building2, Search, User, Users } from "lucide-react";

import { matchesQuery } from "@/lib/hangul";
import { useI18n } from "@/lib/i18n";
import type { Department, PrincipalType, User as MockUser, UserGroup } from "@/lib/mock/permissions";

export interface PrincipalOption {
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
}

interface PrincipalPickerProps {
  users: MockUser[];
  departments: Department[];
  groups: UserGroup[];
  /** 이미 추가된 principal 목록 — 선택지에서 제외 / Already-granted principals to exclude. */
  excludeIds: Set<string>;
  onSelect: (option: PrincipalOption) => void;
}

// 피커가 제안하는 후보 목록 / Build candidate list from seed data.
function buildOptions(
  users: MockUser[],
  departments: Department[],
  groups: UserGroup[],
): PrincipalOption[] {
  const userOpts: PrincipalOption[] = users
    .filter((u) => u.status === "active")
    .map((u) => ({ principalType: "user", principalId: u.id, displayName: u.name }));
  const deptOpts: PrincipalOption[] = departments.map((d) => ({
    principalType: "department",
    principalId: d.id,
    displayName: d.name,
  }));
  const groupOpts: PrincipalOption[] = groups
    .filter((g) => g.status === "active")
    .map((g) => ({ principalType: "group", principalId: g.id, displayName: g.name }));
  return [...userOpts, ...deptOpts, ...groupOpts];
}

export function PrincipalIcon({ type }: { type: PrincipalType }) {
  if (type === "user") return <User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
  if (type === "department") return <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
  return <Users size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
}

export function PrincipalPicker({
  users,
  departments,
  groups,
  excludeIds,
  onSelect,
}: PrincipalPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const all = buildOptions(users, departments, groups).filter(
    (o) => !excludeIds.has(o.principalId),
  );

  const results = query.trim()
    ? all.filter((o) => matchesQuery(o.displayName, query))
    : all;

  return (
    <div className="flex flex-col gap-1">
      {/* 검색 입력 / Search input */}
      <div className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1">
        <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <input
          type="text"
          className="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
          placeholder={t("perm.addPickerPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {/* 결과 목록 (최대 8개) / Results list (max 8) */}
      {query.trim() && (
        <div className="flex max-h-40 flex-col overflow-y-auto rounded-sm border border-hairline bg-surface shadow-md">
          {results.slice(0, 8).map((opt) => (
            <button
              key={`${opt.principalType}:${opt.principalId}`}
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
              onClick={() => {
                onSelect(opt);
                setQuery("");
              }}
            >
              <PrincipalIcon type={opt.principalType} />
              <span>{opt.displayName}</span>
              <span className="ml-auto text-fine text-ink-tertiary">
                {t(
                  opt.principalType === "user"
                    ? "perm.principalUser"
                    : opt.principalType === "department"
                      ? "perm.principalDept"
                      : "perm.principalGroup",
                )}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <span className="px-3 py-2 text-caption text-ink-tertiary">—</span>
          )}
        </div>
      )}
    </div>
  );
}
