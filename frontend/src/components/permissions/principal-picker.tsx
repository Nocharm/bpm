"use client";

// 협업자 추가용 피커 — 사용자/부서/그룹을 초성 포함 검색 후 선택 /
// Principal picker: search users/departments/groups (with hangul chosung) and select one.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Building2, Search, User, Users, X } from "lucide-react";

import { filterByQuery, type MatchRange } from "@/lib/search";
import { Highlight } from "@/components/highlight";
import { computeDropdownPlacement, type DropdownPlacement } from "@/lib/dropdown-placement";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";
import { sortManagersFirst } from "@/lib/korean-dept";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import type { Department, PrincipalType, User as MockUser, UserGroup } from "@/lib/mock/permissions";

export interface PrincipalOption {
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
  department?: string;
  /** 한글명 — 유저는 korean_name, 부서는 dept_info 확정 한글 부서명. 표시 토글·검색 겸용 */
  koreanName?: string;
  /** 부서 항목 전용 — 부서장(검색 키워드, 표시 없음) */
  manager?: string;
  /** 부서 항목 전용 — 소속 유저들의 distinct 한글부서(검색 키워드) */
  koreanKeywords?: string[];
}

interface PrincipalPickerProps {
  users: MockUser[];
  departments: Department[];
  groups: UserGroup[];
  /** 이미 추가된 principal 목록 — 선택지에서 제외 / Already-granted principals to exclude. */
  excludeIds: Set<string>;
  /** userId → 소속명(검색용) / department name per user, for dept search. */
  userDepartments?: Record<string, string>;
  /** 부서 id(org_path) → distinct 한글부서 목록(검색 키워드) / dept id → korean dept keywords. */
  deptKoreanKeywords?: Map<string, string[]>;
  /** 브라우즈(빈 검색) 시 내 상위 부서장들을 맨 위로 — 승인자 피커용. 검색 랭킹은 불변. */
  managersFirst?: boolean;
  /** 빈 검색(브라우즈) 시 최상단 고정할 user principalId — 오우닝 부서 리더 노출용. 검색 랭킹은 불변. */
  pinnedIds?: Set<string>;
  onSelect: (option: PrincipalOption) => void;
}

// 피커가 제안하는 후보 목록 / Build candidate list from seed data.
function buildOptions(
  users: MockUser[],
  departments: Department[],
  groups: UserGroup[],
  userDepartments?: Record<string, string>,
  deptKoreanKeywords?: Map<string, string[]>,
): PrincipalOption[] {
  const userOpts: PrincipalOption[] = users
    .filter((u) => u.status === "active")
    .map((u) => ({
      principalType: "user",
      principalId: u.id,
      displayName: u.name,
      department: userDepartments?.[u.id],
      koreanName: u.korean_name ?? "",
    }));
  const deptOpts: PrincipalOption[] = departments.map((d) => ({
    principalType: "department",
    principalId: d.id,
    displayName: d.name,
    koreanName: d.korean_name ?? "",
    manager: d.manager ?? "",
    koreanKeywords: deptKoreanKeywords?.get(d.id) ?? [],
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
  deptKoreanKeywords,
  managersFirst,
  pinnedIds,
  onSelect,
}: PrincipalPickerProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // 열림 = 포커스 기준 — 바깥 클릭(blur) 시 검색어가 있어도 닫히고, 검색어는 유지돼
  // 재포커스 시 남은 검색어로 재검색 (batch2 ⑪). 목록 내부 클릭은 mousedown preventDefault로 blur 미발생.
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // 드롭다운은 body로 portal + fixed — 모달 본문의 overflow-y-auto에 잘리지 않고, 주변을 밀지도 않는다.
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  // 열려 있는 동안 앵커 좌표 추적 — 리사이즈·스크롤(내부 스크롤 컨테이너 포함, capture)에 재계산.
  useEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPlacement(
        computeDropdownPlacement(anchor.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    updatePlacement(); // DOM 측정은 커밋 후에만 가능 — placement=null 동안은 렌더 안 하므로 잘못된 위치로 깜빡이지 않는다
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  // 현재 접속자 — 상위 부서장 체인(Manager 라벨·우선 정렬)과 소속 부서(My Dept 라벨) 판정용
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const managerIds = me?.managerIds ?? [];
  const managerSet = new Set(managerIds);
  const isMyDept = (deptPath: string): boolean =>
    !!me?.orgPath && (me.orgPath === deptPath || me.orgPath.startsWith(`${deptPath}/`));

  const all = buildOptions(users, departments, groups, userDepartments, deptKoreanKeywords).filter(
    (o) => !excludeIds.has(o.principalId),
  );

  // 검색 한정: 유저=이름+아이디 / 부서·그룹=부서명·그룹명(displayName)만.
  // 유저를 소속 부서/그룹으로 매칭하지 않음 — "AI dev" 검색 시 그룹원들이 결과를 채워
  // 정작 'AI dev' 그룹이 유저 무더기에 묻히는 노이즈 방지. 한글그룹명은 부서 항목만 매칭.
  const hits = query.trim()
    ? filterByQuery(all, query, (o) =>
        o.principalType === "user"
          ? [
              { field: "name", text: o.displayName },
              ...(o.koreanName ? [{ field: "koreanName", text: o.koreanName }] : []),
              { field: "id", text: o.principalId },
            ]
          : [
              { field: "name", text: o.displayName },
              ...(o.koreanName ? [{ field: "koreanName", text: o.koreanName }] : []),
              ...(o.manager ? [{ field: "manager", text: o.manager }] : []),
              ...(o.koreanKeywords ?? []).map((k) => ({ field: "koreanDept", text: k })),
            ],
      )
    : (() => {
        const browse = managersFirst
          ? sortManagersFirst(
              all,
              (o) => (o.principalType === "user" ? o.principalId : null),
              managerIds,
            )
          : all;
        // 핀 고정 — 오우닝 부서 리더 등은 검색 없이도 맨 위 (안정 파티션)
        const pinnedFirst = pinnedIds?.size
          ? [
              ...browse.filter((o) => o.principalType === "user" && pinnedIds.has(o.principalId)),
              ...browse.filter((o) => !(o.principalType === "user" && pinnedIds.has(o.principalId))),
            ]
          : browse;
        return pinnedFirst.map((item) => ({
          item,
          matches: [] as { field: string; ranges: MatchRange[] }[],
        }));
      })();
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
    <div className="flex flex-col">
      {/* 검색 입력 — 드롭다운 배치의 앵커 / Search input; anchors the floating dropdown */}
      <div ref={anchorRef} className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1">
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
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setPlacement(null); // 다음 개방 때 옛 좌표로 한 프레임 그려지는 것 방지(effect는 페인트 후 실행)
          }}
          onKeyDown={onKeyDown}
        />
        {/* 전체 지우기 — 검색어만 비우고 포커스(목록) 유지. mousedown preventDefault로 blur 방지 (batch2 ⑪) */}
        {query.length > 0 && (
          <button
            type="button"
            data-id="picker-clear-query"
            aria-label={t("perm.pickerClear")}
            title={t("perm.pickerClear")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              setActive(0);
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {/* 결과 목록 — 열림(포커스) 동안만. 빈 입력이면 전체, 검색 중엔 랭킹순 /
          floating results, portaled so no scroll container can clip them. z=1250: 생성 모달(1200) 위, ConfirmDialog(1300) 아래 */}
      {open && placement && createPortal(
        <div
          data-id="principal-picker-dropdown"
          data-side={placement.side}
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
          className="fixed z-[1250] flex flex-col overflow-y-auto rounded-sm border border-hairline bg-surface shadow-lg"
        >
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
                {(() => {
                  const koreanRanges: MatchRange[] =
                    matches.find((m) => m.field === "koreanName")?.ranges ?? [];
                  // 유저·부서 동일 규칙 — 한글명 보유 시 lang에 따라 주/보조 전환 (그룹은 한글명 없음)
                  const hasKr = !!opt.koreanName;
                  const primaryKr = hasKr && lang === "ko";
                  return (
                    <span className="min-w-0 truncate">
                      {primaryKr ? (
                        <Highlight text={opt.koreanName ?? ""} ranges={koreanRanges} />
                      ) : (
                        <Highlight text={opt.displayName} ranges={nameRanges} />
                      )}
                      {/* 반대 언어 보조 — 한글 보유 유저만 */}
                      {hasKr && (
                        <span className="ml-1 text-fine text-ink-tertiary">
                          (
                          {primaryKr ? (
                            <Highlight text={opt.displayName} ranges={nameRanges} />
                          ) : (
                            <Highlight text={opt.koreanName ?? ""} ranges={koreanRanges} />
                          )}
                          )
                        </span>
                      )}
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
                  );
                })()}
                {(() => {
                  // 내 상위 부서장 → Manager, 내 소속 부서(체인) → My Dept — 약한 하이라이트 필
                  const isPinnedLead =
                    opt.principalType === "user" && (pinnedIds?.has(opt.principalId) ?? false);
                  const isManager =
                    opt.principalType === "user" && managerSet.has(opt.principalId);
                  const isMine =
                    opt.principalType === "department" && isMyDept(opt.principalId);
                  const label = isPinnedLead
                    ? t("perm.principalDeptLead")
                    : isManager
                      ? t("perm.principalManager")
                      : isMine
                        ? t("perm.principalMyDept")
                        : t(
                            opt.principalType === "user"
                              ? "perm.principalUser"
                              : opt.principalType === "department"
                                ? "perm.principalDept"
                                : "perm.principalGroup",
                          );
                  return (
                    <span
                      className={`ml-auto shrink-0 text-fine ${
                        isPinnedLead || isManager || isMine
                          ? "rounded-full bg-accent-tint px-2 py-0.5 text-accent"
                          : "text-ink-tertiary"
                      }`}
                    >
                      {label}
                    </span>
                  );
                })()}
              </button>
            );
          })}
          {hasMore && <div ref={sentinelRef} className="h-px shrink-0" />}
          {hits.length === 0 && (
            <span className="px-3 py-2 text-caption text-ink-tertiary">—</span>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
