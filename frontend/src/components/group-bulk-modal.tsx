"use client";

// 그룹 멤버 일괄 편집 — 그룹명, 색상 일괄, 속성 일괄(설정/비우기 + 충돌 처리: 교체/추가/건너뛰기/개별 선택), 중단 (#5 2026-06-15)
import { MousePointerClick, Plus, Replace, SkipForward, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { addAssignee, formatAssignees, parseAssignees } from "@/lib/assignee";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

// "people" = combined assignee+department mode; "system"/"duration" = single-field modes
export type BulkAttrField = "system" | "duration";
export type BulkMode = "people" | BulkAttrField;
export type BulkAction = "set" | "clear";
// 충돌 처리: 교체/추가(콤마)/건너뛰기/개별 선택. null=미선택(필수)
export type BulkPolicy = "replace" | "append" | "skip" | "individual";
// Combined people update written by onApplyPeople
export type PeopleUpdate = { id: string; department: string; assignee: string };

const ATTR_MODES: BulkMode[] = ["people", "system", "duration"];
const MODE_LABEL_KEY: Record<BulkMode, MessageKey> = {
  people: "field.people",
  system: "field.system",
  duration: "field.duration",
};

// 충돌 처리 옵션 — 아이콘 + 2×2 그리드로 한눈에
const POLICY_META: { key: BulkPolicy; icon: LucideIcon }[] = [
  { key: "replace", icon: Replace }, // 교체 — 기존↔새 값 교체
  { key: "append", icon: Plus }, // 추가 — 기존에 새 값 덧붙임
  { key: "skip", icon: SkipForward }, // 건너뛰기 — 충돌 멤버 그대로 둠
  { key: "individual", icon: MousePointerClick }, // 개별 — 하나씩 선택
];

export interface BulkMember {
  id: string;
  label: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
}

type Update = { id: string; value: string };

interface GroupBulkModalProps {
  versionId: number | null;
  groupLabel: string;
  members: BulkMember[];
  colorPresets: string[];
  onRenameGroup: (label: string) => void;
  onApplyColor: (color: string) => void;
  onApplyAttribute: (field: BulkAttrField, updates: Update[]) => void;
  onApplyPeople: (updates: PeopleUpdate[]) => void;
  onClose: () => void;
}

export function GroupBulkModal({
  versionId,
  groupLabel,
  members,
  colorPresets,
  onRenameGroup,
  onApplyColor,
  onApplyAttribute,
  onApplyPeople,
  onClose,
}: GroupBulkModalProps) {
  const { t } = useI18n();

  // Shared UI state
  const [mode, setMode] = useState<BulkMode>("people");
  const [policy, setPolicy] = useState<BulkPolicy | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

  // People mode: target department + assignees
  const [peopleDept, setPeopleDept] = useState("");
  const [peopleAssignees, setPeopleAssignees] = useState<string[]>([]);
  // People wizard — explicit targets list so cross-dept-only subsets work
  const [peopleWizard, setPeopleWizard] = useState<{
    targets: BulkMember[];
    step: number;
    resolved: PeopleUpdate[];
  } | null>(null);

  // System/duration mode: action + value + wizard
  const [action, setAction] = useState<BulkAction>("set");
  const [value, setValue] = useState("");
  const [wizard, setWizard] = useState<{ step: number; resolved: Update[] } | null>(null);

  // 담당자/부서 후보 — 노드 편집과 동일 피커(조회권한 보유 직원만, F5)
  const [eligible, setEligible] = useState<EligibleAssignees | null>(null);
  useEffect(() => {
    if (versionId == null) return;
    let active = true;
    void getEligibleAssignees(versionId)
      .then((e) => {
        if (active) setEligible(e);
      })
      .catch(() => {
        /* 실패 시 값 직접입력만 */
      });
    return () => {
      active = false;
    };
  }, [versionId]);

  // Esc로 중단
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const users = eligible?.users ?? [];
  const userPersons = users.map((u) => ({ name: u.name, department: u.department }));
  const targetAssigneeStr = formatAssignees(peopleAssignees);
  const hasAssignees = peopleAssignees.length > 0;

  // Dept-filtered user options for assignee picker (excludes already-added members)
  const assigneePickOptions = users
    .filter((u) => (!peopleDept || u.department === peopleDept) && !peopleAssignees.includes(u.name))
    .map((u) => ({ value: u.name, label: u.name, sub: u.id || undefined, keywords: u.id }));

  // ---- Conflict detection ----

  // People mode conflict: member has existing dept or assignee that differs from target
  const isPeopleConflict = (m: BulkMember) => {
    const hasExisting = m.department !== "" || m.assignee !== "";
    if (!hasExisting) return false;
    const deptMatches = m.department === peopleDept;
    // Department-only mode: only department must match
    const assigneeMatches = hasAssignees ? m.assignee === targetAssigneeStr : true;
    return !(deptMatches && assigneeMatches);
  };

  const peopleConflicts = members.filter(isPeopleConflict);

  // System/duration conflict
  const attrField = mode !== "people" ? (mode as BulkAttrField) : null;
  const attrConflicts = attrField
    ? members.filter((m) => m[attrField].trim() !== "" && m[attrField].trim() !== value.trim())
    : [];

  const hasConflict =
    mode === "people"
      ? action === "set" && peopleConflicts.length > 0
      : action === "set" && attrConflicts.length > 0;

  // Available policies — people+dept-only omits append (department is single-valued)
  const availablePolicies: Set<BulkPolicy> = new Set(
    mode === "people" && !hasAssignees
      ? ["replace", "individual", "skip"]
      : ["replace", "append", "skip", "individual"],
  );
  const visiblePolicies = POLICY_META.filter((p) => availablePolicies.has(p.key));

  // Effective policy: if current selection is no longer in available set, treat as null
  const effectivePolicy = policy !== null && availablePolicies.has(policy) ? policy : null;

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  // ---- People mode apply ----

  const finishPeople = (updates: PeopleUpdate[]) => {
    onApplyPeople(updates);
    setPeopleWizard(null);
    setPeopleDept("");
    setPeopleAssignees([]);
    setPolicy(null);
  };

  const applyPeople = () => {
    if (action === "clear") {
      finishPeople(members.map((m) => ({ id: m.id, department: "", assignee: "" })));
      return;
    }
    if (!hasConflict) {
      finishPeople(
        members.map((m) => ({ id: m.id, department: peopleDept, assignee: targetAssigneeStr })),
      );
      return;
    }
    if (effectivePolicy === null) return;

    if (effectivePolicy === "replace") {
      finishPeople(
        members.map((m) => ({ id: m.id, department: peopleDept, assignee: targetAssigneeStr })),
      );
      return;
    }

    if (effectivePolicy === "skip") {
      const updates = members
        .filter((m) => !isPeopleConflict(m))
        .map((m) => ({ id: m.id, department: peopleDept, assignee: targetAssigneeStr }));
      finishPeople(updates);
      return;
    }

    if (effectivePolicy === "individual") {
      const base = members
        .filter((m) => !isPeopleConflict(m))
        .map((m) => ({ id: m.id, department: peopleDept, assignee: targetAssigneeStr }));
      setPeopleWizard({ targets: peopleConflicts, step: 0, resolved: base });
      return;
    }

    if (effectivePolicy === "append") {
      // Same-dept: append and auto-resolve. Cross-dept: route to individual wizard.
      const autoResolved: PeopleUpdate[] = [];
      const crossDeptMembers: BulkMember[] = [];

      for (const m of members) {
        if (!isPeopleConflict(m)) {
          // No conflict: append to member's current assignees (or set if empty dept)
          const existing = parseAssignees(m.assignee);
          const merged = [
            ...existing,
            ...peopleAssignees.filter((n) => !existing.includes(n)),
          ];
          autoResolved.push({
            id: m.id,
            department: peopleDept || m.department,
            assignee: formatAssignees(merged),
          });
          continue;
        }
        const sameDept = m.department === peopleDept || m.department === "";
        if (sameDept) {
          const existing = parseAssignees(m.assignee);
          const merged = [
            ...existing,
            ...peopleAssignees.filter((n) => !existing.includes(n)),
          ];
          autoResolved.push({
            id: m.id,
            department: peopleDept,
            assignee: formatAssignees(merged),
          });
        } else {
          // Cross-dept append forces dept change — route to individual confirm
          crossDeptMembers.push(m);
        }
      }

      if (crossDeptMembers.length === 0) {
        finishPeople(autoResolved);
      } else {
        setPeopleWizard({ targets: crossDeptMembers, step: 0, resolved: autoResolved });
      }
      return;
    }
  };

  const resolvePeopleStep = (choice: "replace" | "append" | "skip") => {
    if (!peopleWizard) return;
    const member = peopleWizard.targets[peopleWizard.step];
    const resolved = [...peopleWizard.resolved];
    if (choice === "replace") {
      resolved.push({ id: member.id, department: peopleDept, assignee: targetAssigneeStr });
    } else if (choice === "append") {
      // Only reachable when same-dept; merge assignees
      const existing = parseAssignees(member.assignee);
      const merged = [...existing, ...peopleAssignees.filter((n) => !existing.includes(n))];
      resolved.push({ id: member.id, department: member.department, assignee: formatAssignees(merged) });
    }
    // skip → not added
    const next = peopleWizard.step + 1;
    if (next >= peopleWizard.targets.length) {
      finishPeople(resolved);
    } else {
      setPeopleWizard({ ...peopleWizard, step: next, resolved });
    }
  };

  // ---- System/duration apply ----

  const finish = (updates: Update[]) => {
    if (!attrField) return;
    onApplyAttribute(attrField, updates);
    setWizard(null);
    setValue("");
    setPolicy(null);
  };

  const apply = () => {
    if (!attrField) return;
    if (action === "clear") {
      finish(members.map((m) => ({ id: m.id, value: "" })));
      return;
    }
    if (!hasConflict) {
      finish(members.map((m) => ({ id: m.id, value })));
      return;
    }
    if (effectivePolicy === null) return;
    if (effectivePolicy === "individual") {
      const base = members
        .filter((m) => m[attrField].trim() === "")
        .map((m) => ({ id: m.id, value }));
      setWizard({ step: 0, resolved: base });
      return;
    }
    const updates = members.flatMap<Update>((m) => {
      const existing = m[attrField].trim();
      if (existing === "") return [{ id: m.id, value }];
      if (existing === value.trim()) return []; // 동일 값 — 자동 스킵
      if (effectivePolicy === "replace") return [{ id: m.id, value }];
      if (effectivePolicy === "append") return [{ id: m.id, value: `${m[attrField]}, ${value}` }];
      return []; // skip
    });
    finish(updates);
  };

  const resolveStep = (choice: "replace" | "append" | "skip") => {
    if (!wizard || !attrField) return;
    const member = attrConflicts[wizard.step];
    const resolved = [...wizard.resolved];
    if (choice === "replace") resolved.push({ id: member.id, value });
    else if (choice === "append")
      resolved.push({ id: member.id, value: `${member[attrField]}, ${value}` });
    // skip → 추가 안 함
    const next = wizard.step + 1;
    if (next >= attrConflicts.length) {
      finish(resolved);
    } else {
      setWizard({ step: next, resolved });
    }
  };

  // ---- Dept change handler — clears out-of-dept assignees ----
  const handleDeptChange = (newDept: string) => {
    setPeopleDept(newDept);
    if (newDept === "") {
      setPeopleAssignees([]);
    } else {
      setPeopleAssignees((prev) =>
        prev.filter((name) => {
          const p = userPersons.find((u) => u.name === name);
          return p?.department === newDept;
        }),
      );
    }
    setPolicy(null);
  };

  const handleAddAssignee = (name: string) => {
    if (!name) return;
    const result = addAssignee(peopleDept, peopleAssignees, name, userPersons);
    setPeopleDept(result.department);
    setPeopleAssignees(result.assignees);
  };

  const handleRemoveAssignee = (name: string) => {
    setPeopleAssignees((prev) => prev.filter((n) => n !== name));
  };

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="w-96 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ---- People wizard ---- */}
        {peopleWizard ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-body-strong text-ink">{t("bulk.individual")}</p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.step", {
                  done: peopleWizard.step + 1,
                  total: peopleWizard.targets.length,
                })}
              </span>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${((peopleWizard.step + 1) / peopleWizard.targets.length) * 100}%`,
                }}
              />
            </div>
            {(() => {
              const member = peopleWizard.targets[peopleWizard.step];
              const isCrossDept =
                member.department !== "" && member.department !== peopleDept;
              return (
                <>
                  <p className="mb-1 text-caption text-ink">{member.label || member.id}</p>
                  <p className="mb-0.5 text-fine text-ink-tertiary">
                    {t("bulk.existing")}: {[member.department, member.assignee].filter(Boolean).join(" / ") || "—"}
                  </p>
                  <p className="mb-2 text-fine text-ink-tertiary">
                    {t("bulk.value")}:{" "}
                    {[peopleDept, targetAssigneeStr].filter(Boolean).join(" / ")}
                  </p>
                  {isCrossDept && (
                    <p className="mb-2 rounded-sm bg-surface-alt px-2 py-1 text-fine text-ink-secondary">
                      {t("bulk.crossDeptConfirm")}
                    </p>
                  )}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={btn}
                      onClick={() => resolvePeopleStep("replace")}
                    >
                      {t("bulk.replace")}
                    </button>
                    {!isCrossDept && hasAssignees && (
                      <button
                        type="button"
                        className={btn}
                        onClick={() => resolvePeopleStep("append")}
                      >
                        {t("bulk.append")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={btn}
                      onClick={() => resolvePeopleStep("skip")}
                    >
                      {t("bulk.skip")}
                    </button>
                  </div>
                </>
              );
            })()}
            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <button type="button" className={btn} onClick={() => setPeopleWizard(null)}>
                {t("bulk.close")}
              </button>
            </div>
          </div>
        ) : wizard ? (
          /* ---- System/duration wizard ---- */
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-body-strong text-ink">{t("bulk.individual")}</p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.step", { done: wizard.step + 1, total: attrConflicts.length })}
              </span>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${((wizard.step + 1) / attrConflicts.length) * 100}%` }}
              />
            </div>
            <p className="mb-1 text-caption text-ink">
              {attrConflicts[wizard.step].label || attrConflicts[wizard.step].id}
            </p>
            <p className="mb-1 text-fine text-ink-tertiary">
              {t("bulk.existing")}:{" "}
              {attrField ? attrConflicts[wizard.step][attrField] : ""}
            </p>
            <p className="mb-3 text-fine text-ink-tertiary">
              {t("bulk.value")}: {value}
            </p>
            <div className="flex gap-1">
              <button type="button" className={btn} onClick={() => resolveStep("replace")}>
                {t("bulk.replace")}
              </button>
              <button type="button" className={btn} onClick={() => resolveStep("append")}>
                {t("bulk.append")}
              </button>
              <button type="button" className={btn} onClick={() => resolveStep("skip")}>
                {t("bulk.skip")}
              </button>
            </div>
            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <button type="button" className={btn} onClick={() => setWizard(null)}>
                {t("bulk.close")}
              </button>
            </div>
          </div>
        ) : (
          /* ---- Main UI ---- */
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-body-strong text-ink">{t("bulk.title")}</p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.members", { n: members.length })}
              </span>
            </div>

            {/* 그룹 이름 */}
            <p className="mb-1 text-caption-strong text-ink-secondary">{t("bulk.groupName")}</p>
            <input
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              defaultValue={groupLabel}
              placeholder={t("group.untitled")}
              onBlur={(event) => onRenameGroup(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />

            {/* 색상 일괄 — 스와치 클릭 즉시 멤버 전원 적용 */}
            <p className="mb-1 mt-3 border-t border-hairline pt-3 text-caption-strong text-ink-secondary">
              {t("bulk.color")}
            </p>
            <div className="mb-3 flex flex-wrap gap-1">
              {colorPresets
                .filter((preset) => preset)
                .map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="h-5 w-5 rounded-full border border-hairline"
                    style={{ background: preset }}
                    title={preset}
                    aria-label={preset}
                    onClick={() => onApplyColor(preset)}
                  />
                ))}
            </div>

            {/* 속성 일괄 */}
            <p className="mb-1 mt-3 border-t border-hairline pt-3 text-caption-strong text-ink-secondary">
              {t("bulk.attribute")}
            </p>
            <div className="flex flex-col gap-2">
              {/* Mode selector */}
              <select
                className="rounded-sm border border-hairline px-2 py-1 text-caption"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as BulkMode);
                  setPolicy(null);
                  setValue("");
                }}
              >
                {ATTR_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(MODE_LABEL_KEY[m])}
                  </option>
                ))}
              </select>

              {/* Set / Clear toggle */}
              <div className="flex gap-3 text-caption">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={action === "set"}
                    onChange={() => setAction("set")}
                  />
                  {t("bulk.actionSet")}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={action === "clear"}
                    onChange={() => setAction("clear")}
                  />
                  {t("bulk.actionClear")}
                </label>
              </div>

              {/* People mode controls */}
              {mode === "people" && action === "set" && (
                <div className="flex flex-col gap-1.5">
                  {/* Department selector */}
                  <SearchSelect
                    value={peopleDept}
                    options={(eligible?.departments ?? []).map((d) => ({ value: d, label: d }))}
                    emptyLabel={t("field.department")}
                    placeholder={t("field.searchPlaceholder")}
                    onChange={handleDeptChange}
                  />
                  {/* Assignee chips */}
                  {peopleAssignees.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {peopleAssignees.map((name) => (
                        <span
                          key={name}
                          className="flex items-center gap-0.5 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => handleRemoveAssignee(name)}
                            aria-label={`Remove ${name}`}
                          >
                            <X size={10} strokeWidth={1.5} className="text-ink-tertiary" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Assignee picker — always value="" so it acts as a one-shot add control */}
                  <SearchSelect
                    value=""
                    options={assigneePickOptions}
                    emptyLabel={t("bulk.addAssignee")}
                    placeholder={t("field.searchPlaceholder")}
                    onChange={handleAddAssignee}
                  />
                </div>
              )}

              {/* System/duration value input */}
              {mode !== "people" && action === "set" && (
                <input
                  className="rounded-sm border border-hairline px-2 py-1 text-caption"
                  placeholder={t("bulk.value")}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}

              {/* 충돌 처리 — 설정인데 이미 값 있는 멤버가 있을 때만. 디폴트 없음(필수) */}
              {hasConflict && (
                <div className="rounded-sm bg-surface-alt p-2 text-caption">
                  {/* 5-3 호버 시 기존 데이터 팝오버 */}
                  <div
                    className="relative mb-1 inline-block"
                    onMouseEnter={() => setShowConflicts(true)}
                    onMouseLeave={() => setShowConflicts(false)}
                  >
                    <span className="cursor-help text-fine text-ink-tertiary underline decoration-dotted">
                      {t("bulk.conflict", {
                        n: mode === "people" ? peopleConflicts.length : attrConflicts.length,
                      })}
                    </span>
                    {showConflicts && (
                      <div className="absolute left-0 top-full z-10 mt-1 max-h-40 w-64 overflow-y-auto rounded-sm border border-hairline bg-surface p-2 shadow-lg">
                        <ul className="flex flex-col gap-0.5">
                          {(mode === "people" ? peopleConflicts : attrConflicts).map((m) => (
                            <li key={m.id} className="flex justify-between gap-2 text-fine">
                              <span className="truncate text-ink-tertiary">
                                {m.label || m.id}
                              </span>
                              <span className="shrink-0 text-ink">
                                {mode === "people"
                                  ? [m.department, m.assignee].filter(Boolean).join(" / ")
                                  : attrField
                                    ? m[attrField]
                                    : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {visiblePolicies.map(({ key, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPolicy(key)}
                        className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-2 text-caption ${
                          effectivePolicy === key
                            ? "border-accent bg-accent-tint text-accent"
                            : "border-hairline text-ink hover:border-accent/50 hover:bg-surface-alt"
                        }`}
                      >
                        <Icon size={18} strokeWidth={1.5} className="shrink-0" />
                        {t(`bulk.${key}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="mt-1 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
                disabled={
                  (action === "set" &&
                    mode === "people" &&
                    peopleDept === "" &&
                    peopleAssignees.length === 0) ||
                  (action === "set" && mode !== "people" && value.trim() === "") ||
                  (hasConflict && effectivePolicy === null)
                }
                onClick={mode === "people" ? applyPeople : apply}
              >
                {t("bulk.apply")}
              </button>
            </div>

            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <button type="button" className={btn} onClick={onClose}>
                {t("bulk.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
