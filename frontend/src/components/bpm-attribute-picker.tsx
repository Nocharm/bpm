"use client";

// 노드 BPM 속성 담당자·부서 피커 — 복수 담당자 칩+SearchSelect, 부서 변경 시 담당자 초기화 확인.
// 비동기 fetch는 active 가드(set-state-in-effect 회피). 저장 배선은 onChange로 위임.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Building2, Users } from "lucide-react";

import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { AssigneePills } from "@/components/assignee-pills";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeptPill } from "@/components/dept-pill";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { SearchSelect } from "@/components/search-select";
import { addAssignee, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { INSPECTOR_ROW, INSPECTOR_ROW_LABEL } from "@/lib/inspector-row";
import { buildAssigneeOptions, buildDepartmentOptions } from "@/lib/korean-dept";
import { sortDepartmentsByOrgProximity, sortUsersByOrgProximity } from "@/lib/org-proximity";

interface BpmAttributePickerProps {
  versionId: number | null;
  assignee: string;
  department: string;
  readOnly: boolean;
  onChange: (patch: { assignee?: string; department?: string }) => void;
}

// 행간 구분선 없음 — 어트리뷰트 섹션은 URL 위에만 스페이서 (사용자 결정 2026-08-20). 행 높이·라벨 문법은
// 인스펙터 공통(lib/inspector-row) — 수행 지표·입출력 카드·SP 상속 행과 같다 (사용자 요청 2026-09-03)
const ROW = INSPECTOR_ROW;
const LABEL = INSPECTOR_ROW_LABEL;

export function BpmAttributePicker({
  versionId,
  assignee,
  department,
  readOnly,
  onChange,
}: BpmAttributePickerProps) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<EligibleAssignees>({ users: [], departments: [] });
  const loadedFor = useRef<number | null>(null);
  // 부서 변경 확인 — 담당자 있을 때 부서 변경 전 확인 대기
  const [pendingDept, setPendingDept] = useState<string | null>(null);

  useEffect(() => {
    if (versionId == null || loadedFor.current === versionId) return;
    let active = true;
    void getEligibleAssignees(versionId)
      .then((eligible) => {
        if (active) {
          setData(eligible);
          loadedFor.current = versionId;
        }
      })
      .catch(() => {
        if (active) setData({ users: [], departments: [] });
      });
    return () => {
      active = false;
    };
  }, [versionId]);

  const assignees = parseAssignees(assignee);
  const drifted = driftedAssignees(department, assignees, data.users);

  // 담당자 기본 노출 — 내 조직 근접도 우선(3다리 내, org 빈 사람 최후순위). eligible 응답엔
  // org_path가 없어 디렉터리 스토어로 보강. 검색 랭킹(SearchSelect filterByQuery)은 그대로.
  const dir = useDirectory();
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const myPath = me?.orgPath ?? "";
  const usersWithPath = data.users.map((u) => ({ ...u, org_path: dir.get(u.id)?.org_path ?? "" }));
  const proximityUsers = sortUsersByOrgProximity(usersWithPath, myPath);
  // 부서 목록도 내 부서 체인 우선 + 내 부서 태그 — 노드 편집 모달의 부서 타일 피커와 같은 규칙
  const pathByDept = new Map<string, string>();
  for (const u of usersWithPath) {
    if (u.org_path && !pathByDept.has(u.department)) pathByDept.set(u.department, u.org_path);
  }
  const myDept = deptLeaf(myPath);
  const deptOptions = buildDepartmentOptions(
    sortDepartmentsByOrgProximity(data.departments, pathByDept, myPath),
    data.users,
    lang,
    data.dept_infos,
  ).map((option) =>
    myDept !== "" && option.value === myDept ? { ...option, tag: t("perm.principalMyDept") } : option,
  );

  // 부서 변경 — 담당자 있으면 확인 후 초기화, 없으면 즉시 적용
  const handleDeptChange = (newDept: string) => {
    if (newDept === department) return; // 같은 부서 재선택 — SearchSelect onChange 무조건 발화 → 불필요한 확인 모달 방지
    if (assignees.length > 0) {
      setPendingDept(newDept);
    } else {
      onChange({ department: newDept });
    }
  };

  return (
    <>
      {/* 부서 단일 픽커 — 변경 시 담당자 있으면 확인 */}
      <div className={ROW}>
        <span className={LABEL}>
          <Building2 size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.department")}
        </span>
        {readOnly ? (
          // 읽기 전용 — 말단 부서 필(클릭=조직 정보 모달), 편집 모달 타일·SP 상속 행과 같은 표기
          department ? (
            <DeptPill department={department} dataId="inspector-department-pill" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-right text-caption text-ink">{t("summary.none")}</span>
          )
        ) : (
          // 우측 정렬 — 내용폭(fitContent)이라 라벨 옆에 붙지 않고 우측에, 좁으면 줄어듦(삐져나감 방지).
          <SearchSelect
            fitContent
            value={department}
            options={deptOptions}
            emptyLabel={t("summary.none")}
            placeholder={t("field.searchPlaceholder")}
            onChange={handleDeptChange}
          />
        )}
      </div>

      {/* 담당자 — 필 우측 정렬 + 맨끝 ＋버튼(플라이아웃 피커). 읽기전용은 칩만. */}
      <div className="flex min-h-8 items-start gap-2 py-1">
        <span className={`${LABEL} mt-1`}>
          <Users size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.assignee")}
        </span>
        <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            {assignees.length === 0 && readOnly ? (
              <span className="text-caption text-ink">{t("summary.none")}</span>
            ) : (
              // 인물 필 — 호버/클릭으로 인물 카드(부서 트리 포함), 편집 모달 담당자 타일과 같은 문법 (2026-09-03)
              <AssigneePills
                assignee={assignee}
                dataIdPrefix="inspector"
                drifted={drifted}
                onRemove={
                  readOnly
                    ? undefined
                    : (name) => onChange({ assignee: formatAssignees(assignees.filter((n) => n !== name)) })
                }
              />
            )}
          </div>
          {!readOnly && (
            <SearchSelect
              addMode
              value=""
              options={buildAssigneeOptions(
                proximityUsers
                  .filter((u) => department === "" || u.department === department)
                  .filter((u) => !assignees.includes(u.name)),
                lang,
              )}
              emptyLabel={t("summary.none")}
              placeholder={t("field.searchPlaceholder")}
              onChange={(name) => {
                if (!name) return;
                const next = addAssignee(department, assignees, name, data.users);
                onChange({ department: next.department, assignee: formatAssignees(next.assignees) });
              }}
            />
          )}
        </div>
      </div>

      {/* 부서 변경 확인 모달 */}
      {pendingDept !== null && (
        <ConfirmDialog
          title={t("assignee.deptChangeTitle")}
          message={t("assignee.deptChangeBody")}
          confirmLabel={t("editor.save")}
          cancelLabel={t("summary.cancel")}
          onConfirm={() => {
            onChange({ department: pendingDept, assignee: "" });
            setPendingDept(null);
          }}
          onClose={() => setPendingDept(null)}
        />
      )}
    </>
  );
}
