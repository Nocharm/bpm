"use client";

// 노드 더블클릭 편집 모달 — 제목·설명 + 필드 타일(2열, 클릭 위치 팝오버) + 전/후 단계·하위 프로세스
// 프리뷰·코멘트. 타일 디자인은 SP 지정 모달과 같다(사용자 결정 2026-09-03): 부서·담당자는 두 열을
// 가로지르는 행 타일, 색·시스템·링크·지표 7(비용은 단위 탭 한 타일)·입출력/조건은 2열 타일.
// 편집은 라이브다(사용자 요청 2026-09-03 "인스펙터와 양방향 동기"): 팝오버 초안은 Enter/저장으로 노드에
// 바로 반영되고, 제목·설명 타이핑도 인스펙터와 같이 즉시 반영된다. 반대로 인스펙터에서 고친 값은 props로
// 들어와 열려 있는 타일·팝오버(변경 없는 초안)에 곧장 반영된다. 되돌리기는 에디터 Ctrl+Z.
// readOnly면 값 있는 타일만 정적으로 — 목록을 열어야 보이는 입출력만 클릭해 읽기 전용 팝오버로 본다.
// subprocess는 링크 맵 상속값(속성·회당 4지표·입출력/조건)을 읽기 타일로, 연간 건수·FTE만 편집한다.

import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleDot,
  CornerDownRight,
  Diamond,
  Flag,
  Import,
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
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { AutoHeight } from "@/components/auto-height";
import { CostUnitTabs, CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { FallbackHint } from "@/components/fallback-hint";
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
  // 시스템 원문 메모 — 타일 호버 메모 아이콘·시스템 팝오버 메모 칸이 고친다
  system_fallback: string;
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

// 독 폭 상한(px)·독이 모달과 안 겹치기 위해 백드롭 반폭에서 빼는 값(모달 반폭 256 + 가장자리 16 + 간격 8).
// NavDock의 w-[min(12.5rem,calc(50%-17.5rem))]와 같은 수치 — 전환 애니메이션이 반대편 독 자리를 계산할 때 쓴다
const DOCK_MAX_WIDTH = 200;
const DOCK_INSET = 280;
// 선후행 전환 애니메이션 길이(ms) — globals.css .summary-swap-* 와 동기
const SWAP_MS = 380;

// 독 카드 본문 — 색 점·라벨·타입. 독 카드와 전환 고스트가 공유한다
function DockCardBody({ node, typeLabelOf }: { node: NavNodeRef; typeLabelOf: (nodeType: string) => string }) {
  const Icon = NAV_TYPE_ICONS[node.nodeType] ?? Square;
  return (
    <>
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
    </>
  );
}

// 선행/후행 사이드 독 — 모달 밖 캔버스 좌우에 세로 정렬로 떠 있는 간소 카드(색 점·라벨·타입).
// 호버 시 레이아웃으로 커진다(폭 +12px를 모달 쪽으로, 세로 패딩 +4px) — scale 변환은 래스터가 미세하게
// 뒤틀려 보여 폐기(사용자 피드백 2026-09-03). 커진 높이만큼 위아래 카드가 자연히 벌어지고, 스크롤 상자
// 안쪽 여백 덕에 경계에 잘리지 않는다. 클릭=그 노드로 전환(애니메이션).
function NavDock({
  side,
  title,
  nodes,
  typeLabelOf,
  hiddenId,
  onPick,
}: {
  side: "left" | "right";
  title: string;
  nodes: NavNodeRef[];
  typeLabelOf: (nodeType: string) => string;
  // 전환 중 고스트가 대신 그리는 카드 — 원본은 숨긴다
  hiddenId: string | null;
  onPick: (node: NavNodeRef, rect: DOMRect) => void;
}) {
  if (nodes.length === 0) return null;
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      data-id={`summary-dock-${side === "left" ? "prev" : "next"}`}
      // 폭은 백드롭 반폭 − 모달 반폭(256) − 가장자리 16 − 간격 8 을 넘지 않게 — 좁은 캔버스에서도 모달과 안 겹친다
      className={`absolute top-1/2 flex max-h-[72%] w-[min(12.5rem,calc(50%-17.5rem))] -translate-y-1/2 flex-col gap-1 ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <div className={`flex items-center gap-1 px-1 text-fine text-ink-tertiary ${side === "right" ? "justify-end" : ""}`}>
        {side === "left" && <Chevron size={12} strokeWidth={1.5} />}
        {title}
        <span className="text-ink-muted">({nodes.length})</span>
        {side === "right" && <Chevron size={12} strokeWidth={1.5} />}
      </div>
      {/* 안쪽 여백 px-3.5/py-2 — 호버로 12px 넓어진 카드가 overflow(스크롤) 경계 안에 남는다 */}
      <div className="scrollbar-hidden flex min-h-0 flex-col gap-1.5 overflow-y-auto px-3.5 py-2">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-id={`summary-dock-card-${node.id}`}
            title={node.label}
            style={hiddenId === node.id ? { visibility: "hidden" } : undefined}
            onClick={(e) => onPick(node, e.currentTarget.getBoundingClientRect())}
            // 호버: 폭 +12px(모달 쪽으로만 — 오른쪽 독은 왼쪽 마진을 당긴다) + 세로 패딩 +4px + 액센트 보더·그림자.
            // 전부 레이아웃 속성 트랜지션(transform 없음)이라 글자·보더가 흐려지지 않는다
            className={`animate-item-in relative flex w-full shrink-0 items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-2 text-left shadow-md transition-[width,margin,padding,box-shadow,border-color] duration-350 ease-spring hover:z-10 hover:w-[calc(100%+0.75rem)] hover:py-3 hover:border-accent-tint-border hover:shadow-lg ${
              side === "left" ? "" : "hover:-ml-3"
            }`}
          >
            <DockCardBody node={node} typeLabelOf={typeLabelOf} />
          </button>
        ))}
      </div>
    </div>
  );
}

// 선후행 전환 — 클릭한 독 카드가 커지며 가운데로(고스트), 가운데 카드는 줄어들며 반대편 독으로. 실측한
// 이동량·배율을 CSS 변수로 넘기고, 애니메이션이 끝나는 시점에 노드를 바꾼다(사용자 요청 2026-09-03)
interface SwapState {
  node: NavNodeRef;
  // 고스트 시작 자리 — 백드롭 기준 좌표(fixed는 transform 조상에 걸릴 수 있어 absolute)
  box: { left: number; top: number; width: number; height: number };
  ghostVars: CSSProperties;
  cardVars: CSSProperties;
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
  start_condition: "sp.tile.hint.start_condition",
  end_condition: "sp.tile.hint.end_condition",
};

// 편집 폼 — 노드 값의 로컬 미러. 라이브 편집이라 props와 거의 항상 같고, 제목 타이핑 등 순간에만 앞선다
interface Form {
  label: string;
  description: string;
  color: string;
  assignee: string;
  department: string;
  system: string;
  system_fallback: string;
  duration: string;
  touch_time: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  input: string;
  output: string;
  input_forms: string;
  output_forms: string;
  output_ids: string;
  input_links: string;
  output_links: string;
  input_flags: string;
  start_condition: string;
  end_condition: string;
}
const FORM_KEYS = [
  "label", "description", "color", "assignee", "department", "system", "system_fallback", "duration",
  "touch_time", "cost_krw", "cost_usd", "headcount", "annual_count", "fte", "url", "urlLabel",
  "input", "output", "input_forms", "output_forms", "output_ids", "input_links", "output_links", "input_flags",
  "start_condition", "end_condition",
] as const satisfies readonly (keyof Form)[];
// 타일이 읽는 폼 키 — 인스펙터에서 바뀐 값이 열린 팝오버 초안까지 닿아야 하는지 판정
const TILE_KEYS: Record<TileField, readonly (keyof Form)[]> = {
  color: ["color"],
  system: ["system", "system_fallback"],
  url: ["url", "urlLabel"],
  duration: ["duration"],
  touch_time: ["touch_time"],
  cost: ["cost_krw", "cost_usd"],
  headcount: ["headcount"],
  annual_count: ["annual_count"],
  fte: ["fte"],
  input: ["input", "input_forms", "input_links", "input_flags"],
  output: ["output", "output_forms", "output_links", "output_ids"],
  start_condition: ["start_condition"],
  end_condition: ["end_condition"],
};

interface ActiveTile {
  field: TileField;
  at: { x: number; y: number };
  // 팝오버 로컬 초안 — 확정 시에만 노드에 반영, Esc면 폐기
  value: string;
  note: string; // 시스템 원문 메모
  extra: string; // url 라벨 / IO 폼 join
  links: string; // IO 미러 링크 열
  flags: string; // 인풋 필수/선택 열
  ids: string; // 아웃풋 원본 id 열
  unit: CostUnit; // 비용 타일의 통화 탭
  readOnly: boolean; // 열람 전용(입출력 목록 보기)
}
type TileDraft = Pick<ActiveTile, "value" | "note" | "extra" | "links" | "flags" | "ids" | "unit">;

const INPUT_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

const countLines = (joined: string): number => joined.split("\n").filter((line) => line.trim() !== "").length;
const costUnitOf = (form: { cost_krw: string; cost_usd: string }): CostUnit =>
  form.cost_usd !== "" ? "cost_usd" : "cost_krw";

// 폼의 현재 확정값을 팝오버 초안 형태로 — 열 때 초기값, 열린 뒤엔 dirty 판정 기준
function readTileDraftFrom(form: Form, field: TileField): TileDraft {
  const unit = costUnitOf(form);
  const base = { note: "", links: "", flags: "", ids: "", unit };
  switch (field) {
    case "url":
      return { ...base, value: form.url, extra: form.urlLabel };
    case "cost":
      return { ...base, value: form[unit], extra: "" };
    case "system":
      return { ...base, value: form.system, note: form.system_fallback, extra: "" };
    case "input":
      return { ...base, value: form.input, extra: form.input_forms, links: form.input_links, flags: form.input_flags };
    case "output":
      return { ...base, value: form.output, extra: form.output_forms, links: form.output_links, ids: form.output_ids };
    default:
      return { ...base, value: form[field], extra: "" };
  }
}
function isTileDirty(tile: ActiveTile, form: Form): boolean {
  if (tile.readOnly) return false;
  const base = readTileDraftFrom(form, tile.field);
  return (
    tile.value !== base.value ||
    tile.note.trim() !== base.note.trim() ||
    tile.extra !== base.extra ||
    tile.links !== base.links ||
    tile.flags !== base.flags ||
    tile.ids !== base.ids ||
    (tile.field === "cost" && tile.unit !== base.unit)
  );
}
// 초안 → 노드 패치. 팝오버 확정이 노드에 바로 쓰는 값
function buildTilePatch(tile: ActiveTile): NodeEditPatch {
  const { field, value, note, extra, links, flags, ids, unit } = tile;
  switch (field) {
    case "url":
      return { url: value.trim(), urlLabel: extra.trim() };
    case "cost":
      // 통화 배타 — 고른 단위에만 값, 다른 통화는 비운다
      return { cost_krw: unit === "cost_krw" ? value : "", cost_usd: unit === "cost_usd" ? value : "" };
    case "system":
      return { system: value, system_fallback: note.trim() };
    case "input":
      return { input: value, input_forms: extra, input_links: links, input_flags: flags };
    case "output":
      return { output: value, output_forms: extra, output_links: links, output_ids: ids };
    default:
      return { [field]: value };
  }
}

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
  // 시스템 원문 메모(노드 컬럼) — 시스템 타일 호버 메모 아이콘·팝오버 메모 칸
  systemFallback: string;
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
  // subprocess 상속 상세(링크 맵 sp_* 속성·IO/조건·참고치·빈도 원문) — 읽기전용 표시(#11). 그 외 타입은 null
  sp?: {
    department?: string | null;
    assignee?: string | null;
    system?: string | null;
    url?: string | null;
    url_label?: string | null;
    annual_count?: string | null;
    fte?: string | null;
    frequency_fallback?: string | null;
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
  // IO 팝오버 '다른 노드에서 불러오기' — 그래프 전체를 아는 page가 불러오기 모달을 연다(인스펙터와 동일 경로)
  onIoImport?: (side: "input" | "output", at: { x: number; y: number }) => void;
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
  systemFallback,
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
  onIoImport,
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
  // 노드 값(props) 스냅샷 — 폼은 이 미러에서 시작해 편집 즉시 노드로 되돌려 쓴다
  const propsForm: Form = {
    label: title, description, color, assignee, department, system, system_fallback: systemFallback, duration,
    touch_time, cost_krw, cost_usd, headcount, annual_count, fte, url, urlLabel,
    input, output, input_forms, output_forms, output_ids, input_links, output_links, input_flags,
    start_condition, end_condition,
  };
  const [form, setForm] = useState<Form>(propsForm);
  // 마지막으로 본 props — 인스펙터 등 바깥에서 바뀐 키를 가려내는 기준
  const [base, setBase] = useState<Form>(propsForm);
  const [active, setActive] = useState<ActiveTile | null>(null);
  // IO 플라이아웃 편집기 리마운트 키 — 바깥(불러오기 등)에서 IO가 바뀌면 행 버퍼를 새 값으로 다시 만든다
  const [ioSync, setIoSync] = useState(0);
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  if (nodeId !== prevNodeId) {
    // 노드가 바뀌면(선후행 전환 등) 폼을 새 노드 값으로 리셋 — 렌더 중 상태조정(effect 아님)
    setPrevNodeId(nodeId);
    setForm(propsForm);
    setBase(propsForm);
    setActive(null);
    setSwap(null);
  } else {
    // 같은 노드의 값이 바깥(인스펙터·불러오기·Undo)에서 바뀜 — 바뀐 키만 폼에 반영하고, 그 키를 읽는
    // 팝오버가 변경 없는 초안으로 열려 있으면 초안도 새 값으로(사용자 요청 2026-09-03 양방향 동기)
    const changed = FORM_KEYS.filter((key) => propsForm[key] !== base[key]);
    if (changed.length > 0) {
      const next: Form = { ...form };
      for (const key of changed) next[key] = propsForm[key];
      setBase(propsForm);
      setForm(next);
      if (active && !isTileDirty(active, form) && TILE_KEYS[active.field].some((key) => changed.includes(key))) {
        setActive({ ...active, ...readTileDraftFrom(next, active.field) });
        if (active.field === "input" || active.field === "output") setIoSync((n) => n + 1);
      }
    }
  }
  // IO 플라이아웃 편집기 핸들 — 푸터 '+ Add'가 행을 추가한다
  const ioRef = useRef<MultiValueInputHandle | null>(null);
  // 폼과 노드를 함께 고친다 — 모든 편집의 단일 경로
  const patchLive = (patch: NodeEditPatch) => {
    setForm((prev) => ({ ...prev, ...patch }) as Form);
    onPatch(patch);
  };

  // 노드 타입별 편집 가능 파라미터 — subprocess는 회당 4필드가 링크 맵 지정값이라 제외 (design §3.1)
  const editableParams = getEditableParamFields(nodeType);
  const isEditableParam = (field: ParamField) => (editableParams as readonly string[]).includes(field);

  // ── 선후행 전환 ────────────────────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement | null>(null);
  const swapTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      // 전환 중 닫히면 예약된 노드 전환을 취소 — 닫힌 모달이 다시 열리지 않게
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    },
    [],
  );
  const startSwap = (node: NavNodeRef, side: "left" | "right", rect: DOMRect) => {
    const card = cardRef.current;
    const backdrop = card?.parentElement;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!card || !backdrop || reduced || swap) {
      onNavigate(node.id);
      return;
    }
    const c = card.getBoundingClientRect();
    const b = backdrop.getBoundingClientRect();
    const dockWidth = Math.min(DOCK_MAX_WIDTH, b.width / 2 - DOCK_INSET);
    // 가운데 카드가 가는 곳 — 클릭한 독의 반대편 독 자리(후행을 고르면 현재 노드는 선행이 된다)
    const toLeft = side === "right";
    const dockX = toLeft ? b.left + 16 + dockWidth / 2 : b.right - 16 - dockWidth / 2;
    const dockY = b.top + b.height / 2;
    const cardCx = c.left + c.width / 2;
    const cardCy = c.top + c.height / 2;
    const ghostCx = rect.left + rect.width / 2;
    const ghostCy = rect.top + rect.height / 2;
    setSwap({
      node,
      box: { left: rect.left - b.left, top: rect.top - b.top, width: rect.width, height: rect.height },
      ghostVars: {
        "--swap-dx": `${cardCx - ghostCx}px`,
        "--swap-dy": `${cardCy - ghostCy}px`,
        "--swap-scale": `${c.width / rect.width}`,
      } as CSSProperties,
      cardVars: {
        "--swap-dx": `${dockX - cardCx}px`,
        "--swap-dy": `${dockY - cardCy}px`,
        "--swap-scale": `${dockWidth / c.width}`,
      } as CSSProperties,
    });
    swapTimer.current = window.setTimeout(() => {
      swapTimer.current = null;
      onNavigate(node.id);
    }, SWAP_MS);
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

  // ⌘S=열린 팝오버 초안 확정(브라우저 저장 대화상자 차단). Esc는 ModalBackdrop 스택(최상위만)이 닫는다 —
  // 타일 팝오버·원문 메모 팝오버는 Esc 전파를 끊어 자기만 닫힌다. 최신 상태는 effect event로 읽는다 (react-ts-patterns §7)
  const handleWindowKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (active) commitTile();
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
  // 원문 메모 아이콘 — 타일 호버 시 아이콘이 메모 아이콘으로 바뀌고 눌러서 보고 고친다(FallbackHint).
  // 시스템은 노드 컬럼(system_fallback), SP 연간 건수는 링크 맵 빈도 원문(읽기)
  const spFrequencyNote = (sp?.frequency_fallback ?? "").trim();
  const noteIcon = (field: TileField, filled: boolean): ReactNode => {
    const rest = filled ? "text-accent" : "text-ink-tertiary";
    if (field === "system" && !isSp && (form.system_fallback.trim() !== "" || !readOnly)) {
      return (
        <FallbackHint
          dataId="summary-tile-note-icon-system"
          fallback={form.system_fallback}
          restIcon={Monitor}
          iconSize={16}
          padded={false}
          restClassName={rest}
          onSaveFallback={readOnly ? undefined : (text) => patchLive({ system_fallback: text })}
          onApply={readOnly ? undefined : () => patchLive({ system: form.system_fallback.slice(0, 100) })}
        />
      );
    }
    if (field === "annual_count" && isSp && spFrequencyNote !== "") {
      return (
        <FallbackHint
          dataId="summary-tile-note-icon-annual_count"
          fallback={spFrequencyNote}
          restIcon={PARAM_ICON.annual_count}
          iconSize={16}
          padded={false}
          restClassName={rest}
        />
      );
    }
    return undefined;
  };

  // ── 팝오버 열기/확정/취소 ──────────────────────────────────────────────────
  // SP 상속 IO — 읽기 전용 팝오버 소스(링크 맵 sp_* 값)
  const spIo = (field: "input" | "output") => ({
    value: (field === "input" ? sp?.input : sp?.output) ?? "",
    extra: (field === "input" ? sp?.input_forms : sp?.output_forms) ?? "",
  });
  function openTile(field: TileField, at: { x: number; y: number }, viewOnly = false) {
    if (viewOnly && isSp && (field === "input" || field === "output")) {
      setActive({ field, at, ...readTileDraftFrom(form, field), ...spIo(field), readOnly: true });
      return;
    }
    setActive({ field, at, ...readTileDraftFrom(form, field), readOnly: viewOnly });
  }
  const tileDirty = active !== null && isTileDirty(active, form);
  // 초안 → 노드(팝오버는 열어둠) — 메뉴 "Save"
  function applyTile() {
    if (!active || active.readOnly) return;
    patchLive(buildTilePatch(active));
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
  // 접힘 헤더의 채워진 개수 — 폼 기준(SP는 상속값)
  const filledAttrCount = isSp
    ? [spDept, spAssignee, spSystem, spUrl].filter((v) => v !== "").length
    : [form.department, form.assignee, form.system, form.url].filter((v) => v !== "").length;
  const filledParamCount = PARAM_TILES.filter((f) => tileValue(f) !== "").length;
  const filledDetailCount = isSp
    ? [sp?.input, sp?.output, sp?.start_condition, sp?.end_condition].filter((v) => (v ?? "") !== "").length
    : [form.input, form.output, form.start_condition, form.end_condition].filter((v) => v !== "").length;

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
        iconSlot={noteIcon(field, value !== "" || valueNode != null)}
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
        onChange={(patch) => patchLive(patch)}
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
    const ioFooter =
      isIo && !active.readOnly ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-id={`summary-tile-io-${field}-add`}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt"
            onClick={() => ioRef.current?.addRow()}
          >
            <Plus size={12} strokeWidth={1.5} />
            {t("io.addNew")}
          </button>
          {/* 다른 노드에서 불러오기 — 인스펙터 IO 카드의 메뉴 항목과 같은 동작(page가 불러오기 모달을 연다).
              불러오기는 그래프에 즉시 커밋되므로 반영 안 된 초안이 있으면 잠근다 (사용자 요청 2026-09-03) */}
          {onIoImport && (
            <span title={tileDirty ? t("io.importSaveFirst") : undefined} className="inline-flex">
              <button
                type="button"
                data-id={`summary-tile-io-${field}-import`}
                disabled={tileDirty}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                onClick={(e) => onIoImport(field, { x: e.clientX, y: e.clientY })}
              >
                <Import size={12} strokeWidth={1.5} />
                {t("io.importFromNode")}
              </button>
            </span>
          )}
        </span>
      ) : undefined;
    return (
      <SpFieldPopover
        dataId={`summary-tile-popover-${field}`}
        anchor={active.at}
        title={tileLabel(field)}
        hint={active.readOnly ? t("sp.tile.readOnlyHint") : field === "cost" ? t("sp.tile.costUnitHint") : t(HINT_KEY[field])}
        width={isIo ? 440 : field === "color" ? 300 : 320}
        enterCommits={!isIo}
        dirty={tileDirty}
        readOnly={active.readOnly}
        closeLabel={t("summary.close")}
        onApply={applyTile}
        onCommit={commitTile}
        onCancel={() => setActive(null)}
        labels={labels}
        footerStart={ioFooter}
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
        {/* SP 연간 건수 — 링크 맵 인터뷰 빈도 원문(읽기, 수정은 링크 맵 지정에서) */}
        {field === "annual_count" && isSp && spFrequencyNote !== "" && (
          <div data-id="summary-tile-note-annual_count" className="flex flex-col gap-0.5">
            <span className="text-fine text-ink-secondary">{t("sp.tile.note")}</span>
            <p className="whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1 text-caption text-ink">{spFrequencyNote}</p>
          </div>
        )}
        {(field === "system" || field === "start_condition" || field === "end_condition") && (
          <input
            data-id={`summary-tile-input-${field}`}
            className={INPUT_CLASS}
            maxLength={field === "system" ? 100 : undefined}
            value={active.value}
            onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          />
        )}
        {/* 시스템 원문 메모 — 인스펙터 시스템 행의 원문 메모와 같은 컬럼, 팝오버 안에서 함께 고친다 */}
        {field === "system" && !active.readOnly && (
          <label className="flex flex-col gap-1">
            <span className="text-fine text-ink-secondary">{t("sp.tile.note")}</span>
            <textarea
              data-id="summary-tile-note-system"
              className="min-h-[3rem] resize-y rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent"
              maxLength={200}
              placeholder={t("sp.tile.notePlaceholder")}
              value={active.note}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
            />
          </label>
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
            {/* 팝오버 제목이 이미 필드명 — 편집기는 헤드리스, '+ Add'·불러오기는 푸터. 링크·플래그·id 열은 텍스트와
                함께 정렬을 유지해 왕복시킨다(io-linking §3). 읽기 전용은 항목 목록만. ioSync는 바깥 변경 리마운트 */}
            <MultiValueInput
              key={`${nodeId}-${field}-${active.readOnly ? "read" : "edit"}-${ioSync}`}
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
      {/* key=nodeId — 노드 전환 시 카드가 다시 팝인한다. 전환 중엔 반대편 독으로 줄어드는 애니메이션 */}
      <div
        key={nodeId}
        ref={cardRef}
        data-id="node-summary-card"
        className={`relative flex max-h-[80%] w-full max-w-lg flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg ${
          swap ? "summary-swap-out" : "summary-card-in"
        }`}
        style={swap ? swap.cardVars : undefined}
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
            죽으면 카드의 overflow-hidden이 아래를 잘라 하단까지 닿을 수 없다. 스크롤바는 숨기고 스크롤만 남긴다. */}
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
              {/* 제목 — subprocess는 링크된 맵 이름 고정이라 편집 차단 (F5). 타이핑은 인스펙터처럼 즉시 반영,
                  blur에서 이름 중복 고유화 */}
              <div>
                <label className="mb-1 block text-fine text-ink-tertiary">{t("field.title")}</label>
                <textarea
                  className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink disabled:bg-surface-alt disabled:text-ink-tertiary"
                  value={form.label}
                  rows={Math.min(5, form.label.split("\n").length)}
                  aria-label={t("field.title")}
                  disabled={isSp}
                  onChange={(event) => patchLive({ label: event.target.value })}
                  onBlur={() => onCommitLabel?.(form.label)}
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
                    patchLive({ label: next });
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
                  onChange={(event) => patchLive({ description: event.target.value })}
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
                {/* 인터뷰 승격 상세 — IO(항목 수 타일 → 플라이아웃 편집기, 자료 형식은 항목별)+조건. 기본 접힘.
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

        {/* 푸터 — 라이브 편집 안내 + Esc 힌트 + 완료. readOnly면 닫기만. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-4 py-2">
          {readOnly ? (
            <>
              <span />
              <button
                type="button"
                data-id="summary-close"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={onClose}
              >
                {t("summary.close")}
              </button>
            </>
          ) : (
            <>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-fine text-ink-tertiary">
                <span data-id="summary-live-hint" className="min-w-0">{t("summary.liveHint")}</span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5">Esc</kbd>
                  {t("summary.close")}
                </span>
              </span>
              <button
                type="button"
                data-id="summary-close"
                className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                onClick={onClose}
              >
                {t("summary.done")}
              </button>
            </>
          )}
        </div>
      </div>
      {/* 선행/후행 사이드 독 — 모달 카드 밖, 백드롭 좌우(백드롭은 자기 자신을 눌렀을 때만 닫힌다) */}
      <NavDock
        side="left"
        title={t("summary.prev")}
        nodes={predecessors}
        typeLabelOf={typeLabelOf}
        hiddenId={swap?.node.id ?? null}
        onPick={(node, rect) => startSwap(node, "left", rect)}
      />
      <NavDock
        side="right"
        title={t("summary.next")}
        nodes={successors}
        typeLabelOf={typeLabelOf}
        hiddenId={swap?.node.id ?? null}
        onPick={(node, rect) => startSwap(node, "right", rect)}
      />
      {/* 전환 고스트 — 클릭한 독 카드의 자리에서 시작해 가운데로 커지며 사라진다 */}
      {swap && (
        <div
          data-id="summary-swap-ghost"
          aria-hidden
          className="summary-swap-in absolute z-10 flex items-center gap-2 rounded-md border border-accent-tint-border bg-surface px-2.5 py-2 shadow-lg"
          style={{ ...swap.box, ...swap.ghostVars }}
        >
          <DockCardBody node={swap.node} typeLabelOf={typeLabelOf} />
        </div>
      )}
      {renderPopover()}
    </ModalBackdrop>
  );
}
