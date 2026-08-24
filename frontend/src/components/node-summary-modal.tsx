"use client";

// 노드 더블클릭 요약 모달 — 전/후 단계, 하위 프로세스 프리뷰, 코멘트(읽기+추가), 메타.
// 바깥 클릭/Esc로 닫힘. readOnly면 코멘트 추가 숨김.

import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleDot,
  CornerDownRight,
  Diamond,
  Square,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { AutoHeight } from "@/components/auto-height";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { NodeDetailsFields } from "@/components/node-details-fields";
import { NewlineHint } from "@/components/newline-hint";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { ScopePreview } from "@/components/scope-preview";
import { SearchSelect } from "@/components/search-select";
import { UrlLabelField } from "@/components/url-label-field";
import {
  createComment,
  getEligibleAssignees,
  listComments,
  type CommentItem,
  type EligibleAssignees,
  type VersionGraph,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { addAssignee, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";
import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { buildAssigneeOptions, buildDepartmentOptions } from "@/lib/korean-dept";
import {
  formatParamValue,
  getEditableParamFields,
  isSpParamField,
  PARAM_FIELDS,
  PARAM_LABEL_KEY,
  readAttrsCollapsed,
  readDetailsCollapsed,
  readParamsCollapsed,
  writeAttrsCollapsed,
  writeDetailsCollapsed,
  writeParamsCollapsed,
  type ParamField,
  type SpParamField,
} from "@/lib/params";
import { mergeSubprocessDescription } from "@/lib/subprocess-description";

// 정보 수정 모달이 편집하는 필드 — 부분 패치
export type NodeEditPatch = Partial<{
  label: string;
  description: string;
  nodeType: ProcessNodeType;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  touch_time: string;
  input: string;
  output: string;
  input_forms: string;
  output_forms: string;
  // IO 링크 열 — 이 모달은 편집하지 않지만, 행 삭제 시 텍스트와 함께 정렬을 옮겨야 하므로 왕복시킨다 (io-linking §3)
  output_ids: string;
  input_links: string;
  output_links: string;
  input_flags: string;
  data_form: string;
  start_condition: string;
  end_condition: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  // subprocess 연결 버전 — 인스펙터 피커와 동일 즉시 반영(버퍼 아님)
  followLatest: boolean;
  linkedVersionId: number | null;
}>;

const ATTR_FIELDS: { key: "system"; labelKey: "field.system" }[] = [
  { key: "system", labelKey: "field.system" },
];

// 선후행 칩의 노드 타입별 아이콘 (캔버스 노드타입 아이콘과 동일 매핑)
const NAV_TYPE_ICONS: Record<string, LucideIcon> = {
  process: Square,
  decision: Diamond,
  start: Circle,
  end: CircleDot,
  subprocess: Boxes,
};

// 선행/후행 노드 칩 — 타입 아이콘 + 라벨, 클릭 시 그 노드 편집으로 이동.
function NavChip({
  node,
  onClick,
}: {
  node: { id: string; label: string; nodeType: string };
  onClick: () => void;
}) {
  const Icon = NAV_TYPE_ICONS[node.nodeType] ?? Square;
  return (
    <button
      type="button"
      onClick={onClick}
      title={node.label}
      className="flex min-w-0 items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink hover:border-accent hover:text-accent"
    >
      <Icon size={11} strokeWidth={1.5} className="shrink-0" />
      <span className="min-w-0 truncate">{node.label}</span>
    </button>
  );
}

interface NodeSummaryModalProps {
  versionId: number;
  nodeId: string;
  title: string;
  typeLabel: string;
  // 원시 노드 타입 — subprocess 색 UI 숨김 게이트 (typeLabel은 번역 문자열이라 판별 불가)
  nodeType: ProcessNodeType;
  groupLabel: string | null;
  predecessors: { id: string; label: string; nodeType: string }[];
  successors: { id: string; label: string; nodeType: string }[];
  hasChildren: boolean;
  fullGraph: VersionGraph | null;
  readOnly: boolean;
  // 편집 데이터 + 패치 (readOnly면 입력 비활성)
  description: string;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  touch_time: string;
  input: string;
  output: string;
  input_forms: string;
  output_forms: string;
  // IO 링크 열 — MultiValueInput이 텍스트와 함께 정렬 유지 (io-linking §3)
  output_ids: string;
  input_links: string;
  output_links: string;
  input_flags: string;
  data_form: string;
  start_condition: string;
  end_condition: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  colorPresets: string[];
  // subprocess 노드가 링크 맵에서 상속하는 회당 4필드(읽기전용 표시) — 그 외 타입은 null
  spParams: Record<SpParamField, string> | null;
  // subprocess 상속 상세(링크 맵 sp_* IO/조건) — 읽기전용 표시(#11). 그 외 타입은 null
  sp?: {
    input?: string | null;
    output?: string | null;
    input_forms?: string | null;
    output_forms?: string | null;
    start_condition?: string | null;
    end_condition?: string | null;
  } | null;
  // 표시용 GMP 분류(SP는 링크 맵 상속값을 호출부가 해석) — 읽기전용 배지(#13)
  gmp?: string;
  // subprocess 설명 베이스(링크 맵 sp_description, 읽기전용) — 이 맵의 추가분(description)과 분리 표시
  inheritedDescription?: string | null;
  // subprocess 연결 버전 피커(인스펙터와 동일 컴포넌트) — 호출부가 렌더해 주입
  versionPickerSlot?: ReactNode;
  // process·decision만 true — start/end/subprocess는 BPM 속성 입력 없음
  showAttributes: boolean;
  onPatch: (patch: NodeEditPatch) => void;
  // 열릴 때 자동 포커스할 필드 — 인스펙터 설명 더블클릭/편집 아이콘 진입 (사용자 결정 2026-08-20)
  initialFocus?: "description";
  // 제목 입력 확정(blur) 시 호출 — 이름 중복 고유화 적용
  onCommitLabel?: (label: string) => void;
  // 선행/후행 노드 클릭 시 그 노드 편집으로 전환
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
  // 하위 프로세스가 있을 때 그 캔버스로 진입 (있을 때만 버튼 노출)
  onOpenChild?: () => void;
}

export function NodeSummaryModal({
  versionId,
  nodeId,
  title,
  typeLabel,
  nodeType,
  groupLabel,
  predecessors,
  successors,
  hasChildren,
  fullGraph,
  readOnly,
  description,
  color,
  assignee,
  department,
  system,
  duration,
  touch_time,
  input,
  output,
  input_forms,
  output_forms,
  output_ids,
  input_links,
  output_links,
  input_flags,
  data_form,
  start_condition,
  end_condition,
  cost_krw,
  cost_usd,
  headcount,
  annual_count,
  fte,
  url,
  urlLabel,
  colorPresets,
  spParams,
  sp,
  gmp,
  inheritedDescription,
  versionPickerSlot,
  showAttributes,
  onPatch,
  initialFocus,
  onCommitLabel,
  onNavigate,
  onClose,
  onOpenChild,
}: NodeSummaryModalProps) {
  const { t, lang } = useI18n();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  // initialFocus="description" — 열림/노드 전환 시 설명 textarea로 포커스(커서는 끝)
  useEffect(() => {
    if (initialFocus !== "description") return;
    const el = descriptionRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [initialFocus, nodeId]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorMoreOpen, setColorMoreOpen] = useState(false);
  // Parameters 그룹 접기 — 기본 접힘, 인스펙터와 공유 키(bpm.paramsCollapsed)로 localStorage 퍼시스트
  const [paramsCollapsed, setParamsCollapsed] = useState(readParamsCollapsed);
  // I/O & Conditions 접힘 — 기본 접힘, 인스펙터와 키 공유 (사용자 결정 2026-08-20)
  const [detailsCollapsed, setDetailsCollapsed] = useState(readDetailsCollapsed);
  // BPM attributes 접힘 — 인스펙터 카드와 키 공유(bpm.attrsCollapsed) (사용자 결정 2026-08-20)
  const [attrsCollapsed, setAttrsCollapsed] = useState(readAttrsCollapsed);
  // 모달 섹션 일괄 접기/펼치기 — 인스펙터 탭 바 버튼과 동일 판정(하나라도 펼침→모두 접기).
  // 모달 3섹션은 로컬 state라 DOM 스윕 대신 직접 제어(영속 키 공유는 write*로 유지) (사용자 결정 2026-08-20)
  const anySectionOpen = !attrsCollapsed || !paramsCollapsed || !detailsCollapsed;
  const toggleAllSections = () => {
    const next = anySectionOpen; // true=모두 접기
    setAttrsCollapsed(next);
    writeAttrsCollapsed(next);
    setParamsCollapsed(next);
    writeParamsCollapsed(next);
    setDetailsCollapsed(next);
    writeDetailsCollapsed(next);
  };
  // 담당자/부서 후보 — 맵 조회권한 보유 직원만 (F5). 편집 모드에서만 조회.
  const [eligible, setEligible] = useState<EligibleAssignees | null>(null);
  // 편집 버퍼 — 저장 눌러야 노드에 반영, 취소/Esc/바깥클릭은 폐기(버퍼 편집). 노드 초기값에서 시작.
  const [form, setForm] = useState({
    label: title, description, color, assignee, department, system, duration,
    touch_time, cost_krw, cost_usd, headcount, annual_count, fte, url, urlLabel,
    input, output, input_forms, output_forms, output_ids, input_links, output_links, input_flags,
    data_form, start_condition, end_condition,
  });
  // 비용 통화 토글 — 배타 계약이라 한 번에 한 통화만. 전환 시 기존 값은 버퍼에서 소거+안내 (사용자 결정 2026-08-20)
  const [activeCurrency, setActiveCurrency] = useState<"cost_krw" | "cost_usd">(
    cost_usd !== "" ? "cost_usd" : "cost_krw",
  );
  const [costNotice, setCostNotice] = useState<{ field: "cost_krw" | "cost_usd"; value: string } | null>(null);
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  // 노드가 바뀌면(선후행 내비 등) 버퍼를 새 노드 값으로 리셋 — 렌더 중 상태조정(effect 아님).
  if (nodeId !== prevNodeId) {
    setPrevNodeId(nodeId);
    setForm({
      label: title, description, color, assignee, department, system, duration,
      touch_time, cost_krw, cost_usd, headcount, annual_count, fte, url, urlLabel,
      input, output, input_forms, output_forms, output_ids, input_links, output_links, input_flags,
      data_form, start_condition, end_condition,
    });
    setActiveCurrency(cost_usd !== "" ? "cost_usd" : "cost_krw");
    setCostNotice(null);
  }
  const switchCurrency = (target: "cost_krw" | "cost_usd") => {
    if (target === activeCurrency) return;
    const current = activeCurrency;
    const currentValue = form[current];
    if (currentValue !== "") {
      setForm((f) => ({ ...f, [current]: "" }));
      setCostNotice({ field: current, value: currentValue });
    }
    setActiveCurrency(target);
  };
  const undoCurrencySwitch = () => {
    if (costNotice === null) return;
    const other = costNotice.field === "cost_krw" ? "cost_usd" : "cost_krw";
    // 전환 취소 — 소거된 원래 통화 값을 복원하고, 전환 후 입력했을 수 있는 새 통화 값은 폐기
    setForm((f) => ({ ...f, [costNotice.field]: costNotice.value, [other]: "" }));
    setActiveCurrency(costNotice.field);
    setCostNotice(null);
  };
  // 저장 — 버퍼를 노드에 반영(라벨은 onCommitLabel로 중복 고유화) 후 닫기.
  const handleSave = useCallback(() => {
    onPatch({
      description: form.description,
      color: form.color,
      assignee: form.assignee,
      department: form.department,
      system: form.system,
      duration: form.duration,
      touch_time: form.touch_time,
      input: form.input,
      output: form.output,
      input_forms: form.input_forms,
      output_forms: form.output_forms,
      output_ids: form.output_ids,
      input_links: form.input_links,
      output_links: form.output_links,
      input_flags: form.input_flags,
      data_form: form.data_form,
      start_condition: form.start_condition,
      end_condition: form.end_condition,
      cost_krw: form.cost_krw,
      cost_usd: form.cost_usd,
      headcount: form.headcount,
      annual_count: form.annual_count,
      fte: form.fte,
      url: form.url,
      urlLabel: form.urlLabel,
    });
    onCommitLabel?.(form.label);
    onClose();
  }, [form, onPatch, onCommitLabel, onClose]);

  // 선후행 내비 — 버퍼에 변경이 있으면 확인(저장/저장안함/취소), 없으면 바로 이동.
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  // 부서 변경 시 담당자가 있으면 확인 오버레이 표시 — 확인 후 담당자 초기화.
  const [pendingDept, setPendingDept] = useState<string | null>(null);
  const users = eligible?.users ?? [];
  const assignees = parseAssignees(form.assignee);
  const drifted = driftedAssignees(form.department, assignees, users);
  // 노드 타입별 편집 가능 파라미터 — subprocess는 회당 4필드가 링크 맵 지정값이라 제외 (design §3.1)
  const editableParams = getEditableParamFields(nodeType);
  // Parameters 접힘 헤더의 채워진 개수 — 렌더 시 파생
  const filledParamCount = editableParams.filter((f) => form[f]).length;
  // BPM attributes 접힘 헤더의 채워진 개수 — 버퍼(form) 기준
  const filledAttrCount = [form.department, form.assignee, form.system, form.url]
    .filter((v) => v !== "").length;
  // 버퍼 변경 노출 — 초기값 대비 달라진 필드(섹션 점 + 푸터 목록) (사용자 결정 2026-08-20)
  const initialForm: Record<string, string> = {
    label: title, description, color, assignee, department, system, duration,
    touch_time, cost_krw, cost_usd, headcount, annual_count, fte, url, urlLabel,
    input, output, input_forms, output_forms, output_ids, input_links, output_links, input_flags,
    data_form, start_condition, end_condition,
  };
  const changedKeys = Object.keys(initialForm).filter(
    (k) => (form as Record<string, string>)[k] !== initialForm[k],
  );
  const hasChangedIn = (keys: readonly string[]) => changedKeys.some((k) => keys.includes(k));
  const ATTRS_KEYS = ["assignee", "department", "system", "url", "urlLabel"] as const;
  const DETAILS_KEYS = ["input", "output", "input_forms", "output_forms", "output_ids", "input_links",
    "output_links", "input_flags", "data_form", "start_condition", "end_condition"] as const;
  // 폼(항목별)은 소속 IO 라벨로 접고, URL 라벨은 URL로 접어 중복 제거
  const CHANGED_LABEL_KEY: Record<string, MessageKey> = {
    label: "field.title", description: "field.description", color: "field.color",
    assignee: "field.assignee", department: "field.department", system: "field.system",
    url: "field.url", urlLabel: "field.url",
    input: "field.input", input_forms: "field.input", input_links: "field.input", input_flags: "field.input",
    output: "field.output", output_forms: "field.output", output_ids: "field.output", output_links: "field.output",
    data_form: "field.dataForm", start_condition: "field.startCondition", end_condition: "field.endCondition",
  };
  const changedLabels = [...new Set(changedKeys.map((k) =>
    k === "cost_krw" || k === "cost_usd"
      ? t("field.costRun") // 통화 토글 한 행 계약 — 전환 시 두 필드가 함께 바뀌므로 하나로 접음
      : (PARAM_FIELDS as readonly string[]).includes(k)
        ? t(PARAM_LABEL_KEY[k as ParamField])
        : t(CHANGED_LABEL_KEY[k]),
  ))].join(", ");
  // I/O & Conditions 접힘 헤더의 채워진 개수 — 버퍼(form) 기준. SP는 링크 맵 상속값 기준(#11)
  const filledDetailCount =
    nodeType === "subprocess"
      ? [sp?.input, sp?.output, sp?.start_condition, sp?.end_condition].filter(
          (v) => (v ?? "") !== "",
        ).length
      : [form.input, form.output, form.data_form, form.start_condition, form.end_condition]
          .filter((v) => v !== "").length;
  // 상속 파라미터 표시값 — subprocess의 읽기전용 4행(링크 맵 지정값). 값 없으면 ""(행은 "—")
  const inheritedDisplay = (field: ParamField): string =>
    spParams && isSpParamField(field) ? formatParamValue(field, spParams[field]) : "";
  // 읽기전용 뷰(#13) — 값 있는 것만 나열. SP 파라미터는 상속값 우선(연간/FTE는 자기 값)
  const gmpValue = gmp ?? "";
  const readAttrRows = [
    { key: "assignee", labelKey: "field.assignee" as MessageKey, value: assignee },
    { key: "department", labelKey: "field.department" as MessageKey, value: department },
    { key: "system", labelKey: "field.system" as MessageKey, value: system },
    { key: "url", labelKey: "field.url" as MessageKey, value: url ? urlLabel || url : "" },
  ].filter((row) => row.value !== "");
  const readParamRows = PARAM_FIELDS.map((field) => ({
    field,
    value:
      nodeType === "subprocess"
        ? inheritedDisplay(field) || formatParamValue(field, form[field] ?? "")
        : formatParamValue(field, form[field] ?? ""),
  })).filter((row) => row.value !== "");

  const changeDept = (dept: string) => {
    if (dept === form.department) return; // 같은 부서 재선택 — SearchSelect는 onChange를 항상 발화하므로 no-op(담당자 무단 초기화 방지)
    if (assignees.length > 0) {
      setPendingDept(dept);
    } else {
      setForm((f) => ({ ...f, department: dept, assignee: "" }));
    }
  };

  const isDirty =
    form.label !== title ||
    form.description !== description ||
    form.color !== color ||
    form.assignee !== assignee ||
    form.department !== department ||
    form.system !== system ||
    form.duration !== duration ||
    form.touch_time !== touch_time ||
    form.input !== input ||
    form.output !== output ||
    form.data_form !== data_form ||
    form.start_condition !== start_condition ||
    form.end_condition !== end_condition ||
    form.cost_krw !== cost_krw ||
    form.cost_usd !== cost_usd ||
    form.headcount !== headcount ||
    form.annual_count !== annual_count ||
    form.fte !== fte ||
    form.url !== url ||
    form.urlLabel !== urlLabel;
  const requestNavigate = (id: string) => {
    if (isDirty) {
      setPendingNav(id);
    } else {
      onNavigate(id);
    }
  };
  const navSaveAndGo = () => {
    onPatch({
      description: form.description,
      color: form.color,
      assignee: form.assignee,
      department: form.department,
      system: form.system,
      duration: form.duration,
      touch_time: form.touch_time,
      input: form.input,
      output: form.output,
      input_forms: form.input_forms,
      output_forms: form.output_forms,
      output_ids: form.output_ids,
      input_links: form.input_links,
      output_links: form.output_links,
      input_flags: form.input_flags,
      data_form: form.data_form,
      start_condition: form.start_condition,
      end_condition: form.end_condition,
      cost_krw: form.cost_krw,
      cost_usd: form.cost_usd,
      headcount: form.headcount,
      annual_count: form.annual_count,
      fte: form.fte,
      url: form.url,
      urlLabel: form.urlLabel,
    });
    onCommitLabel?.(form.label);
    const id = pendingNav;
    setPendingNav(null);
    if (id) onNavigate(id);
  };
  const navDiscardAndGo = () => {
    const id = pendingNav;
    setPendingNav(null);
    if (id) onNavigate(id);
  };

  useEffect(() => {
    if (readOnly) {
      return;
    }
    let active = true;
    void getEligibleAssignees(versionId)
      .then((e) => {
        if (active) setEligible(e);
      })
      .catch(() => {
        /* 실패 시 현재 값만 유지 노출 */
      });
    return () => {
      active = false;
    };
  }, [versionId, readOnly]);

  // 해당 노드 코멘트 로드(진입 1회) — 실패해도 모달은 동작(빈 목록)
  useEffect(() => {
    let alive = true;
    void listComments(versionId)
      .then((all) => {
        if (alive) {
          setComments(all.filter((comment) => comment.node_id === nodeId));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [versionId, nodeId]);

  // Esc=취소(버퍼 폐기)·⌘S=저장. ⌘S는 브라우저 저장 대화상자를 막는다.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 확인 오버레이가 떠 있으면 그것부터 닫는다(모달 유지).
        if (pendingDept) setPendingDept(null);
        else if (pendingNav) setPendingNav(null);
        else onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!pendingNav && !pendingDept) handleSave();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleSave, onClose, pendingDept, pendingNav]);

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createComment(versionId, nodeId, body);
      setComments((current) => [...current, created]);
      setDraft("");
      setAdding(false);
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop
      className="absolute inset-0 z-[1200] flex items-start justify-center pt-[7vh] backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="relative flex max-h-[80%] w-[420px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          {/* 말줄임 대신 줄바꿈 — 긴 노드 제목(읽기전용 헤더)도 전문 표시 (F7) */}
          <span className="flex min-w-0 flex-1 items-center gap-2 break-keep text-body-strong text-ink">
            <SquarePen size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            {readOnly ? title : t("editor.nodeEdit")}
          </span>
          <button
            type="button"
            title={t("summary.close")}
            aria-label={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* min-h-0 — flex 자식의 min-height:auto(=min-content)가 축소를 막아 overflow-y-auto가 죽는 것 방지.
            죽으면 카드의 overflow-hidden이 아래를 잘라 선행/후행 내비까지 닿을 수 없다. 스크롤바는 숨기고 스크롤만 남긴다. */}
        <div
          data-id="node-summary-body"
          className="scrollbar-hidden flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-caption text-ink-secondary"
        >
          {readOnly ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-4">
                <span><span className="text-fine text-ink-tertiary">{t("summary.type")}:</span> {typeLabel}</span>
                {groupLabel && (
                  <span><span className="text-fine text-ink-tertiary">{t("summary.group")}:</span> {groupLabel}</span>
                )}
              </div>
              {/* 설명 — 읽기전용에서도 표시(있을 때만). subprocess는 링크맵 베이스+추가분 합성(인스펙터와 동일). */}
              {(() => {
                const mergedDesc =
                  nodeType === "subprocess"
                    ? mergeSubprocessDescription(inheritedDescription, description)
                    : description.trim();
                return mergedDesc !== "" ? (
                  <div
                    data-id="summary-desc-readonly"
                    className="whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-tertiary"
                  >
                    {mergedDesc}
                  </div>
                ) : null;
              })()}
              {/* Attributes 읽기(#13) — 값 있는 행만, GMP는 배지 */}
              {(readAttrRows.length > 0 || gmpValue !== "") && (
                <div data-id="summary-read-attrs">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("editor.bpmAttrs")}</p>
                  <div className="ml-2 border-l border-divider pl-2">
                    {readAttrRows.map((row) => (
                      <div key={row.key} className="flex items-center justify-between gap-2 py-0.5 text-caption">
                        <span className="shrink-0 text-ink-secondary">{t(row.labelKey)}</span>
                        <span className="min-w-0 truncate text-right text-ink" title={row.value}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    {gmpValue !== "" && (
                      <div className="flex items-center justify-between gap-2 py-0.5 text-caption">
                        <span className="shrink-0 text-ink-secondary">{t("field.gmp")}</span>
                        <span className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(gmpValue)}>
                          {formatGmp(gmpValue)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Parameters 읽기 — 포맷 표시값(1h30m 등), SP는 링크 맵 상속값 우선 */}
              {readParamRows.length > 0 && (
                <div data-id="summary-read-params">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("inspector.parameters")}</p>
                  <div className="ml-2 border-l border-divider pl-2">
                    {readParamRows.map(({ field, value }) => (
                      <div key={field} className="flex items-center justify-between gap-2 py-0.5 text-caption">
                        <span className="shrink-0 text-ink-secondary">{t(PARAM_LABEL_KEY[field])}</span>
                        <span className="text-right text-ink">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* I/O & Conditions 읽기 — 필 표시(#12)와 통일, SP는 링크 맵 상속(#11) */}
              {(showAttributes || nodeType === "subprocess") && filledDetailCount > 0 && (
                <div data-id="summary-read-details">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("inspector.details")}</p>
                  <div className="ml-2 border-l border-divider pl-2">
                    <NodeDetailsFields
                      idPrefix="modal-read-detail"
                      nodeKey={nodeId}
                      input={nodeType === "subprocess" ? sp?.input ?? "" : input}
                      output={nodeType === "subprocess" ? sp?.output ?? "" : output}
                      inputForms={nodeType === "subprocess" ? sp?.input_forms ?? "" : input_forms}
                      outputForms={nodeType === "subprocess" ? sp?.output_forms ?? "" : output_forms}
                      outputIds={nodeType === "subprocess" ? undefined : output_ids}
                      inputLinks={nodeType === "subprocess" ? undefined : input_links}
                      outputLinks={nodeType === "subprocess" ? undefined : output_links}
                      inputFlags={nodeType === "subprocess" ? undefined : input_flags}
                      dataForm={nodeType === "subprocess" ? "" : data_form}
                      startCondition={nodeType === "subprocess" ? sp?.start_condition ?? "" : start_condition}
                      endCondition={nodeType === "subprocess" ? sp?.end_condition ?? "" : end_condition}
                      readOnly
                      onPatch={() => {}}
                    />
                    {nodeType === "subprocess" && (
                      <p className="mt-1 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 제목 — subprocess는 링크된 맵 이름 고정이라 편집 차단 (F5) */}
              <div>
                <label className="mb-1 block text-fine text-ink-tertiary">{t("field.title")}</label>
                <textarea
                  className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink disabled:bg-surface-alt disabled:text-ink-tertiary"
                  value={form.label}
                  rows={Math.min(5, form.label.split("\n").length)}
                  aria-label={t("field.title")}
                  disabled={nodeType === "subprocess"}
                  onChange={(event) => setForm((f) => ({ ...f, label: event.target.value }))}
                  onKeyDown={(event) => {
                    // Enter=포커스 해제, Alt/Shift+Enter=줄바꿈 — 캔버스/인스펙터 이름 편집과 동일 규칙
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!event.altKey && !event.shiftKey) {
                      event.currentTarget.blur();
                      return;
                    }
                    const el = event.currentTarget;
                    const caret = el.selectionStart + 1;
                    const next = `${el.value.slice(0, el.selectionStart)}\n${el.value.slice(el.selectionEnd)}`;
                    setForm((f) => ({ ...f, label: next }));
                    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                  }}
                />
                <NewlineHint />
              </div>
              {/* 설명 — 노드 부연(NodeData.description). subprocess는 링크맵 sp_description을 읽기전용
                  베이스로 위에 표시하고, textarea는 이 맵의 추가분만 편집(표시는 베이스+줄바꿈+추가분 합성). */}
              <div>
                <label className="mb-1 block text-fine text-ink-tertiary">{t("field.description")}</label>
                {(inheritedDescription ?? "").trim() !== "" && (
                  <div
                    data-id="summary-desc-inherited"
                    className="mb-1 whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-tertiary"
                  >
                    {(inheritedDescription ?? "").trim()}
                  </div>
                )}
                <textarea
                  ref={descriptionRef}
                  data-id="summary-description"
                  className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink"
                  rows={2}
                  value={form.description}
                  aria-label={t("field.description")}
                  placeholder={
                    (inheritedDescription ?? "").trim() !== "" ? t("subprocess.descAppend") : undefined
                  }
                  onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                />
              </div>
              {/* 속성 — 라벨 좌·필드 우측정렬·세로중앙·행 구분선. start/end/subprocess는 유형/색만(BPM 숨김) */}
              <div className="flex flex-col divide-y divide-divider">
                {/* 유형 — 생성 시 고정, 변경 불가(읽기 전용 표시) */}
                <div className="flex min-h-[34px] items-center gap-3 py-1.5">
                  <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("field.type")}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-caption text-ink-secondary">{typeLabel}</span>
                </div>
                {/* 색 — 팔레트 우측 노출, "더 보기" 시 헥사 입력 인라인. subprocess는 단일색 고정이라 숨김 (spec 2026-07-06 §9) */}
                {nodeType !== "subprocess" && (
                <div className="flex items-center gap-3 py-1.5">
                  <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("field.color")}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
                    {colorPresets.map((preset) => (
                      <button
                        key={preset || "default"}
                        type="button"
                        title={preset || "default"}
                        aria-label={preset || "default"}
                        onClick={() => setForm((f) => ({ ...f, color: preset }))}
                        className={`h-5 w-5 rounded-full border ${
                          form.color === preset
                            ? "border-transparent ring-2 ring-accent"
                            : "border-hairline hover:ring-2 hover:ring-accent-tint-border"
                        }`}
                        style={{ background: preset || "var(--color-surface-alt)" }}
                      />
                    ))}
                    <button
                      type="button"
                      aria-expanded={colorMoreOpen}
                      className={`ml-0.5 shrink-0 rounded-xs px-1.5 py-0.5 text-fine ${
                        colorMoreOpen
                          ? "bg-accent-tint text-accent"
                          : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                      }`}
                      onClick={() => setColorMoreOpen((v) => !v)}
                    >
                      {t("editor.moreColors")}
                    </button>
                    {colorMoreOpen && (
                      <input
                        type="text"
                        value={form.color}
                        onChange={(event) => setForm((f) => ({ ...f, color: event.target.value }))}
                        placeholder="#RRGGBB"
                        maxLength={7}
                        spellCheck={false}
                        aria-label={t("field.color")}
                        className="w-24 rounded-sm border border-hairline px-2 py-0.5 text-right text-fine text-ink"
                      />
                    )}
                  </div>
                </div>
                )}
                {/* BPM 속성 — process·decision만 표시. 아코디언(기본 접힘, 인스펙터와 키 공유) */}
                {showAttributes && (
                  <div className="py-1.5" data-id="summary-attrs">
                    <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-id="summary-attrs-toggle"
                      aria-expanded={!attrsCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink-tertiary"
                      onClick={() => {
                        const next = !attrsCollapsed;
                        setAttrsCollapsed(next);
                        writeAttrsCollapsed(next);
                      }}
                    >
                      <ChevronRight
                        size={12}
                        strokeWidth={1.5}
                        className={`transition-transform duration-150 ${attrsCollapsed ? "" : "rotate-90"}`}
                      />
                      {t("editor.bpmAttrs")}
                      {filledAttrCount > 0 && (
                        <span className="font-normal">({filledAttrCount})</span>
                      )}
                      {/* 버퍼 변경 점 — 접혀 있어도 저장 전 수정이 있음을 표시 */}
                      {hasChangedIn(ATTRS_KEYS) && <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />}
                    </button>
                    {/* 섹션 일괄 접기/펼치기 — 모달은 공간이 있어 아이콘+라벨 병기, 인스펙터 탭 바
                        버튼과 동일 판정 로직 (사용자 결정 2026-08-20) */}
                    <button
                      type="button"
                      data-id="summary-toggle-all-sections"
                      className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                      onClick={toggleAllSections}
                    >
                      {anySectionOpen ? (
                        <ChevronsDownUp size={13} strokeWidth={1.5} />
                      ) : (
                        <ChevronsUpDown size={13} strokeWidth={1.5} />
                      )}
                      {t(anySectionOpen ? "inspector.collapseAll" : "inspector.expandAll")}
                    </button>
                    </div>
                    {/* 아코디언 높이 전환 — 접힘/펼침을 AutoHeight가 부드럽게 잇는다 (사용자 결정 2026-08-20) */}
                    <AutoHeight className="overflow-hidden">
                    {!attrsCollapsed && (
                    <div className="ml-2 border-l border-divider pl-2">
                    {/* 부서 단일 픽커 — 변경 시 담당자 있으면 확인 오버레이 */}
                    <div className="flex min-h-[34px] items-center gap-3 py-1.5">
                      <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("field.department")}</span>
                      <div className="flex min-w-0 flex-1 justify-end">
                        <SearchSelect
                          fitContent
                          value={form.department}
                          options={buildDepartmentOptions(
                            eligible?.departments ?? [],
                            users,
                            lang,
                            eligible?.dept_infos,
                          )}
                          emptyLabel={t("summary.none")}
                          placeholder={t("field.searchPlaceholder")}
                          onChange={changeDept}
                        />
                      </div>
                    </div>
                    {/* 담당자 — 필 우측 정렬 + 맨끝 ＋버튼(플라이아웃 피커) */}
                    <div className="flex items-start gap-3 py-1.5">
                      <span className="mt-1 w-16 shrink-0 text-fine text-ink-tertiary">{t("field.assignee")}</span>
                      <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                          {assignees.map((name) => {
                            const isDrift = drifted.includes(name);
                            return (
                              <span
                                key={name}
                                className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                                  isDrift ? "border-error/40 bg-error/10 text-error" : "border-hairline bg-surface-alt text-ink"
                                }`}
                              >
                                {name}
                                <button
                                  type="button"
                                  aria-label={t("summary.close")}
                                  onClick={() =>
                                    setForm((f) => ({ ...f, assignee: formatAssignees(parseAssignees(f.assignee).filter((n) => n !== name)) }))
                                  }
                                >
                                  <X size={11} strokeWidth={1.5} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                        <SearchSelect
                          addMode
                          value=""
                          options={buildAssigneeOptions(
                            users
                              .filter((u) => form.department === "" || u.department === form.department)
                              .filter((u) => !assignees.includes(u.name)),
                            lang,
                          )}
                          emptyLabel={t("summary.none")}
                          placeholder={t("field.searchPlaceholder")}
                          onChange={(name) => {
                            if (!name) return;
                            const next = addAssignee(form.department, parseAssignees(form.assignee), name, users);
                            setForm((f) => ({ ...f, department: next.department, assignee: formatAssignees(next.assignees) }));
                          }}
                        />
                      </div>
                    </div>
                    {/* 시스템 — 우측 정렬 입력 */}
                    {ATTR_FIELDS.map(({ key, labelKey }) => (
                      <div key={key} className="flex min-h-[34px] items-center gap-3 py-1.5">
                        <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t(labelKey)}</span>
                        <div className="flex min-w-0 flex-1 justify-end">
                          <input
                            className="w-44 rounded-sm border border-hairline px-2 py-1 text-right text-caption focus:border-accent focus:outline-none"
                            value={form[key]}
                            aria-label={t(labelKey)}
                            onChange={(event) => setForm((f) => ({ ...f, [key]: event.target.value }))}
                          />
                        </div>
                      </div>
                    ))}
                    <UrlLabelField
                      key={nodeId}
                      url={form.url}
                      urlLabel={form.urlLabel}
                      readOnly={readOnly}
                      inputWidth="w-44"
                      onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                    />
                    </div>
                    )}
                    </AutoHeight>
                  </div>
                )}
                {/* 회당 파라미터 — 접기 그룹(기본 접힘, 인스펙터와 공유 키). start/end 외 모든 타입에 표시.
                    subprocess는 회당 4필드가 링크 맵 지정값이라 읽기전용 텍스트, 연간 건수·FTE만 입력 (design §3.1) */}
                {editableParams.length > 0 && (
                  <div className="py-1.5">
                    <button
                      type="button"
                      data-id="summary-params-toggle"
                      aria-expanded={!paramsCollapsed}
                      className="flex w-full items-center gap-1 text-fine font-semibold text-ink-tertiary"
                      onClick={() => {
                        const next = !paramsCollapsed;
                        setParamsCollapsed(next);
                        writeParamsCollapsed(next);
                      }}
                    >
                      <ChevronRight
                        size={12}
                        strokeWidth={1.5}
                        className={`transition-transform duration-150 ${paramsCollapsed ? "" : "rotate-90"}`}
                      />
                      {t("inspector.parameters")}
                      {filledParamCount > 0 && (
                        <span className="font-normal text-ink-tertiary">({filledParamCount})</span>
                      )}
                      {hasChangedIn(PARAM_FIELDS) && <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />}
                    </button>
                    <AutoHeight className="overflow-hidden">
                    {!paramsCollapsed && (
                      <div className="ml-2 border-l border-divider pl-2">
                        {/* 비용 2필드는 통화 토글 한 행으로 접음(cost_usd 자리는 스킵) — 배타 계약 (사용자 결정 2026-08-20) */}
                        {PARAM_FIELDS.filter((f) => f !== "cost_usd").map((key) => {
                          const isCostRow = key === "cost_krw";
                          const field = isCostRow ? activeCurrency : key;
                          const RowIcon = PARAM_ICON[field];
                          return (
                          <div key={key} className="flex min-h-[34px] items-center gap-3 py-1">
                            <span className="inline-flex w-20 shrink-0 items-center gap-1 text-fine text-ink-tertiary">
                              <RowIcon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                              {isCostRow ? t("field.costRun") : t(PARAM_LABEL_KEY[key])}
                            </span>
                            {isCostRow && editableParams.includes(field) && (
                              <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-hairline">
                                {(["cost_krw", "cost_usd"] as const).map((currency) => (
                                  <button
                                    key={currency}
                                    type="button"
                                    data-id={`summary-cost-currency-${currency === "cost_krw" ? "krw" : "usd"}`}
                                    aria-pressed={activeCurrency === currency}
                                    className={`px-1.5 py-0.5 text-fine ${
                                      activeCurrency === currency
                                        ? "bg-accent-tint text-accent"
                                        : "text-ink-tertiary hover:bg-surface-alt"
                                    }`}
                                    onClick={() => switchCurrency(currency)}
                                  >
                                    {currency === "cost_krw" ? "₩" : "$"}
                                  </button>
                                ))}
                              </span>
                            )}
                            <div className="flex min-w-0 flex-1 justify-end">
                              {editableParams.includes(field) ? (
                                <ParamInput
                                  key={field}
                                  field={field}
                                  dataId={`summary-param-${field}`}
                                  className="w-44 rounded-sm border border-hairline px-2 py-1 text-right text-caption focus:border-accent focus:outline-none disabled:bg-surface-alt disabled:text-ink-tertiary"
                                  value={form[field]}
                                  ariaLabel={isCostRow ? t("field.costRun") : t(PARAM_LABEL_KEY[field])}
                                  onCommit={(next) => setForm((f) => ({ ...f, [field]: next }))}
                                />
                              ) : (
                                <span
                                  data-id={`summary-param-${field}`}
                                  className="min-w-0 truncate text-right text-caption text-ink"
                                >
                                  {(isCostRow
                                    ? inheritedDisplay("cost_krw") || inheritedDisplay("cost_usd")
                                    : inheritedDisplay(field)) || "-"}
                                </span>
                              )}
                            </div>
                          </div>
                          );
                        })}
                        {costNotice !== null && (
                          <div
                            data-id="summary-cost-clear-notice"
                            className="flex items-center justify-between gap-2 py-0.5 text-fine text-error"
                          >
                            <span className="min-w-0">
                              {t("metrics.clearOnSave", { v: formatParamValue(costNotice.field, costNotice.value) })}
                            </span>
                            <button
                              type="button"
                              data-id="summary-cost-clear-undo"
                              className="shrink-0 rounded-sm px-1.5 py-0.5 text-fine text-accent hover:bg-accent-tint"
                              onClick={undoCurrencySwitch}
                            >
                              {t("metrics.undoSwitch")}
                            </button>
                          </div>
                        )}
                        {nodeType === "subprocess" && (
                          <p className="py-1 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
                        )}
                      </div>
                    )}
                    </AutoHeight>
                  </div>
                )}
                {/* 인터뷰 승격 상세 — IO(개행 복수)+종속 Data form·조건. 버퍼 편집(저장 시 반영), 기본 접힘.
                    SP는 링크 맵 상속 읽기전용 렌더 — 인스펙터 카드와 동기화(#11) */}
                {(showAttributes || nodeType === "subprocess") && (
                  <div className="py-1.5" data-id="summary-details">
                    <button
                      type="button"
                      data-id="summary-details-toggle"
                      aria-expanded={!detailsCollapsed}
                      className="flex w-full items-center gap-1 text-fine font-semibold text-ink-tertiary"
                      onClick={() => {
                        const next = !detailsCollapsed;
                        setDetailsCollapsed(next);
                        writeDetailsCollapsed(next);
                      }}
                    >
                      <ChevronRight
                        size={12}
                        strokeWidth={1.5}
                        className={`transition-transform duration-150 ${detailsCollapsed ? "" : "rotate-90"}`}
                      />
                      {t("inspector.details")}
                      {filledDetailCount > 0 && (
                        <span className="font-normal text-ink-tertiary">({filledDetailCount})</span>
                      )}
                      {hasChangedIn(DETAILS_KEYS) && <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />}
                    </button>
                    <AutoHeight className="overflow-hidden">
                    {!detailsCollapsed && (
                    <div className="ml-2 border-l border-divider pl-2">
                      {nodeType === "subprocess" ? (
                        <>
                          {/* 링크 맵 상속 상세(읽기전용) — 인스펙터 카드와 동기화(#11) */}
                          <NodeDetailsFields
                            idPrefix="modal-detail"
                            nodeKey={nodeId}
                            input={sp?.input ?? ""}
                            output={sp?.output ?? ""}
                            inputForms={sp?.input_forms ?? ""}
                            outputForms={sp?.output_forms ?? ""}
                            dataForm=""
                            startCondition={sp?.start_condition ?? ""}
                            endCondition={sp?.end_condition ?? ""}
                            readOnly
                            onPatch={() => {}}
                          />
                          <p className="mt-1 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
                        </>
                      ) : (
                        <NodeDetailsFields
                          idPrefix="modal-detail"
                          nodeKey={nodeId}
                          inputWidth="w-44"
                          input={form.input}
                          output={form.output}
                          inputForms={form.input_forms}
                          outputForms={form.output_forms}
                          outputIds={form.output_ids}
                          inputLinks={form.input_links}
                          outputLinks={form.output_links}
                          inputFlags={form.input_flags}
                          dataForm={form.data_form}
                          startCondition={form.start_condition}
                          endCondition={form.end_condition}
                          readOnly={readOnly}
                          onPatch={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                        />
                      )}
                    </div>
                    )}
                    </AutoHeight>
                  </div>
                )}
              </div>
              {groupLabel && (
                <span className="text-fine text-ink-tertiary">
                  {t("summary.group")}: {groupLabel}
                </span>
              )}
            </div>
          )}

          {/* subprocess 연결 버전(최신 추종 토글·버전 고정) — 인스펙터와 동일 컴포넌트를 슬롯으로 주입(패리티) */}
          {versionPickerSlot}

          {hasChildren && (
            <div>
              <div className="text-fine text-ink-tertiary">{t("summary.subprocess")}</div>
              {/* 미리보기 우상단 — 호버 시에만 열기 버튼 노출 */}
              <div className="group relative mt-1 h-32 overflow-hidden rounded-sm border border-hairline">
                <ScopePreview fullGraph={fullGraph} scopeParentId={nodeId} interactive />
                {onOpenChild && (
                  <button
                    type="button"
                    title={t("summary.openSubprocess")}
                    aria-label={t("summary.openSubprocess")}
                    className="absolute right-1 top-1 rounded-xs border border-hairline bg-surface p-0.5 text-accent opacity-0 shadow-sm transition-opacity hover:bg-surface-alt group-hover:opacity-100"
                    onClick={onOpenChild}
                  >
                    <CornerDownRight size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <span className="text-fine text-ink-tertiary">{t("summary.comments")}</span>
              {!readOnly && !adding && (
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setAdding(true)}
                >
                  {t("summary.addComment")}
                </button>
              )}
            </div>
            {comments.length === 0 && <div className="mt-1 text-ink-tertiary">{t("summary.none")}</div>}
            <ul className="mt-1 flex flex-col gap-1">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-sm border border-transparent bg-surface-alt px-2 py-1 transition-colors hover:border-accent-tint-border hover:bg-accent-tint"
                >
                  <span className="text-fine text-ink-tertiary">{comment.author}</span>
                  <div className="text-ink">{comment.body}</div>
                </li>
              ))}
            </ul>
            {!readOnly && adding && (
              <div className="mt-1 flex flex-col gap-1">
                <textarea
                  className="rounded-sm border border-hairline px-2 py-1 text-caption"
                  rows={2}
                  placeholder={t("summary.commentPlaceholder")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-sm border border-accent bg-accent-tint px-2 py-1 text-fine text-accent disabled:opacity-50"
                    disabled={submitting || !draft.trim()}
                    onClick={() => void submitComment()}
                  >
                    {t("summary.submit")}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary"
                    onClick={() => { setAdding(false); setDraft(""); setError(null); }}
                  >
                    {t("summary.cancel")}
                  </button>
                </div>
                {error && <span className="text-fine text-error">{error}</span>}
              </div>
            )}
          </div>
        </div>

        {/* 선행/후행(이전/이후) — 스크롤 바디 밖 고정 밴드. 바디 안에 두면 flex-shrink가
            내부 스크롤 칩 영역의 min-height를 0까지 뭉개 (모달이 높든 낮든) 통째로 사라진다.
            shrink-0 밴드로 분리해 항상 보이게. 칩 영역은 자체 max-h+내부 스크롤. 클릭=그 노드 편집(변경 있으면 확인) */}
        <div className="shrink-0 border-t border-hairline px-4 py-3">
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-hairline">
            {/* 선행(좌) — 좌측 가장자리 쉐브론(위)+라벨(아래) */}
            <div className="group/prev flex min-w-0 items-stretch border-r border-hairline">
              <div className="flex w-12 shrink-0 flex-col items-center justify-between py-1.5 text-ink-tertiary">
                <ChevronLeft size={14} strokeWidth={1.5} />
                <span className="whitespace-nowrap text-[9px] leading-none opacity-0 transition-opacity group-hover/prev:opacity-100">
                  {t("summary.prev")}
                </span>
              </div>
              <div className="scrollbar-hidden flex max-h-[104px] min-h-[26px] min-w-0 flex-1 flex-col gap-1 overflow-y-auto py-1.5 pr-1.5">
                {predecessors.length ? (
                  predecessors.map((n) => (
                    <NavChip key={n.id} node={n} onClick={() => requestNavigate(n.id)} />
                  ))
                ) : (
                  <span className="border border-transparent px-1.5 py-0.5 text-fine text-ink-tertiary">
                    {t("summary.none")}
                  </span>
                )}
              </div>
            </div>
            {/* 후행(우) — 우측 가장자리 쉐브론(위)+라벨(아래) */}
            <div className="group/next flex min-w-0 items-stretch">
              <div className="scrollbar-hidden flex max-h-[104px] min-h-[26px] min-w-0 flex-1 flex-col gap-1 overflow-y-auto py-1.5 pl-1.5">
                {successors.length ? (
                  successors.map((n) => (
                    <NavChip key={n.id} node={n} onClick={() => requestNavigate(n.id)} />
                  ))
                ) : (
                  <span className="border border-transparent px-1.5 py-0.5 text-fine text-ink-tertiary">
                    {t("summary.none")}
                  </span>
                )}
              </div>
              <div className="flex w-12 shrink-0 flex-col items-center justify-between py-1.5 text-ink-tertiary">
                <ChevronRight size={14} strokeWidth={1.5} />
                <span className="whitespace-nowrap text-[9px] leading-none opacity-0 transition-opacity group-hover/next:opacity-100">
                  {t("summary.next")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 — 버퍼 편집: Esc=취소 / ⌘S=저장 힌트 + 취소·저장 버튼. readOnly면 닫기만. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-4 py-2">
          {readOnly ? (
            <>
              <span />
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={onClose}
              >
                {t("summary.close")}
              </button>
            </>
          ) : (
            <>
              <span className="flex min-w-0 flex-col gap-0.5 text-fine text-ink-tertiary">
                {/* 저장 전 변경 필드 목록 — 버퍼 내용 노출 (사용자 결정 2026-08-20) */}
                {changedKeys.length > 0 && (
                  <span
                    data-id="summary-dirty-fields"
                    className="flex min-w-0 items-center gap-1 text-accent"
                    title={changedLabels}
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span className="min-w-0 truncate">{t("summary.unsavedFields", { fields: changedLabels })}</span>
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5">Esc</kbd>
                    {t("summary.cancel")}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5">⌘S</kbd>
                    {t("editor.save")}
                  </span>
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={onClose}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                  onClick={handleSave}
                >
                  {t("editor.save")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* 저장하지 않은 변경 확인 — 선후행 이동 시 버퍼에 변경이 있으면 (저장/저장안함/취소) */}
        {pendingNav && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-4"
            style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
            onClick={() => setPendingNav(null)}
          >
            <div
              className="w-full max-w-[300px] rounded-sm border border-hairline bg-surface p-4 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-body-strong text-ink">
                <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 text-error" />
                {t("summary.unsavedTitle")}
              </div>
              <p className="mt-1.5 text-caption text-ink-secondary">{t("summary.unsavedBody")}</p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setPendingNav(null)}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={navDiscardAndGo}
                >
                  {t("summary.discardAndGo")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2.5 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                  onClick={navSaveAndGo}
                >
                  {t("summary.saveAndGo")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 부서 변경 확인 — 담당자 있을 때 부서 변경 시 (확인/취소) */}
        {pendingDept !== null && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-4"
            style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
            onClick={() => setPendingDept(null)}
          >
            <div
              className="w-full max-w-[300px] rounded-sm border border-hairline bg-surface p-4 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-body-strong text-ink">
                <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 text-error" />
                {t("assignee.deptChangeTitle")}
              </div>
              <p className="mt-1.5 text-caption text-ink-secondary">{t("assignee.deptChangeBody")}</p>
              <div className="mt-3 flex justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setPendingDept(null)}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2.5 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                  onClick={() => {
                    setForm((f) => ({ ...f, department: pendingDept, assignee: "" }));
                    setPendingDept(null);
                  }}
                >
                  {t("editor.save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
