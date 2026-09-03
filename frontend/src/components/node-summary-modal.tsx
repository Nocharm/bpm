"use client";

// 노드 더블클릭 편집 모달 — 제목·설명 + 필드 타일(2열, 클릭 위치 팝오버) + 전/후 단계·하위 프로세스
// 프리뷰·코멘트. 타일 디자인은 SP 지정 모달과 같다(사용자 결정 2026-09-03): 부서·담당자는 두 열을
// 가로지르는 행 타일, 색·시스템·링크·지표 7(비용은 단위 탭 한 타일)·입출력/조건은 2열 타일. 팝오버 초안은
// Enter/저장으로 폼 버퍼에 반영되고, 폼 버퍼는 하단 저장(⌘S)으로 노드에 반영된다.
// readOnly면 값 있는 타일만 정적으로 — 목록을 열어야 보이는 입출력만 클릭해 읽기 전용 팝오버로 본다.
// subprocess는 링크 맵 상속값(속성·회당 4지표·입출력/조건)을 읽기 타일로, 연간 건수·FTE만 편집한다.

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
  FileType,
  Flag,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Monitor,
  Palette,
  Play,
  Plus,
  ShieldCheck,
  Square,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { AutoHeight } from "@/components/auto-height";
import { CostUnitTabs, CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { MapNotesSection } from "@/components/maps/map-notes-section";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { MultiValueInput, type MultiValueInputHandle } from "@/components/multi-value-input";
import { NewlineHint } from "@/components/newline-hint";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { DeptAssigneeTiles } from "@/components/permissions/attribute-tiles";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { buildPopoverActionLabels } from "@/components/popover-action-bar";
import { ScopePreview } from "@/components/scope-preview";
import { createComment, listComments, type CommentItem, type VersionGraph } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatAssignees, parseAssignees } from "@/lib/assignee";
import { NODE_TYPE_OPTIONS, type ProcessNodeType } from "@/lib/canvas";
import { formatThousands } from "@/lib/duration";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
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
import { isHttpUrl } from "@/lib/url";

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

// 선후행 칩·유형 타일의 노드 타입별 아이콘 (캔버스 노드타입 아이콘과 동일 매핑)
const NAV_TYPE_ICONS: Record<string, LucideIcon> = {
  process: Square,
  decision: Diamond,
  start: Circle,
  end: CircleDot,
  subprocess: Boxes,
};

// 선후행 노드 참조 — 라벨·타입·색만 싣는 간소 카드용
interface NavNodeRef {
  id: string;
  label: string;
  nodeType: string;
  color?: string;
}

// 선행/후행 사이드 독 — 모달 밖 캔버스 좌우에 세로 정렬로 떠 있는 간소 카드(색 점·라벨·타입).
// 호버 시 살짝 커지며 모달 쪽으로 들어온다(사용자 요청 2026-09-03). 클릭=그 노드 편집(변경 있으면 확인).
function NavDock({
  side,
  title,
  nodes,
  typeLabelOf,
  onPick,
}: {
  side: "left" | "right";
  title: string;
  nodes: NavNodeRef[];
  typeLabelOf: (nodeType: string) => string;
  onPick: (id: string) => void;
}) {
  if (nodes.length === 0) return null;
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      data-id={`summary-dock-${side === "left" ? "prev" : "next"}`}
      // 폭은 백드롭 반폭 − 모달 반폭(256) − 가장자리 16 − 간격 8 을 넘지 않게 — 좁은 캔버스에서도 모달과 안 겹친다
      className={`absolute top-1/2 flex max-h-[72%] w-[min(11rem,calc(50%-17.5rem))] -translate-y-1/2 flex-col gap-1.5 ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <div className={`flex items-center gap-1 px-1 text-fine text-ink-tertiary ${side === "right" ? "justify-end" : ""}`}>
        {side === "left" && <Chevron size={12} strokeWidth={1.5} />}
        {title}
        <span className="text-ink-muted">({nodes.length})</span>
        {side === "right" && <Chevron size={12} strokeWidth={1.5} />}
      </div>
      <div className="scrollbar-hidden flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 py-1">
        {nodes.map((node) => {
          const Icon = NAV_TYPE_ICONS[node.nodeType] ?? Square;
          return (
            <button
              key={node.id}
              type="button"
              data-id={`summary-dock-card-${node.id}`}
              title={node.label}
              onClick={() => onPick(node.id)}
              // 호버: 5% 확대 + 모달 쪽으로 8px — translate/scale 속성 트랜지션(transform 미사용, Tailwind v4)
              className={`animate-item-in flex w-full items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-2 text-left shadow-md transition-[translate,scale,box-shadow,border-color] duration-350 ease-spring hover:scale-105 hover:border-accent-tint-border hover:shadow-lg ${
                side === "left" ? "hover:translate-x-2" : "hover:-translate-x-2"
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-hairline"
                style={{ background: node.color || "var(--color-surface-alt)" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption text-ink">{node.label}</span>
                <span className="flex items-center gap-1 text-fine text-ink-tertiary">
                  <Icon size={11} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{typeLabelOf(node.nodeType)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 타일 필드 — 부서·담당자는 DeptAssigneeTiles가, 유형·GMP는 정적 타일이 담당
type TileField =
  | "color"
  | "system"
  | "url"
  | "duration"
  | "touch_time"
  | "cost"
  | "headcount"
  | "annual_count"
  | "fte"
  | "input"
  | "output"
  | "data_form"
  | "start_condition"
  | "end_condition";
type ParamTile = "duration" | "touch_time" | "cost" | "headcount" | "annual_count" | "fte";
const PARAM_TILES: readonly ParamTile[] = ["duration", "touch_time", "cost", "headcount", "annual_count", "fte"];
const TILE_ICON: Record<Exclude<TileField, ParamTile>, LucideIcon> = {
  color: Palette,
  system: Monitor,
  url: LinkIcon,
  input: LogIn,
  output: LogOut,
  data_form: FileType,
  start_condition: Play,
  end_condition: Flag,
};
const HINT_KEY: Record<TileField, MessageKey> = {
  color: "sp.tile.hint.color",
  system: "sp.tile.hint.system",
  url: "sp.tile.hint.url",
  duration: "sp.tile.hint.duration",
  touch_time: "sp.tile.hint.touch_time",
  cost: "sp.tile.hint.cost",
  headcount: "sp.tile.hint.headcount",
  annual_count: "sp.tile.hint.annual_count",
  fte: "sp.tile.hint.fte",
  input: "sp.tile.hint.input",
  output: "sp.tile.hint.output",
  data_form: "sp.tile.hint.data_form",
  start_condition: "sp.tile.hint.start_condition",
  end_condition: "sp.tile.hint.end_condition",
};

interface ActiveTile {
  field: TileField;
  at: { x: number; y: number };
  // 팝오버 로컬 초안 — 확정 시에만 폼 버퍼에 반영, Esc면 폐기
  value: string;
  extra: string; // url 라벨 / IO 폼 join
  links: string; // IO 미러 링크 열
  flags: string; // 인풋 필수/선택 열
  ids: string; // 아웃풋 원본 id 열
  unit: CostUnit; // 비용 타일의 통화 탭
  readOnly: boolean; // 열람 전용(입출력 목록 보기)
}

const INPUT_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

const countLines = (joined: string): number => joined.split("\n").filter((line) => line.trim() !== "").length;
const costUnitOf = (form: { cost_krw: string; cost_usd: string }): CostUnit =>
  form.cost_usd !== "" ? "cost_usd" : "cost_krw";

interface NodeSummaryModalProps {
  versionId: number;
  nodeId: string;
  title: string;
  typeLabel: string;
  // 원시 노드 타입 — subprocess 색 UI 숨김 게이트 (typeLabel은 번역 문자열이라 판별 불가)
  nodeType: ProcessNodeType;
  groupLabel: string | null;
  predecessors: NavNodeRef[];
  successors: NavNodeRef[];
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
  // subprocess 상속 상세(링크 맵 sp_* 속성·IO/조건·참고치) — 읽기전용 표시(#11). 그 외 타입은 null
  sp?: {
    department?: string | null;
    assignee?: string | null;
    system?: string | null;
    url?: string | null;
    url_label?: string | null;
    annual_count?: string | null;
    fte?: string | null;
    input?: string | null;
    output?: string | null;
    input_forms?: string | null;
    output_forms?: string | null;
    start_condition?: string | null;
    end_condition?: string | null;
  } | null;
  // 표시용 GMP 분류(SP는 링크 맵 상속값을 호출부가 해석) — 읽기전용 배지(#13)
  gmp?: string;
  // subprocess 설명 베이스(링크 맵 설명, 읽기전용) — 이 맵의 추가분(description)과 분리 표시
  inheritedDescription?: string | null;
  // subprocess 링크맵 id — 링크맵 노트(예외/VOC) 섹션 소스. null이면 섹션 없음 (2026-08-31)
  linkedMapId?: number | null;
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
  linkedMapId = null,
  versionPickerSlot,
  showAttributes,
  onPatch,
  initialFocus,
  onCommitLabel,
  onNavigate,
  onClose,
  onOpenChild,
}: NodeSummaryModalProps) {
  const { t } = useI18n();
  const isSp = nodeType === "subprocess";
  const labels = buildPopoverActionLabels(t);
  // 독 카드의 타입 표기 — 캔버스 노드 타입 옵션과 같은 번역 키
  const typeLabelOf = (type: string): string => {
    const key = NODE_TYPE_OPTIONS.find((option) => option.value === type)?.labelKey;
    return key ? t(key) : type;
  };
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
  // 섹션 접기 — 인스펙터·SP 지정 모달과 공유 키(localStorage 퍼시스트)
  const [paramsCollapsed, setParamsCollapsed] = useState(readParamsCollapsed);
  const [detailsCollapsed, setDetailsCollapsed] = useState(readDetailsCollapsed);
  const [attrsCollapsed, setAttrsCollapsed] = useState(readAttrsCollapsed);
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
  // 편집 버퍼 — 저장 눌러야 노드에 반영, 취소/Esc/바깥클릭은 폐기(버퍼 편집). 노드 초기값에서 시작.
  const initialForm = {
    label: title, description, color, assignee, department, system, duration,
    touch_time, cost_krw, cost_usd, headcount, annual_count, fte, url, urlLabel,
    input, output, input_forms, output_forms, output_ids, input_links, output_links, input_flags,
    data_form, start_condition, end_condition,
  };
  type Form = typeof initialForm;
  const [form, setForm] = useState<Form>(initialForm);
  const [active, setActive] = useState<ActiveTile | null>(null);
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  // 노드가 바뀌면(선후행 내비 등) 버퍼를 새 노드 값으로 리셋 — 렌더 중 상태조정(effect 아님).
  if (nodeId !== prevNodeId) {
    setPrevNodeId(nodeId);
    setForm(initialForm);
    setActive(null);
  }
  // IO 플라이아웃 편집기 핸들 — 푸터 '+ Add'가 행을 추가한다
  const ioRef = useRef<MultiValueInputHandle | null>(null);

  const buildPatch = (f: Form): NodeEditPatch => ({
    description: f.description,
    color: f.color,
    assignee: f.assignee,
    department: f.department,
    system: f.system,
    duration: f.duration,
    touch_time: f.touch_time,
    input: f.input,
    output: f.output,
    input_forms: f.input_forms,
    output_forms: f.output_forms,
    output_ids: f.output_ids,
    input_links: f.input_links,
    output_links: f.output_links,
    input_flags: f.input_flags,
    data_form: f.data_form,
    start_condition: f.start_condition,
    end_condition: f.end_condition,
    cost_krw: f.cost_krw,
    cost_usd: f.cost_usd,
    headcount: f.headcount,
    annual_count: f.annual_count,
    fte: f.fte,
    url: f.url,
    urlLabel: f.urlLabel,
  });
  // 저장 — 버퍼를 노드에 반영(라벨은 onCommitLabel로 중복 고유화) 후 닫기.
  const handleSave = () => {
    onPatch(buildPatch(form));
    onCommitLabel?.(form.label);
    onClose();
  };

  // 선후행 내비 — 버퍼에 변경이 있으면 확인(저장/저장안함/취소), 없으면 바로 이동.
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  // 노드 타입별 편집 가능 파라미터 — subprocess는 회당 4필드가 링크 맵 지정값이라 제외 (design §3.1)
  const editableParams = getEditableParamFields(nodeType);
  const isEditableParam = (field: ParamField) => (editableParams as readonly string[]).includes(field);
  const changedKeys = (Object.keys(initialForm) as (keyof Form)[]).filter((k) => form[k] !== initialForm[k]);
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
  const isDirty = changedKeys.length > 0;
  const requestNavigate = (id: string) => {
    if (isDirty) {
      setPendingNav(id);
    } else {
      onNavigate(id);
    }
  };
  const navSaveAndGo = () => {
    onPatch(buildPatch(form));
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

  // Esc=취소(버퍼 폐기)·⌘S=저장. ⌘S는 브라우저 저장 대화상자를 막는다. 타일 팝오버가 열려 있으면
  // 팝오버가 Esc를 먼저 소비하고(전파 차단), ⌘S는 팝오버 초안만 반영한다.
  // 최신 상태는 effect event로 읽는다 — 리스너 재구독 없이 (react-ts-patterns §7)
  const handleWindowKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (pendingNav) setPendingNav(null);
      else onClose();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (pendingNav) return;
      if (active) {
        commitTile();
        return;
      }
      handleSave();
    }
  });
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => handleWindowKey(event);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

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

  // ── 타일 표시값 ────────────────────────────────────────────────────────────
  // 상속 파라미터 표시값 — subprocess의 읽기전용(링크 맵 지정값). 값 없으면 ""
  const inheritedDisplay = (field: ParamField): string =>
    spParams && isSpParamField(field) ? formatParamValue(field, spParams[field]) : "";
  const inheritedCostUnit: CostUnit = spParams?.cost_usd ? "cost_usd" : "cost_krw";
  const tileValue = (field: TileField): string => {
    switch (field) {
      case "color":
        return form.color;
      case "duration":
      case "touch_time":
      case "headcount":
        return isSp ? inheritedDisplay(field) : formatParamValue(field, form[field]);
      case "cost":
        return isSp
          ? formatThousands(spParams?.[inheritedCostUnit] ?? "")
          : formatThousands(form[costUnitOf(form)]);
      case "annual_count":
      case "fte":
      case "system":
      case "data_form":
      case "start_condition":
      case "end_condition":
        return form[field];
      case "url":
        return form.url.trim() ? form.urlLabel.trim() || form.url.trim() : "";
      case "input":
      case "output": {
        const n = countLines(form[field]);
        return n > 0 ? t("sp.tile.items", { n }) : "";
      }
    }
  };
  const tileLabel = (field: TileField): string => {
    switch (field) {
      case "color": return t("field.color");
      case "system": return t("field.system");
      case "url": return t("field.url");
      case "cost": return t("field.costRun");
      case "input": return t("field.input");
      case "output": return t("field.output");
      case "data_form": return t("field.dataForm");
      case "start_condition": return t("field.startCondition");
      case "end_condition": return t("field.endCondition");
      default: return t(PARAM_LABEL_KEY[field]);
    }
  };
  const tileIcon = (field: TileField): LucideIcon => {
    if (field === "cost") return PARAM_ICON[isSp ? inheritedCostUnit : costUnitOf(form)];
    if ((PARAM_TILES as readonly string[]).includes(field)) return PARAM_ICON[field as ParamField];
    return TILE_ICON[field as Exclude<TileField, ParamTile>];
  };
  const colorSwatch = (value: string) => (
    <span
      data-id="summary-color-swatch"
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-hairline"
      style={{ background: value || "var(--color-surface-alt)" }}
    />
  );

  // ── 팝오버 열기/확정/취소 ──────────────────────────────────────────────────
  // SP 상속 IO — 읽기 전용 팝오버 소스(링크 맵 sp_* 값)
  const spIo = (field: "input" | "output") => ({
    value: (field === "input" ? sp?.input : sp?.output) ?? "",
    extra: (field === "input" ? sp?.input_forms : sp?.output_forms) ?? "",
  });
  function readTileDraft(field: TileField): Pick<ActiveTile, "value" | "extra" | "links" | "flags" | "ids" | "unit"> {
    const unit = costUnitOf(form);
    const base = { links: "", flags: "", ids: "", unit };
    switch (field) {
      case "url":
        return { ...base, value: form.url, extra: form.urlLabel };
      case "cost":
        return { ...base, value: form[unit], extra: "" };
      case "input":
        return { ...base, value: form.input, extra: form.input_forms, links: form.input_links, flags: form.input_flags };
      case "output":
        return { ...base, value: form.output, extra: form.output_forms, links: form.output_links, ids: form.output_ids };
      default:
        return { ...base, value: form[field], extra: "" };
    }
  }
  function openTile(field: TileField, at: { x: number; y: number }, viewOnly = false) {
    if (viewOnly && isSp && (field === "input" || field === "output")) {
      setActive({ field, at, ...readTileDraft(field), ...spIo(field), readOnly: true });
      return;
    }
    setActive({ field, at, ...readTileDraft(field), readOnly: viewOnly });
  }
  const tileDirty = (() => {
    if (!active || active.readOnly) return false;
    const base = readTileDraft(active.field);
    return (
      active.value !== base.value ||
      active.extra !== base.extra ||
      active.links !== base.links ||
      active.flags !== base.flags ||
      active.ids !== base.ids ||
      (active.field === "cost" && active.unit !== base.unit)
    );
  })();
  // 초안 → 폼 버퍼(팝오버는 열어둠) — 메뉴 "Save"
  function applyTile() {
    if (!active || active.readOnly) return;
    const { field, value, extra, links, flags, ids, unit } = active;
    setForm((prev) => {
      const next: Form = { ...prev };
      switch (field) {
        case "url":
          next.url = value.trim();
          next.urlLabel = extra.trim();
          break;
        case "cost":
          // 통화 배타 — 고른 단위에만 값, 다른 통화는 비운다
          next.cost_krw = unit === "cost_krw" ? value : "";
          next.cost_usd = unit === "cost_usd" ? value : "";
          break;
        case "input":
          next.input = value;
          next.input_forms = extra;
          next.input_links = links;
          next.input_flags = flags;
          break;
        case "output":
          next.output = value;
          next.output_forms = extra;
          next.output_links = links;
          next.output_ids = ids;
          break;
        default:
          next[field] = value;
      }
      return next;
    });
  }
  function commitTile() {
    applyTile();
    setActive(null);
  }

  const spDept = sp?.department ?? "";
  const spAssignee = formatAssignees(parseAssignees(sp?.assignee ?? ""));
  const spSystem = sp?.system ?? "";
  const spUrl = (sp?.url ?? "").trim() ? (sp?.url_label ?? "").trim() || (sp?.url ?? "").trim() : "";
  const gmpValue = gmp ?? "";
  // 접힘 헤더의 채워진 개수 — 버퍼(form) 기준(SP는 상속값)
  const filledAttrCount = isSp
    ? [spDept, spAssignee, spSystem, spUrl].filter((v) => v !== "").length
    : [form.department, form.assignee, form.system, form.url].filter((v) => v !== "").length;
  const filledParamCount = PARAM_TILES.filter((f) => tileValue(f) !== "").length;
  const filledDetailCount = isSp
    ? [sp?.input, sp?.output, sp?.start_condition, sp?.end_condition].filter((v) => (v ?? "") !== "").length
    : [form.input, form.output, form.data_form, form.start_condition, form.end_condition].filter((v) => v !== "").length;
  // 노드 레벨 data_form 폴백 타일 — 항목별 폼이 하나라도 생기면 숨김(항목별 값이 정본)
  const showLegacyDataForm = !isSp && form.input_forms === "" && form.output_forms === "" && !(readOnly && form.data_form === "");

  // ── 타일 렌더 ─────────────────────────────────────────────────────────────
  // 정적(읽기) 타일은 값 있는 것만 — 입출력은 목록을 열어야 보이므로 클릭 가능(읽기 팝오버)
  const renderTile = (field: TileField, opts: { readOnly?: boolean; hideEmpty?: boolean } = {}) => {
    const value = tileValue(field);
    const isIo = field === "input" || field === "output";
    const staticTile = opts.readOnly ?? readOnly;
    if ((opts.hideEmpty ?? staticTile) && value === "" && !(field === "color" && form.color !== "")) return null;
    const valueNode =
      field === "color" && form.color !== ""
        ? colorSwatch(form.color)
        : field === "cost" && value !== ""
          ? <CurrencyPill unit={isSp ? inheritedCostUnit : costUnitOf(form)} />
          : undefined;
    const clickable = !staticTile || (isIo && value !== "");
    return (
      <SpFieldTile
        key={field}
        dataId={`summary-tile-${field}`}
        icon={tileIcon(field)}
        label={tileLabel(field)}
        value={value}
        valueNode={valueNode}
        readOnly={!clickable}
        active={active?.field === field}
        onOpen={(at) => openTile(field, at, staticTile)}
      />
    );
  };
  const typeTile = (
    <SpFieldTile
      dataId="summary-tile-type"
      icon={NAV_TYPE_ICONS[nodeType] ?? Square}
      label={t("field.type")}
      value={typeLabel}
      readOnly
    />
  );
  const gmpTile = gmpValue !== "" && (
    <SpFieldTile
      dataId="summary-tile-gmp"
      icon={ShieldCheck}
      label={t("field.gmp")}
      value={formatGmp(gmpValue)}
      valueNode={
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={getGmpBadgeStyle(gmpValue)} />
      }
      readOnly
    />
  );
  const sectionButton = (
    dataId: string,
    collapsed: boolean,
    onToggle: () => void,
    label: string,
    count: number,
    changed: boolean,
  ) => (
    <button
      type="button"
      data-id={dataId}
      aria-expanded={!collapsed}
      className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink-tertiary"
      onClick={onToggle}
    >
      <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`} />
      {label}
      {count > 0 && <span className="font-normal">({count})</span>}
      {/* 버퍼 변경 점 — 접혀 있어도 저장 전 수정이 있음을 표시 */}
      {changed && <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />}
    </button>
  );
  const toggleAllButton = (
    <button
      type="button"
      data-id="summary-toggle-all-sections"
      className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink"
      onClick={toggleAllSections}
    >
      {anySectionOpen ? <ChevronsDownUp size={13} strokeWidth={1.5} /> : <ChevronsUpDown size={13} strokeWidth={1.5} />}
      {t(anySectionOpen ? "inspector.collapseAll" : "inspector.expandAll")}
    </button>
  );
  // 속성 섹션 — process·decision은 편집 타일, subprocess는 링크 맵 상속 읽기 타일
  const showAttrSection = showAttributes || isSp;
  const attrTiles = isSp ? (
    <>
      <DeptAssigneeTiles versionId={null} department={spDept} assignee={spAssignee} readOnly dataIdPrefix="summary-tile" labels={labels} onChange={() => {}} />
      {spSystem !== "" && (
        <SpFieldTile dataId="summary-tile-system" icon={Monitor} label={t("field.system")} value={spSystem} readOnly />
      )}
      {spUrl !== "" && (
        <SpFieldTile dataId="summary-tile-url" icon={LinkIcon} label={t("field.url")} value={spUrl} readOnly />
      )}
      {gmpTile}
    </>
  ) : (
    <>
      <DeptAssigneeTiles
        versionId={readOnly ? null : versionId}
        department={form.department}
        assignee={form.assignee}
        readOnly={readOnly}
        dataIdPrefix="summary-tile"
        labels={labels}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
      />
      {renderTile("system")}
      {renderTile("url")}
      {gmpTile}
    </>
  );
  const paramTiles = PARAM_TILES.map((field) => {
    // 비용 타일은 두 통화 필드를 접은 것 — 편집 가능 여부는 cost_krw 기준(둘은 항상 같은 규칙)
    const editable = isEditableParam(field === "cost" ? "cost_krw" : field);
    return renderTile(field, isSp && !editable ? { readOnly: true } : {});
  });
  const detailTiles = isSp ? (
    <>
      {renderTile("input", { readOnly: true })}
      {renderTile("output", { readOnly: true })}
      {(sp?.start_condition ?? "") !== "" && (
        <SpFieldTile dataId="summary-tile-start_condition" icon={Play} label={t("field.startCondition")} value={sp?.start_condition ?? ""} readOnly />
      )}
      {(sp?.end_condition ?? "") !== "" && (
        <SpFieldTile dataId="summary-tile-end_condition" icon={Flag} label={t("field.endCondition")} value={sp?.end_condition ?? ""} readOnly />
      )}
    </>
  ) : (
    <>
      {renderTile("input")}
      {renderTile("output")}
      {showLegacyDataForm && renderTile("data_form")}
      {renderTile("start_condition")}
      {renderTile("end_condition")}
    </>
  );
  const GRID = "grid grid-cols-2 gap-1.5 py-1";
  const inheritedHint = isSp && <p className="text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>;

  // ── 팝오버 본문 ────────────────────────────────────────────────────────────
  const renderPopover = () => {
    if (!active) return null;
    const { field } = active;
    const isIo = field === "input" || field === "output";
    const isParam = (PARAM_TILES as readonly string[]).includes(field);
    const inputField: ParamField | null = field === "cost" ? active.unit : isParam ? (field as ParamField) : null;
    // SP 참고치 — 연간 건수·FTE 팝오버 안내(링크 맵 지정값, 노드 값과 별개)
    const reference = isSp && (field === "annual_count" || field === "fte") ? (sp?.[field] ?? "") : "";
    return (
      <SpFieldPopover
        dataId={`summary-tile-popover-${field}`}
        anchor={active.at}
        title={tileLabel(field)}
        hint={active.readOnly ? t("sp.tile.readOnlyHint") : field === "cost" ? t("sp.tile.costUnitHint") : t(HINT_KEY[field])}
        width={isIo ? 420 : field === "color" ? 300 : 320}
        enterCommits={!isIo}
        dirty={tileDirty}
        readOnly={active.readOnly}
        closeLabel={t("summary.close")}
        onApply={applyTile}
        onCommit={commitTile}
        onCancel={() => setActive(null)}
        labels={labels}
        footerStart={
          isIo && !active.readOnly ? (
            <button
              type="button"
              data-id={`summary-tile-io-${field}-add`}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={() => ioRef.current?.addRow()}
            >
              <Plus size={12} strokeWidth={1.5} />
              {t("io.addNew")}
            </button>
          ) : undefined
        }
      >
        {field === "color" && (
          <div className="flex flex-col gap-2">
            {/* 프리셋 견본 + 커스텀 hex — 클릭 즉시 초안, Enter/저장으로 확정 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {colorPresets.map((preset) => (
                <button
                  key={preset || "default"}
                  type="button"
                  title={preset || "default"}
                  aria-label={preset || "default"}
                  aria-pressed={active.value === preset}
                  onClick={() => setActive((prev) => (prev ? { ...prev, value: preset } : prev))}
                  className={`h-6 w-6 rounded-full border ${
                    active.value === preset
                      ? "border-transparent ring-2 ring-accent"
                      : "border-hairline hover:ring-2 hover:ring-accent-tint-border"
                  }`}
                  style={{ background: preset || "var(--color-surface-alt)" }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {colorSwatch(active.value)}
              <input
                data-id="summary-tile-input-color"
                className={INPUT_CLASS}
                value={active.value}
                placeholder="#RRGGBB"
                maxLength={7}
                spellCheck={false}
                aria-label={t("field.color")}
                onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
              />
            </div>
          </div>
        )}
        {inputField && (
          <div className="flex items-center gap-1.5">
            {field === "cost" && (
              <CostUnitTabs
                dataId="summary-tile-cost-unit"
                value={active.unit}
                onChange={(unit) => setActive((prev) => (prev ? { ...prev, unit } : prev))}
              />
            )}
            <ParamInput
              key={inputField}
              field={inputField}
              dataId={`summary-param-${field}`}
              className={`${INPUT_CLASS} text-right`}
              value={active.value}
              ariaLabel={tileLabel(field)}
              onCommit={(next) => setActive((prev) => (prev ? { ...prev, value: next } : prev))}
            />
          </div>
        )}
        {reference !== "" && (
          <p data-id="summary-tile-reference" className="text-fine text-ink-tertiary">
            {t("metrics.designatedRef", { v: reference })} - {t("metrics.designatedRefHint")}
          </p>
        )}
        {(field === "system" || field === "data_form" || field === "start_condition" || field === "end_condition") && (
          <input
            data-id={`summary-tile-input-${field}`}
            className={INPUT_CLASS}
            maxLength={field === "data_form" ? 50 : undefined}
            placeholder={field === "data_form" ? "structured / document / tacit" : undefined}
            value={active.value}
            onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          />
        )}
        {field === "url" && (
          <div className="flex flex-col gap-1.5">
            <input
              data-id="summary-tile-input-url"
              className={INPUT_CLASS}
              maxLength={500}
              placeholder="https://"
              value={active.value}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
            />
            {active.value.trim() !== "" && !isHttpUrl(active.value) && (
              <p className="text-fine text-error">{t("subprocess.urlInvalid")}</p>
            )}
            <input
              data-id="summary-tile-input-url-label"
              className={`${INPUT_CLASS} disabled:opacity-40`}
              maxLength={100}
              placeholder={t("field.urlLabel")}
              value={active.extra}
              disabled={active.value.trim() === ""}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, extra: e.target.value } : prev))}
            />
          </div>
        )}
        {isIo && (
          <div className="rounded-sm border border-hairline bg-surface-alt/40 px-2 py-1">
            {/* 팝오버 제목이 이미 필드명 — 편집기는 헤드리스, '+ Add'는 푸터. 링크·플래그·id 열은 텍스트와
                함께 정렬을 유지해 왕복시킨다(io-linking §3). 읽기 전용은 항목 목록만 */}
            <MultiValueInput
              key={`${nodeId}-${field}-${active.readOnly ? "read" : "edit"}`}
              ref={ioRef}
              dataId={`summary-tile-io-${field}`}
              label={tileLabel(field)}
              headless
              value={active.value}
              formsValue={active.extra}
              linksValue={active.readOnly ? undefined : active.links}
              flagsValue={active.readOnly || field !== "input" ? undefined : active.flags}
              idsValue={active.readOnly || field !== "output" ? undefined : active.ids}
              readOnly={active.readOnly}
              onCommit={(joined, formsJoined, extras) =>
                setActive((prev) =>
                  prev
                    ? {
                        ...prev,
                        value: joined,
                        extra: formsJoined ?? "",
                        ...(extras ? { links: extras.links, flags: extras.flags, ids: extras.ids } : {}),
                      }
                    : prev,
                )
              }
            />
          </div>
        )}
      </SpFieldPopover>
    );
  };

  return (
    <ModalBackdrop
      className="absolute inset-0 z-[1200] flex items-start justify-center pt-[7vh] backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="relative flex max-h-[80%] w-full max-w-lg flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg"
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
              {/* 설명 — 읽기전용에서도 표시(있을 때만). subprocess는 링크맵 베이스+추가분 합성(인스펙터와 동일). */}
              {(() => {
                const mergedDesc = isSp
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
              {/* 유형·색·그룹 — 정적 타일 */}
              <div className={GRID} data-id="summary-read-basics">
                {typeTile}
                {!isSp && renderTile("color")}
                {groupLabel && (
                  <SpFieldTile dataId="summary-tile-group" icon={Boxes} label={t("summary.group")} value={groupLabel} readOnly />
                )}
              </div>
              {showAttrSection && filledAttrCount + (gmpValue !== "" ? 1 : 0) > 0 && (
                <div data-id="summary-read-attrs">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("editor.bpmAttrs")}</p>
                  <div className={GRID}>{attrTiles}</div>
                  {inheritedHint}
                </div>
              )}
              {(showAttributes || isSp) && filledParamCount > 0 && (
                <div data-id="summary-read-params">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("inspector.parameters")}</p>
                  <div className={GRID}>{paramTiles}</div>
                </div>
              )}
              {(showAttributes || isSp) && filledDetailCount > 0 && (
                <div data-id="summary-read-details">
                  <p className="text-fine font-semibold text-ink-tertiary">{t("inspector.details")}</p>
                  <div className={GRID}>{detailTiles}</div>
                  {inheritedHint}
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
                  disabled={isSp}
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
              {/* 설명 — 노드 부연(NodeData.description). subprocess는 링크맵 설명을 읽기전용
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
              {/* 유형(고정)·색 타일 — subprocess는 단일색 고정이라 색 타일 없음 (spec 2026-07-06 §9) */}
              <div className={GRID} data-id="summary-basics">
                {typeTile}
                {!isSp && renderTile("color", { hideEmpty: false })}
              </div>
              <div className="flex flex-col divide-y divide-divider">
                {/* BPM 속성 — process·decision은 편집 타일, subprocess는 상속 읽기 타일. 아코디언(기본 접힘, 인스펙터와 키 공유) */}
                {showAttrSection && (
                  <div className="py-1.5" data-id="summary-attrs">
                    <div className="flex items-center gap-1">
                      {sectionButton(
                        "summary-attrs-toggle",
                        attrsCollapsed,
                        () => {
                          const next = !attrsCollapsed;
                          setAttrsCollapsed(next);
                          writeAttrsCollapsed(next);
                        },
                        t("editor.bpmAttrs"),
                        filledAttrCount,
                        hasChangedIn(ATTRS_KEYS),
                      )}
                      {toggleAllButton}
                    </div>
                    {/* 아코디언 높이 전환 — 접힘/펼침을 AutoHeight가 부드럽게 잇는다 (사용자 결정 2026-08-20) */}
                    <AutoHeight className="overflow-hidden">
                      {!attrsCollapsed && (
                        <div className="ml-2 border-l border-divider pl-2">
                          <div className={GRID} data-id="summary-attr-tiles">{attrTiles}</div>
                          {inheritedHint}
                        </div>
                      )}
                    </AutoHeight>
                  </div>
                )}
                {/* 회당 지표 — 접기 그룹(기본 접힘, 인스펙터와 공유 키). start/end 외 모든 타입에 표시.
                    subprocess는 회당 4지표가 링크 맵 지정값이라 읽기 타일, 연간 건수·FTE만 입력 (design §3.1) */}
                {editableParams.length > 0 && (
                  <div className="py-1.5" data-id="summary-params">
                    <div className="flex items-center gap-1">
                      {sectionButton(
                        "summary-params-toggle",
                        paramsCollapsed,
                        () => {
                          const next = !paramsCollapsed;
                          setParamsCollapsed(next);
                          writeParamsCollapsed(next);
                        },
                        t("inspector.parameters"),
                        filledParamCount,
                        hasChangedIn(PARAM_FIELDS),
                      )}
                      {!showAttrSection && toggleAllButton}
                    </div>
                    <AutoHeight className="overflow-hidden">
                      {!paramsCollapsed && (
                        <div className="ml-2 border-l border-divider pl-2">
                          <div className={GRID} data-id="summary-param-tiles">{paramTiles}</div>
                          {inheritedHint}
                        </div>
                      )}
                    </AutoHeight>
                  </div>
                )}
                {/* 인터뷰 승격 상세 — IO(항목 수 타일 → 플라이아웃 편집기)+종속 Data form·조건. 버퍼 편집(저장 시 반영), 기본 접힘.
                    SP는 링크 맵 상속 읽기 타일 — 인스펙터 카드와 동기화(#11) */}
                {(showAttributes || isSp) && (
                  <div className="py-1.5" data-id="summary-details">
                    {sectionButton(
                      "summary-details-toggle",
                      detailsCollapsed,
                      () => {
                        const next = !detailsCollapsed;
                        setDetailsCollapsed(next);
                        writeDetailsCollapsed(next);
                      },
                      t("inspector.details"),
                      filledDetailCount,
                      hasChangedIn(DETAILS_KEYS),
                    )}
                    <AutoHeight className="overflow-hidden">
                      {!detailsCollapsed && (
                        <div className="ml-2 border-l border-divider pl-2">
                          <div className={GRID} data-id="summary-detail-tiles">{detailTiles}</div>
                          {inheritedHint}
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

          {/* 링크맵 노트(인터뷰 예외 규칙·VOC) — 읽기전용 아코디언(기본 접힘, 영속 없음).
              노트가 없는 맵이 대다수라 그 경우 섹션 자체가 렌더되지 않는다 (사용자 요청 2026-08-31) */}
          {linkedMapId != null && <MapNotesSection scope={{ mapId: linkedMapId }} />}

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
                  data-id="summary-save"
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
      </div>
      {/* 선행/후행 사이드 독 — 모달 카드 밖, 백드롭 좌우(백드롭은 자기 자신을 눌렀을 때만 닫힌다) */}
      <NavDock side="left" title={t("summary.prev")} nodes={predecessors} typeLabelOf={typeLabelOf} onPick={requestNavigate} />
      <NavDock side="right" title={t("summary.next")} nodes={successors} typeLabelOf={typeLabelOf} onPick={requestNavigate} />
      {renderPopover()}
    </ModalBackdrop>
  );
}
