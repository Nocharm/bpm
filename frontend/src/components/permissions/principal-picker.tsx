"use client";

// 협업자 추가용 피커 — 사용자/부서/그룹을 초성 포함 검색 후 선택 /
// Principal picker: search users/departments/groups (with hangul chosung) and select one.

import { useState } from "react";
import { Building2, Search, User, Users } from "lucide-react";

import { filterByQuery, type MatchRange } from "@/lib/search";
import { Highlight } from "@/components/highlight";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import type { Department, PrincipalType, User as MockUser, UserGroup } from "@/lib/mock/permissions";

export interface PrincipalOption {
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
  department?: string;
}

interface PrincipalPickerProps {
  users: MockUser[];
  departments: Department[];
  groups: UserGroup[];
  /** 이미 추가된 principal 목록 — 선택지에서 제외 / Already-granted principals to exclude. */
  excludeIds: Set<string>;
  /** userId → 소속명(검색용) / department name per user, for dept search. */
  userDepartments?: Record<string, string>;
  onSelect: (option: PrincipalOption) => void;
}

// 피커가 제안하는 후보 목록 / Build candidate list from seed data.
function buildOptions(
  users: MockUser[],
  departments: Department[],
  groups: UserGroup[],
  userDepartments?: Record<string, string>,
): PrincipalOption[] {
  const userOpts: PrincipalOption[] = users
    .filter((u) => u.status === "active")
    .map((u) => ({
      principalType: "user",
      principalId: u.id,
      displayName: u.name,
      department: userDepartments?.[u.id],
    }));
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
  userDepartments,
  onSelect,
}: PrincipalPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  const all = buildOptions(users, departments, groups, userDepartments).filter(
    (o) => !excludeIds.has(o.principalId),
  );

  // 검색 한정: 유저=이름+아이디 / 부서·그룹=부서명·그룹명(displayName)만.
  // 유저를 소속 부서/그룹으로 매칭하지 않음 — "AI dev" 검색 시 그룹원들이 결과를 채워
  // 정작 'AI dev' 그룹이 유저 무더기에 묻히는 노이즈 방지.
  const hits = query.trim()
    ? filterByQuery(all, query, (o) =>
        o.principalType === "user"
          ? [
              { field: "name", text: o.displayName },
              { field: "id", text: o.principalId },
            ]
          : [{ field: "name", text: o.displayName }],
      )
    : all.map((item) => ({ item, matches: [] as { field: string; ranges: MatchRange[] }[] }));
  // 검색도 캡 없이 전량 노출 — 25개씩 증분 렌더가 DOM 부하를 막는다(~5000명).
  // 부서·그룹 매치는 이름이 비슷한 유저 무더기에 밀리지 않게, 최고 랭크 1개를 스코어 무시하고 맨 위로 고정.
  let ordered = hits;
  if (query.trim()) {
    const groupIdx = hits.findIndex((h) => h.item.principalType !== "user");
    if (groupIdx > 0) {
      ordered = [hits[groupIdx], ...hits.slice(0, groupIdx), ...hits.slice(groupIdx + 1)];
    }
  }
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(ordered, query);

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Esc — 검색어 비우고 포커스 해제(blur) → 펼쳐진 목록 닫힘 (항목 유무와 무관)
    if (event.key === "Escape") {
      setQuery("");
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (visible.length === 0) return;
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const opt = visible[active]?.item;
      if (opt) {
        onSelect(opt);
        setQuery("");
      }
    }
  };

  return (
    // relative — 결과 목록을 absolute로 띄워(플로팅) 주변 레이아웃을 밀지 않음 (#9 / SR-4)
    <div className="relative flex flex-col">
      {/* 검색 입력 / Search input */}
      <div className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1">
        <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <input
          type="text"
          className="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
          placeholder={t("perm.addPickerPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {/* 결과 목록 — 빈 입력(포커스)이면 전체, 검색 중엔 상위 8개 / floating results */}
      {(focused || query.trim()) && (
        <div className="absolute left-0 right-0 top-full z-[1001] mt-1 flex max-h-40 flex-col overflow-y-auto rounded-sm border border-hairline bg-surface shadow-lg">
          {visible.map(({ item: opt, matches }, idx) => {
            const nameRanges: MatchRange[] = matches.find((m) => m.field === "name")?.ranges ?? [];
            const idRanges: MatchRange[] = matches.find((m) => m.field === "id")?.ranges ?? [];
            return (
              <button
                key={`${opt.principalType}:${opt.principalId}`}
                type="button"
                className={`flex items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt ${
                  active === idx ? "bg-surface-alt" : ""
                }`}
                onMouseEnter={() => setActive(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(opt);
                  setQuery("");
                }}
              >
                <PrincipalIcon type={opt.principalType} />
                <span className="min-w-0 truncate">
                  <Highlight text={opt.displayName} ranges={nameRanges} />
                  {/* 사용자: 아이디 · 부서 노출 (SR-2) */}
                  {opt.principalType === "user" && (
                    <span className="ml-1.5 text-fine text-ink-tertiary">
                      <Highlight text={opt.principalId} ranges={idRanges} />
                      {opt.department ? ` · ${opt.department}` : ""}
                    </span>
                  )}
                  {opt.principalType !== "user" && opt.department && (
                    <span className="ml-1.5 text-fine text-ink-tertiary">{opt.department}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                  {t(
                    opt.principalType === "user"
                      ? "perm.principalUser"
                      : opt.principalType === "department"
                        ? "perm.principalDept"
                        : "perm.principalGroup",
                  )}
                </span>
              </button>
            );
          })}
          {hasMore && <div ref={sentinelRef} className="h-px shrink-0" />}
          {hits.length === 0 && (
            <span className="px-3 py-2 text-caption text-ink-tertiary">—</span>
          )}
        </div>
      )}
    </div>
  );
}
