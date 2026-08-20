"use client";

// 그룹 멤버 일괄 편집 — 그룹명, 색상 일괄, 속성 일괄(설정/비우기 + 충돌 처리: 교체/추가/건너뛰기/개별 선택), 중단 (#5 2026-06-15)
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Eraser,
  ListChecks,
  MousePointerClick,
  PencilLine,
  Plus,
  Replace,
  Server,
  SkipForward,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AutoHeight } from "@/components/auto-height";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { DETAIL_FIELD_ICONS } from "@/components/node-details-fields";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { SearchSelect } from "@/components/search-select";
import { getEligibleAssignees, type EligibleAssignees } from "@/lib/api";
import { addAssignee, formatAssignees, parseAssignees } from "@/lib/assignee";
import { canBulkEditField, isBulkParamField, type BulkDetailField } from "@/lib/bulk-params";
import { useI18n } from "@/lib/i18n";
import { buildAssigneeOptions, buildDepartmentOptions } from "@/lib/korean-dept";
import { formatParamValue, PARAM_FIELDS, PARAM_LABEL_KEY, type ParamField } from "@/lib/params";
import type { MessageKey } from "@/lib/i18n-messages";

// "people" = combined assignee+department mode; 나머지는 단일 필드 모드(system + 파라미터 7종 + IO·조건)
export type BulkAttrField = "system" | ParamField | BulkDetailField;
export type BulkMode = "people" | BulkAttrField;
export type BulkAction = "set" | "clear";
// 충돌 처리: 교체/추가(system·조건=콤마, IO=줄)/건너뛰기/개별 선택. null=미선택(필수)
export type BulkPolicy = "replace" | "append" | "skip" | "individual";
// Combined people update written by onApplyPeople
export type PeopleUpdate = { id: string; department: string; assignee: string };

interface ModeMeta {
  key: BulkMode;
  icon: LucideIcon;
  labelKey: MessageKey;
}

// 카테고리 아코디언 — 수행 지표 / 입출력·조건 / 속성 3분류, 클릭 시 하위 모드 버튼 노출
// (사용자 결정 2026-08-20). 라벨은 인스펙터 카드와 동일 키 재사용.
type BulkCategory = "metrics" | "details" | "attributes";
// 순서는 인스펙터 카드 배치와 동일 — 속성/수행 지표/입출력·조건 (사용자 결정 2026-08-20)
const CATEGORY_META: { key: BulkCategory; labelKey: MessageKey; modes: ModeMeta[] }[] = [
  {
    key: "attributes",
    labelKey: "bulk.catAttributes",
    modes: [
      { key: "people", icon: Users, labelKey: "bulk.modePeople" },
      { key: "system", icon: Server, labelKey: "field.system" },
    ],
  },
  {
    key: "metrics",
    labelKey: "inspector.parameters",
    modes: PARAM_FIELDS.map((f) => ({ key: f, icon: PARAM_ICON[f], labelKey: PARAM_LABEL_KEY[f] })),
  },
  {
    key: "details",
    labelKey: "inspector.details",
    modes: [
      { key: "input", icon: DETAIL_FIELD_ICONS.input, labelKey: "field.input" },
      { key: "output", icon: DETAIL_FIELD_ICONS.output, labelKey: "field.output" },
      { key: "start_condition", icon: DETAIL_FIELD_ICONS.start_condition, labelKey: "field.startCondition" },
      { key: "end_condition", icon: DETAIL_FIELD_ICONS.end_condition, labelKey: "field.endCondition" },
    ],
  },
];
const getCategoryOf = (mode: BulkMode): BulkCategory =>
  CATEGORY_META.find((c) => c.modes.some((m) => m.key === mode))?.key ?? "attributes";

// IO textarea 정리 — 줄 단위 trim + 빈 줄 제거(blur 시 적용, MultiValueInput commit과 동일 규칙)
const normalizeMultiline = (v: string): string =>
  v.split("\n").map((s) => s.trim()).filter((s) => s !== "").join("\n");

// append 조인 — IO는 항목(줄) 추가, system·조건은 콤마 이어붙임
const appendAttrValue = (field: BulkAttrField, existing: string, value: string): string =>
  field === "input" || field === "output" ? `${existing}\n${value}` : `${existing}, ${value}`;
// 값 설정 / 비우기 — 선택 필(아이콘 + 라벨)
const ACTION_META: { key: BulkAction; icon: LucideIcon; labelKey: MessageKey }[] = [
  { key: "set", icon: PencilLine, labelKey: "bulk.actionSet" },
  { key: "clear", icon: Eraser, labelKey: "bulk.actionClear" },
];

// 충돌 처리 옵션 — 아이콘 + 2×2 그리드로 한눈에
const POLICY_META: { key: BulkPolicy; icon: LucideIcon }[] = [
  { key: "replace", icon: Replace }, // 교체 — 기존↔새 값 교체
  { key: "append", icon: Plus }, // 추가 — 기존에 새 값 덧붙임
  { key: "skip", icon: SkipForward }, // 건너뛰기 — 충돌 멤버 그대로 둠
  { key: "individual", icon: MousePointerClick }, // 개별 — 하나씩 선택
];

// 파라미터 값 표시 전용 — 표시형(1h30m·통화기호), 무효/빈값은 원문 폴백(compare의 displayFieldValue 패턴).
// system은 원문 그대로. 편집 입력은 ParamInput이 담당.
const displayAttrValue = (field: BulkAttrField, raw: string): string =>
  isBulkParamField(field) ? formatParamValue(field, raw) || raw : raw;

export interface BulkMember {
  id: string;
  label: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  touch_time: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  // 입출력·조건 일괄 모드 소스 (2026-08-20)
  input: string;
  output: string;
  start_condition: string;
  end_condition: string;
  nodeType: string; // 모드별 편집 대상 판정에 사용 (canBulkEditField)
}

// 비용 모드는 어느 통화든 기존 값으로 취급(배타 불변식상 노드의 비용은 하나) — 통화 전환도 충돌로 노출
const getExistingAttrRaw = (m: BulkMember, field: BulkAttrField): string =>
  field === "cost_krw" || field === "cost_usd"
    ? m.cost_krw.trim() !== ""
      ? m.cost_krw
      : m.cost_usd
    : m[field];

// 기존 값 표시 — 비용은 실제 보유 통화의 기호로 포맷(₩/$), 나머지는 displayAttrValue
const displayExistingAttr = (m: BulkMember, field: BulkAttrField): string => {
  if (field === "cost_krw" || field === "cost_usd") {
    const holder = m.cost_krw.trim() !== "" ? "cost_krw" : "cost_usd";
    return formatParamValue(holder, m[holder]) || m[holder];
  }
  return displayAttrValue(field, m[field]);
};

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
  members: allMembers,
  colorPresets,
  onRenameGroup,
  onApplyColor,
  onApplyAttribute,
  onApplyPeople,
  onClose,
}: GroupBulkModalProps) {
  const { t, lang } = useI18n();

  // Shared UI state
  const [mode, setMode] = useState<BulkMode>("people");
  // 카테고리 아코디언 — 한 번에 하나만 펼침, 기본은 현재 모드의 카테고리 (사용자 결정 2026-08-20)
  const [openCategory, setOpenCategory] = useState<BulkCategory | null>(() => getCategoryOf("people"));
  const [policy, setPolicy] = useState<BulkPolicy | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [colorFlyLeft, setColorFlyLeft] = useState(false); // 색상 플라이아웃 화면 가장자리 시 좌측 반전
  // 적용 후 최종 변경 요약(이전→현재) — 확인 시 모달 닫힘
  const [summary, setSummary] = useState<
    { id: string; label: string; before: string; after: string }[] | null
  >(null);
  // 개별 마법사 버튼 호버 — 미리보기(교체/추가/건너뛰기)에 따라 버려지는 쪽 빨간 표시
  const [wizardHover, setWizardHover] = useState<"replace" | "append" | "skip" | null>(null);

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
  const assigneePickOptions = buildAssigneeOptions(
    users.filter(
      (u) => (!peopleDept || u.department === peopleDept) && !peopleAssignees.includes(u.name),
    ),
    lang,
  );

  // ---- Mode-dependent membership ----

  // People mode가 아니면 단일 필드 모드
  const attrField = mode !== "people" ? (mode as BulkAttrField) : null;
  // 모드별 대상 — people/system은 BPM 속성 노드(process·decision)만, 파라미터는 노드 타입별
  // 편집 가능 집합(subprocess는 annual_count·fte만 포함). 속성 로직은 전부 members만 순회하고,
  // 헤더 카운트·제외 안내만 allMembers 사용.
  const members = allMembers.filter((m) => canBulkEditField(m.nodeType, attrField ?? "people"));
  const excludedMembers = allMembers.filter(
    (m) => !canBulkEditField(m.nodeType, attrField ?? "people"),
  );

  // ---- Conflict detection ----

  // People mode conflict: member has existing dept or assignee that differs from target
  const isPeopleConflict = (m: BulkMember) => {
    const hasExisting = m.department !== "" || m.assignee !== "";
    if (!hasExisting) return false;
    const deptMatches = m.department === peopleDept;
    // Department-only mode: only department must match; an existing assignee is NOT a conflict
    // and will be silently cleared on apply — intentional per spec.
    const assigneeMatches = hasAssignees ? m.assignee === targetAssigneeStr : true;
    return !(deptMatches && assigneeMatches);
  };

  const peopleConflicts = members.filter(isPeopleConflict);

  // 단일 필드 모드 충돌 — 비용은 반대 통화 보유(통화 전환)도 충돌로 취급
  const attrConflicts = attrField
    ? members.filter(
        (m) =>
          getExistingAttrRaw(m, attrField).trim() !== "" && m[attrField].trim() !== value.trim(),
      )
    : [];

  const hasConflict =
    mode === "people"
      ? action === "set" && peopleConflicts.length > 0
      : action === "set" && attrConflicts.length > 0;

  // Available policies — people+dept-only omits append (department is single-valued).
  // 파라미터 모드도 append 제외 — 숫자에 콤마 append는 무효값이 되어 백엔드 소거로 기존값 유실.
  const availablePolicies: Set<BulkPolicy> = new Set<BulkPolicy>(
    (mode === "people" && !hasAssignees) || (attrField !== null && isBulkParamField(attrField))
      ? ["replace", "individual", "skip"]
      : ["replace", "append", "skip", "individual"],
  );

  // Effective policy: if current selection is no longer in available set, treat as null
  const effectivePolicy = policy !== null && availablePolicies.has(policy) ? policy : null;

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  // ---- People mode apply ----

  // 라벨 조회 헬퍼 — 요약 표시용
  const labelOf = (id: string) => allMembers.find((m) => m.id === id)?.label || id;

  const finishPeople = (updates: PeopleUpdate[]) => {
    onApplyPeople(updates);
    setSummary(
      updates.map((u) => {
        const m = allMembers.find((mm) => mm.id === u.id);
        return {
          id: u.id,
          label: labelOf(u.id),
          before: [m?.department, m?.assignee].filter(Boolean).join(" / ") || "-",
          after: [u.department, u.assignee].filter(Boolean).join(" / ") || t("bulk.cleared"),
        };
      }),
    );
    setPeopleWizard(null);
    setWizardHover(null);
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
      // Reachable when not cross-dept, incl. empty-dept members; merge assignees
      const existing = parseAssignees(member.assignee);
      const merged = [...existing, ...peopleAssignees.filter((n) => !existing.includes(n))];
      resolved.push({ id: member.id, department: peopleDept || member.department, assignee: formatAssignees(merged) });
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
    setSummary(
      updates.map((u) => {
        const m = allMembers.find((mm) => mm.id === u.id);
        return {
          id: u.id,
          label: labelOf(u.id),
          before: (m ? displayExistingAttr(m, attrField) : "") || "-",
          after: displayAttrValue(attrField, u.value) || t("bulk.cleared"),
        };
      }),
    );
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
        .filter((m) => getExistingAttrRaw(m, attrField).trim() === "")
        .map((m) => ({ id: m.id, value }));
      setWizard({ step: 0, resolved: base });
      return;
    }
    const updates = members.flatMap<Update>((m) => {
      const existing = getExistingAttrRaw(m, attrField).trim();
      if (existing === "") return [{ id: m.id, value }];
      if (m[attrField].trim() === value.trim()) return []; // 동일 값(비용은 같은 통화) — 자동 스킵
      if (effectivePolicy === "replace") return [{ id: m.id, value }];
      if (effectivePolicy === "append")
        return [{ id: m.id, value: appendAttrValue(attrField, m[attrField], value) }];
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
      resolved.push({ id: member.id, value: appendAttrValue(attrField, member[attrField], value) });
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
      className="fixed inset-0 z-[1200] flex items-start justify-center pt-[10vh] backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        data-id="group-bulk-modal"
        // w-[29rem](464px): 속성 3열 그리드의 최장 영어 라벨("Duration / run (h)")+아이콘이 버튼 안에 들어오는 최소폭(445px)+여유. 한국어(418px)도 커버.
        className="w-[29rem] rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 상단 고정 + 높이 전환 스무딩 — 화면(요약/마법사/메인)·모드 전환의 키가 부드럽게 이어진다 */}
        <AutoHeight className="max-h-[76vh]">
        {/* ---- 적용 후 최종 변경 요약 — 확인 시 모달 닫힘 ---- */}
        {summary ? (
          /* ---- 적용 후 변경 요약 — 대표 모달(아이콘 원+요약박스) 스타일, 이전→현재 표 ---- */
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-tint text-accent">
              <ListChecks size={26} strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-body-strong text-ink">{t("bulk.summaryTitle")}</h2>
              <p className="text-caption text-ink-tertiary">
                {t("bulk.summaryCount", { n: summary.length })}
              </p>
            </div>
            {summary.length === 0 ? (
              <p className="text-caption text-ink-tertiary">{t("bulk.summaryNone")}</p>
            ) : (
              <div className="max-h-64 w-full overflow-y-auto rounded-sm bg-surface-alt p-1 text-left">
                <table className="w-full border-collapse text-fine">
                  <thead>
                    <tr className="text-ink-tertiary">
                      <th className="px-1.5 py-1 text-left font-normal">{t("bulk.summaryNode")}</th>
                      <th className="px-1.5 py-1 text-left font-normal">{t("bulk.before")}</th>
                      <th className="px-1 py-1" />
                      <th className="px-1.5 py-1 text-left font-normal">{t("bulk.after")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.id} className="border-t border-hairline align-top">
                        <td className="px-1.5 py-1 text-ink">{r.label}</td>
                        <td className="whitespace-pre-wrap px-1.5 py-1 text-ink-tertiary line-through">{r.before}</td>
                        <td className="px-1 py-1">
                          <ArrowRight
                            size={11}
                            strokeWidth={1.5}
                            className="shrink-0 text-ink-tertiary"
                          />
                        </td>
                        <td className="whitespace-pre-wrap px-1.5 py-1 text-ink">{r.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="button"
              className="w-full rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
              onClick={onClose}
            >
              {t("bulk.confirm")}
            </button>
          </div>
        ) : peopleWizard ? (
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
              const existingAssignees = parseAssignees(member.assignee);
              // 미리보기: 기본·교체=기존 버림 / 건너뛰기=새 값 버림(반전) / 추가=둘 다 유지
              const discardExisting = wizardHover === null || wizardHover === "replace";
              const discardNew = wizardHover === "skip";
              const pillCls = (discarded: boolean) =>
                `rounded-full border px-1.5 py-0.5 text-fine ${
                  discarded
                    ? "border-error/40 bg-error/10 text-error line-through"
                    : "border-hairline bg-surface text-ink"
                }`;
              const rowCls = "w-9 shrink-0 pt-0.5 text-fine text-ink-tertiary";
              return (
                <>
                  <p className="mb-2 text-caption text-ink">{member.label || member.id}</p>
                  {isCrossDept && (
                    <p className="mb-1.5 flex items-center gap-1 text-fine text-error">
                      <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
                      {t("bulk.crossDeptConfirm")}
                    </p>
                  )}
                  {/* 이전 → 현재: 부서·담당자 필. 버려지는 쪽은 취소선+빨강(버튼 호버로 미리보기) */}
                  <div className="mb-2 flex flex-col gap-1.5 rounded-sm bg-surface-alt p-2">
                    <div className="flex items-start gap-1.5">
                      <span className={rowCls}>{t("bulk.before")}</span>
                      <div className="flex flex-wrap gap-1">
                        <span className={pillCls(discardExisting)}>{member.department || "-"}</span>
                        {existingAssignees.map((n) => (
                          <span key={n} className={pillCls(discardExisting)}>
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className={rowCls}>{t("bulk.after")}</span>
                      <div className="flex flex-wrap gap-1">
                        <span className={pillCls(discardNew)}>{peopleDept || "-"}</span>
                        {peopleAssignees.map((n) => (
                          <span key={n} className={pillCls(discardNew)}>
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={`${btn} flex items-center gap-1`}
                      onMouseEnter={() => setWizardHover("replace")}
                      onMouseLeave={() => setWizardHover(null)}
                      onClick={() => resolvePeopleStep("replace")}
                    >
                      <Replace size={13} strokeWidth={1.5} className="shrink-0" />
                      {t("bulk.replace")}
                    </button>
                    {!isCrossDept && hasAssignees && (
                      <button
                        type="button"
                        className={`${btn} flex items-center gap-1`}
                        onMouseEnter={() => setWizardHover("append")}
                        onMouseLeave={() => setWizardHover(null)}
                        onClick={() => resolvePeopleStep("append")}
                      >
                        <Plus size={13} strokeWidth={1.5} className="shrink-0" />
                        {t("bulk.append")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${btn} flex items-center gap-1`}
                      onMouseEnter={() => setWizardHover("skip")}
                      onMouseLeave={() => setWizardHover(null)}
                      onClick={() => resolvePeopleStep("skip")}
                    >
                      <SkipForward size={13} strokeWidth={1.5} className="shrink-0" />
                      {t("bulk.skip")}
                    </button>
                  </div>
                </>
              );
            })()}
            <div className="mt-3 flex justify-end border-t border-hairline pt-3">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setPeopleWizard(null);
                  setWizardHover(null);
                }}
              >
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
            <p className="mb-1 whitespace-pre-wrap text-fine text-ink-tertiary">
              {t("bulk.existing")}:{" "}
              {attrField ? displayExistingAttr(attrConflicts[wizard.step], attrField) : ""}
            </p>
            <p className="mb-3 whitespace-pre-wrap text-fine text-ink-tertiary">
              {t("bulk.value")}: {attrField ? displayAttrValue(attrField, value) : value}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className={`${btn} flex items-center gap-1`}
                onClick={() => resolveStep("replace")}
              >
                <Replace size={13} strokeWidth={1.5} className="shrink-0" />
                {t("bulk.replace")}
              </button>
              {!(attrField !== null && isBulkParamField(attrField)) && (
                <button
                  type="button"
                  className={`${btn} flex items-center gap-1`}
                  onClick={() => resolveStep("append")}
                >
                  <Plus size={13} strokeWidth={1.5} className="shrink-0" />
                  {t("bulk.append")}
                </button>
              )}
              <button
                type="button"
                className={`${btn} flex items-center gap-1`}
                onClick={() => resolveStep("skip")}
              >
                <SkipForward size={13} strokeWidth={1.5} className="shrink-0" />
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
              <p className="flex items-center gap-2 text-body-strong text-ink">
                <SlidersHorizontal size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                {t("bulk.title")}
              </p>
              <span className="text-fine text-ink-tertiary">
                {t("bulk.members", { n: allMembers.length })}
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

            {/* 색상 일괄 — 라벨 호버 시 옆으로 펼쳐지는 날개 플라이아웃(가장자리 시 좌측 반전), 스와치 클릭 즉시 그룹 노드 전원 적용 */}
            <div
              className="relative mb-3 mt-3 border-t border-hairline pt-3"
              onMouseEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setColorFlyLeft(rect.right + 190 > window.innerWidth);
                setShowColors(true);
              }}
              onMouseLeave={() => setShowColors(false)}
            >
              <p className="flex cursor-default items-center justify-between text-caption-strong text-ink-secondary">
                {t("bulk.color")}
                <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              </p>
              {showColors && (
                <div
                  className={`absolute top-2 z-20 w-44 rounded-sm border border-hairline bg-surface p-2 shadow-lg ${
                    colorFlyLeft ? "right-full" : "left-full"
                  }`}
                >
                  <div className="flex flex-wrap gap-1">
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
                </div>
              )}
            </div>

            {/* 속성 일괄 */}
            <p className="mb-1 mt-3 border-t border-hairline pt-3 text-caption-strong text-ink-secondary">
              {t("bulk.attribute")}
            </p>
            <div className="flex flex-col gap-2">
              {/* 카테고리 3버튼 한 행 — 클릭하면 아래 섹션에 하위 모드 버튼이 펼쳐지고, 다른
                  카테고리를 누르면 아래 내용이 교체된다(같은 버튼 재클릭=접힘) (사용자 결정 2026-08-20) */}
              <div className="grid grid-cols-3 gap-1">
                {CATEGORY_META.map(({ key: catKey, labelKey: catLabelKey, modes }) => {
                  const open = openCategory === catKey;
                  const holdsActiveMode = modes.some((m) => m.key === mode);
                  return (
                    <button
                      key={catKey}
                      type="button"
                      data-id={`bulk-category-${catKey}`}
                      aria-expanded={open}
                      className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-sm border px-1 py-1.5 text-caption ${
                        open
                          ? "border-accent bg-accent-tint text-accent"
                          : "border-hairline text-ink hover:bg-surface-alt"
                      }`}
                      onClick={() => setOpenCategory(open ? null : catKey)}
                    >
                      {/* 현재 선택 모드가 속한 카테고리 표시점 — 라벨 앞(사용자 결정 2026-08-20) */}
                      {holdsActiveMode && <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />}
                      <span className="truncate">{t(catLabelKey)}</span>
                    </button>
                  );
                })}
              </div>
              <AutoHeight className="overflow-hidden">
              {openCategory !== null && (
                <div
                  data-id="bulk-category-panel"
                  className="grid grid-cols-3 gap-1 rounded-sm border border-hairline bg-surface-alt/50 p-1"
                >
                  {(CATEGORY_META.find((c) => c.key === openCategory)?.modes ?? []).map(
                    ({ key, icon: Icon, labelKey }) => (
                      <button
                        key={key}
                        type="button"
                        data-id={`bulk-mode-${key}`}
                        onClick={() => {
                          setMode(key);
                          setPolicy(null);
                          setValue("");
                        }}
                        className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-sm border px-1 py-1.5 text-fine ${
                          mode === key
                            ? "border-accent bg-accent-tint text-accent"
                            : "border-hairline bg-surface text-ink hover:bg-surface-alt"
                        }`}
                      >
                        <Icon size={13} strokeWidth={1.5} className="shrink-0" />
                        <span className="truncate">{t(labelKey)}</span>
                      </button>
                    ),
                  )}
                </div>
              )}
              </AutoHeight>

              {/* 값 설정 / 비우기 — 선택 필(아이콘 + 라벨) */}
              <div className="flex gap-1">
                {ACTION_META.map(({ key, icon: Icon, labelKey }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAction(key)}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-fine ${
                      action === key
                        ? "border-accent bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.5} className="shrink-0" />
                    {t(labelKey)}
                  </button>
                ))}
              </div>

              {/* People mode controls */}
              {mode === "people" && action === "set" && (
                <div className="flex flex-col gap-1.5">
                  {/* Department selector */}
                  <SearchSelect
                    value={peopleDept}
                    options={buildDepartmentOptions(
                      eligible?.departments ?? [],
                      users,
                      lang,
                      eligible?.dept_infos,
                    )}
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

              {/* 값 입력 — 파라미터 6종은 ParamInput(숫자 강제+blur 정규화+비포커스 표시형), system은 자유텍스트 */}
              {mode !== "people" && action === "set" &&
                (attrField !== null && isBulkParamField(attrField) ? (
                  <ParamInput
                    key={attrField} // 모드 전환 시 내부 focused 상태 초기화
                    field={attrField}
                    className="rounded-sm border border-hairline px-2 py-1 text-caption"
                    placeholder={t("bulk.value")}
                    ariaLabel={t("bulk.value")}
                    value={value}
                    onCommit={setValue}
                  />
                ) : attrField === "input" || attrField === "output" ? (
                  /* IO는 개행 복수 — 줄=항목. 항목별 데이터 폼은 일괄 대상 아님(교체 시 정렬 무효화는
                     buildBulkAttrPatch가 처리) */
                  <textarea
                    data-id="bulk-value-multiline"
                    className="min-h-[3.5rem] resize-y rounded-sm border border-hairline px-2 py-1 text-caption"
                    placeholder={t("bulk.valuePerLine")}
                    aria-label={t("bulk.value")}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onBlur={(event) => setValue(normalizeMultiline(event.target.value))}
                  />
                ) : (
                  <input
                    className="rounded-sm border border-hairline px-2 py-1 text-caption"
                    placeholder={t("bulk.value")}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                ))}

              {/* 충돌 처리 — 설정인데 이미 값 있는 멤버가 있을 때만. 디폴트 없음(필수) */}
              <AutoHeight className="overflow-hidden">
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
                                    ? displayExistingAttr(m, attrField)
                                    : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  {/* 4개 버튼 위치 고정 — 미가용 옵션은 제거하지 않고 비활성 표시 */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {POLICY_META.map(({ key, icon: Icon }) => {
                      const enabled = availablePolicies.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!enabled}
                          onClick={() => setPolicy(key)}
                          className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-2 text-caption disabled:cursor-not-allowed disabled:border-hairline disabled:bg-surface disabled:text-ink-tertiary disabled:opacity-50 disabled:hover:border-hairline disabled:hover:bg-surface ${
                            effectivePolicy === key
                              ? "border-accent bg-accent-tint text-accent"
                              : "border-hairline text-ink hover:border-accent/50 hover:bg-surface-alt"
                          }`}
                        >
                          <Icon size={18} strokeWidth={1.5} className="shrink-0" />
                          {t(`bulk.${key}` as MessageKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              </AutoHeight>

              {/* 제외 안내 — 모드별 편집 불가 타입(canBulkEditField). 호버 시 타입별 개수 */}
              {excludedMembers.length > 0 && (
                <div
                  className="relative inline-block self-start"
                  onMouseEnter={() => setShowExcluded(true)}
                  onMouseLeave={() => setShowExcluded(false)}
                >
                  <span className="cursor-help text-fine text-ink-tertiary underline decoration-dotted">
                    {t("bulk.excluded", { n: excludedMembers.length })}
                  </span>
                  {showExcluded && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-44 rounded-sm border border-hairline bg-surface p-2 shadow-lg">
                      <ul className="flex flex-col gap-0.5">
                        {(["start", "end", "subprocess"] as const)
                          .map((tp) => ({
                            tp,
                            n: excludedMembers.filter((m) => m.nodeType === tp).length,
                          }))
                          .filter((x) => x.n > 0)
                          .map(({ tp, n }) => (
                            <li key={tp} className="flex justify-between gap-2 text-fine">
                              <span className="text-ink-tertiary">
                                {t(`nodeType.${tp}` as MessageKey)}
                              </span>
                              <span className="text-ink">{n}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
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
        </AutoHeight>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
