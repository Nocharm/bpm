"use client";

// 노드 BPM 속성 담당자·부서 피커 — 복수 담당자 칩+SearchSelect, 부서 변경 시 담당자 초기화 확인.
// 비동기 fetch는 active 가드(set-state-in-effect 회피). 저장 배선은 onChange로 위임.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SearchSelect } from "@/components/search-select";
import { addAssignee, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";
import { useI18n } from "@/lib/i18n";

interface BpmAttributePickerProps {
  versionId: number | null;
  assignee: string;
  department: string;
  readOnly: boolean;
  onChange: (patch: { assignee?: string; department?: string }) => void;
}

const ROW = "flex items-center justify-between gap-2 border-t border-divider py-1";

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

  // 부서 변경 — 담당자 있으면 확인 후 초기화, 없으면 즉시 적용
  const handleDeptChange = (newDept: string) => {
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
        <span className="shrink-0 text-caption text-ink-secondary">{t("field.department")}</span>
        {readOnly ? (
          <span className="min-w-0 flex-1 truncate text-right text-caption text-ink">
            {department || "—"}
          </span>
        ) : (
          <SearchSelect
            value={department}
            options={data.departments.map((d) => ({ value: d, label: d }))}
            emptyLabel="—"
            placeholder={t("field.searchPlaceholder")}
            onChange={handleDeptChange}
          />
        )}
      </div>

      {/* 담당자 칩 + 부서 필터링 추가 픽커 */}
      <div className="flex items-start gap-2 border-t border-divider py-1">
        <span className="mt-1 shrink-0 text-caption text-ink-secondary">{t("field.assignee")}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {assignees.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {assignees.map((name) => {
                const isDrift = drifted.includes(name);
                return (
                  <span
                    key={name}
                    className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                      isDrift
                        ? "border-error/40 bg-error/10 text-error"
                        : "border-hairline bg-surface-alt text-ink"
                    }`}
                  >
                    {name}
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={t("summary.close")}
                        onClick={() =>
                          onChange({
                            assignee: formatAssignees(assignees.filter((n) => n !== name)),
                          })
                        }
                      >
                        <X size={11} strokeWidth={1.5} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {!readOnly && (
            <SearchSelect
              value=""
              options={data.users
                .filter((u) => department === "" || u.department === department)
                .filter((u) => !assignees.includes(u.name))
                .map((u) => ({
                  value: u.name,
                  label: u.name,
                  sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined,
                  keywords: u.id,
                }))}
              emptyLabel={t("field.assignee")}
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
