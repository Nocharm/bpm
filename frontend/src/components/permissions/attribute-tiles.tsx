"use client";

// 부서·담당자 타일 쌍 — 두 열을 가로지르는 슬림 행 타일(라벨 좌·값 우) + 클릭 위치 피커 팝오버.
// SP 지정 모달·노드 편집 모달·Subprocess 탭이 공유한다 (사용자 결정 2026-09-03). 부서 값은 말단 부서만
// 필로 보여주고, 필을 누르면 조직 정보 모달(경로·구성인원·하위 조직 트리)이 열린다 — 타일의 나머지
// 영역 클릭이 피커. 부서 목록은 내 부서 체인을 맨 위에(새 맵 오우닝 부서 피커와 같은 규칙), 담당자는
// 조직 근접도순. 부서를 바꾸면 담당자는 초안에서 해제되고 안내가 뜬다(확인 모달 대신 — 팝오버 Esc가
// 곧 취소). 읽기 전용이면 값 있는 정적 타일만.

import { Building2, Users } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AssigneePills } from "@/components/assignee-pills";
import { DeptPill } from "@/components/dept-pill";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import type { PopoverActionLabels } from "@/components/popover-action-bar";
import { SearchSelect } from "@/components/search-select";
import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { addAssignee, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { buildAssigneeOptions, buildDepartmentOptions } from "@/lib/korean-dept";
import { sortDepartmentsByOrgProximity, sortUsersByOrgProximity } from "@/lib/org-proximity";

interface DeptAssigneeTilesProps {
  // 담당자 후보 스코프(맵 조회권한 보유 직원) — null이면 목록 없이 현재 값만
  versionId: number | null;
  department: string;
  assignee: string;
  readOnly?: boolean;
  // data-id 접두 — `${prefix}-department` / `${prefix}-assignee` / `${prefix}-popover-*`
  dataIdPrefix: string;
  labels: PopoverActionLabels;
  // 읽기 전용에서 빈 값도 타일로 남길 때의 안내 문구("미입력") — 없으면 빈 타일은 숨긴다
  placeholder?: string;
  onChange: (patch: { department: string; assignee: string }) => void;
}

type Field = "department" | "assignee";

interface ActivePicker {
  field: Field;
  at: { x: number; y: number };
  // 팝오버 로컬 초안 — 확정 시에만 부모에 반영, Esc면 폐기
  department: string;
  assignee: string;
}

export function DeptAssigneeTiles({
  versionId, department, assignee, readOnly = false, dataIdPrefix, labels, placeholder, onChange,
}: DeptAssigneeTilesProps) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<EligibleAssignees>({ users: [], departments: [] });
  const loadedFor = useRef<number | null>(null);
  const [active, setActive] = useState<ActivePicker | null>(null);

  useEffect(() => {
    if (readOnly || versionId == null || loadedFor.current === versionId) return;
    let alive = true;
    void getEligibleAssignees(versionId)
      .then((eligible) => {
        if (alive) {
          setData(eligible);
          loadedFor.current = versionId;
        }
      })
      .catch(() => {
        if (alive) setData({ users: [], departments: [] });
      });
    return () => {
      alive = false;
    };
  }, [versionId, readOnly]);

  // 내 조직 기준 정렬 — eligible 응답엔 org_path가 없어 디렉터리 스토어로 보강
  const dir = useDirectory();
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const myPath = me?.orgPath ?? "";
  const usersWithPath = data.users.map((u) => ({ ...u, org_path: dir.get(u.id)?.org_path ?? "" }));
  const proximityUsers = sortUsersByOrgProximity(usersWithPath, myPath);
  const pathByDept = new Map<string, string>();
  for (const u of usersWithPath) {
    if (u.org_path && !pathByDept.has(u.department)) pathByDept.set(u.department, u.org_path);
  }
  // 내 부서(체인 맨 위)는 행 우측 "내 부서" 태그로 표시 (사용자 요청 2026-09-03)
  const myDept = deptLeaf(myPath);
  const deptOptions = buildDepartmentOptions(
    sortDepartmentsByOrgProximity(data.departments, pathByDept, myPath),
    data.users,
    lang,
    data.dept_infos,
  ).map((option) =>
    myDept !== "" && option.value === myDept ? { ...option, tag: t("perm.principalMyDept") } : option,
  );
  const assigneeText = formatAssignees(parseAssignees(assignee));
  const openPicker = (field: Field, at: { x: number; y: number }) =>
    setActive({ field, at, department, assignee });
  const dirty = active !== null && (active.department !== department || active.assignee !== assignee);
  const apply = () => {
    if (active) onChange({ department: active.department, assignee: active.assignee });
  };
  const commit = () => {
    apply();
    setActive(null);
  };
  const tiles = (
    <>
      {(!readOnly || department !== "" || placeholder) && (
        <SpFieldTile
          dataId={`${dataIdPrefix}-department`}
          icon={Building2}
          label={t("field.department")}
          value=""
          placeholder={placeholder}
          valueNode={
            department !== "" ? <DeptPill department={department} dataId={`${dataIdPrefix}-department-pill`} /> : undefined
          }
          wide
          readOnly={readOnly}
          active={active?.field === "department"}
          onOpen={(at) => openPicker("department", at)}
        />
      )}
      {(!readOnly || assigneeText !== "" || placeholder) && (
        <SpFieldTile
          dataId={`${dataIdPrefix}-assignee`}
          icon={Users}
          label={t("field.assignee")}
          value=""
          // 담당자는 인물 필 — 호버/클릭으로 인물 카드(부서 트리 포함) (사용자 요청 2026-09-03)
          valueNode={assigneeText !== "" ? <AssigneePills assignee={assignee} dataIdPrefix={dataIdPrefix} /> : undefined}
          placeholder={placeholder}
          wide
          readOnly={readOnly}
          active={active?.field === "assignee"}
          onOpen={(at) => openPicker("assignee", at)}
        />
      )}
    </>
  );
  if (readOnly || active === null) return tiles;

  const draftAssignees = parseAssignees(active.assignee);
  const drifted = driftedAssignees(active.department, draftAssignees, data.users);
  // 부서 변경으로 담당자가 해제된 초안 — 저장 전 안내
  const clearedAssignees = active.department !== department && assignee !== "" && active.assignee === "";

  return (
    <>
      {tiles}
      <SpFieldPopover
        dataId={`${dataIdPrefix}-popover-${active.field}`}
        anchor={active.at}
        title={active.field === "department" ? t("field.department") : t("field.assignee")}
        hint={active.field === "department" ? t("sp.tile.hint.department") : t("sp.tile.hint.assignee")}
        width={360}
        dirty={dirty}
        // 피커 안 Enter는 항목 선택 — 전역 Enter 확정을 끈다
        enterCommits={false}
        onApply={apply}
        onCommit={commit}
        onCancel={() => setActive(null)}
        labels={labels}
      >
        {active.field === "department" ? (
          <div className="flex flex-col gap-1.5">
            <SearchSelect
              value={active.department}
              options={deptOptions}
              emptyLabel={t("summary.none")}
              placeholder={t("field.searchPlaceholder")}
              onChange={(next) => {
                if (next === active.department) return; // SearchSelect는 같은 값도 발화 — 담당자 무단 해제 방지
                setActive((prev) =>
                  prev ? { ...prev, department: next, assignee: next === department ? assignee : "" } : prev,
                );
              }}
            />
            {clearedAssignees && (
              <p data-id={`${dataIdPrefix}-dept-clears`} className="text-fine text-error">
                {t("sp.tile.deptChangeClears")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {draftAssignees.length > 0 && (
              <AssigneePills
                assignee={active.assignee}
                dataIdPrefix={`${dataIdPrefix}-draft`}
                drifted={drifted}
                align="start"
                onRemove={(name) =>
                  setActive((prev) =>
                    prev ? { ...prev, assignee: formatAssignees(draftAssignees.filter((n) => n !== name)) } : prev,
                  )
                }
              />
            )}
            <SearchSelect
              addMode
              value=""
              options={buildAssigneeOptions(
                proximityUsers
                  .filter((u) => active.department === "" || u.department === active.department)
                  .filter((u) => !draftAssignees.includes(u.name)),
                lang,
              )}
              emptyLabel={t("summary.none")}
              placeholder={t("field.searchPlaceholder")}
              onChange={(name) => {
                if (!name) return;
                const next = addAssignee(active.department, draftAssignees, name, data.users);
                setActive((prev) =>
                  prev ? { ...prev, department: next.department, assignee: formatAssignees(next.assignees) } : prev,
                );
              }}
            />
          </div>
        )}
      </SpFieldPopover>
    </>
  );
}
