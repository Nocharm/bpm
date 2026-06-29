"use client";

// 노드 BPM 속성 담당자·부서 피커 — 자유입력 폐기(F5), 자격 직원/부서(getEligibleAssignees)에서 선택.
// 담당자 선택 시 그 직원의 부서를 자동 채움. 현재 값이 목록에 없으면 옵션으로 보존(레거시 자유입력 데이터).
// 비동기 fetch는 active 가드(set-state-in-effect 회피). 저장 배선은 onChange로 위임.
import { useEffect, useRef, useState } from "react";

import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/lib/i18n";

interface BpmAttributePickerProps {
  versionId: number | null;
  assignee: string;
  department: string;
  readOnly: boolean;
  onChange: (patch: { assignee?: string; department?: string }) => void;
}

const ROW =
  "flex items-center justify-between gap-2 border-t border-divider py-1";
const SELECT =
  "min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none disabled:hover:bg-transparent";

export function BpmAttributePicker({
  versionId,
  assignee,
  department,
  readOnly,
  onChange,
}: BpmAttributePickerProps) {
  const { t } = useI18n();
  const [data, setData] = useState<EligibleAssignees>({ users: [], departments: [] });
  const loadedFor = useRef<number | null>(null);

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

  // 부서가 먼저 선택되면 담당자 목록을 그 부서로 필터, 담당자가 있으면 부서는 잠금(담당자에서 파생)
  const assigneeSet = assignee.trim() !== "";
  const filteredUsers = department
    ? data.users.filter((user) => user.department === department)
    : data.users;
  const filteredNames = filteredUsers.map((user) => user.name);
  // 선택된 담당자의 정보 카드(호버 툴팁) — 이름/아이디/부서
  const assigneeUser = data.users.find((user) => user.name === assignee);

  return (
    <>
      <div className={ROW}>
        <span className="shrink-0 text-caption text-ink-secondary">{t("field.assignee")}</span>
        <Tooltip
          className="min-w-0 flex-1"
          content={
            assigneeUser ? (
              <span className="flex flex-col gap-0.5 text-left">
                <span className="text-caption font-semibold text-ink">{assigneeUser.name}</span>
                <span className="text-fine text-ink-tertiary">{assigneeUser.id}</span>
                <span className="text-fine text-ink-tertiary">{assigneeUser.department}</span>
              </span>
            ) : undefined
          }
        >
          <select
            className={`${SELECT} truncate`}
            value={assignee}
            disabled={readOnly}
            onChange={(event) => {
              const name = event.target.value;
              const user = data.users.find((candidate) => candidate.name === name);
              onChange(user ? { assignee: name, department: user.department } : { assignee: name });
            }}
          >
            <option value="">—</option>
            {assignee && !filteredNames.includes(assignee) && <option value={assignee}>{assignee}</option>}
            {filteredUsers.map((user) => (
              <option key={user.id} value={user.name}>
                {user.name} · {user.department}
              </option>
            ))}
          </select>
        </Tooltip>
      </div>
      <div className={ROW}>
        <span className="shrink-0 text-caption text-ink-secondary">{t("field.department")}</span>
        <select
          className={`${SELECT} truncate`}
          value={department}
          disabled={readOnly || assigneeSet}
          title={assigneeSet ? t("inspector.deptLocked") : department || undefined}
          onChange={(event) => onChange({ department: event.target.value })}
        >
          <option value="">—</option>
          {department && !data.departments.includes(department) && (
            <option value={department}>{department}</option>
          )}
          {data.departments.map((dept) => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
