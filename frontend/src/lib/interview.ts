// AI 컨설턴트 인터뷰 — 순수 헬퍼: 스테이지 상수·선택지 추출·작업본 diff·dagre 배치 (design 2026-07-23)

import { MarkerType, type Edge } from "@xyflow/react";

import type { ChoiceOption, InterviewMessage, WorkingGraph } from "./api";
import type { AppNode } from "./canvas";
import { nodeSizeOf, normalizeNodeType } from "./canvas";
import { autoLayoutFlow } from "./flow-layout";

// 백엔드 engine.STAGES와 키·순서 동기 — 변경 시 양쪽 함께 (UI 라벨은 영어 고정)
export const INTERVIEW_STAGES = [
  { key: "scope", label: "Scope" },
  { key: "io", label: "Inputs & Outputs" },
  { key: "activities", label: "Activities" },
  { key: "branches", label: "Branches" },
  { key: "roles", label: "Roles & Systems" },
  // params는 고정 스테이지에서 제외(2026-07-28) — 수시 수집 + 표 확정으로 대체
  { key: "review", label: "Review" },
] as const;

// 백엔드 engine.WORD_STAGES와 키·순서 동기 — word 변환 모드 3단계 (design 2026-07-26 §3)
export const WORD_INTERVIEW_STAGES = [
  { key: "scope", label: "Scope" },
  { key: "draft", label: "Draft" },
  { key: "review", label: "Review" },
] as const;

export function stagesForMode(
  mode: string | undefined,
): readonly { readonly key: string; readonly label: string }[] {
  return mode === "word" ? WORD_INTERVIEW_STAGES : INTERVIEW_STAGES;
}

export function stageIndex(key: string, mode?: string): number {
  return stagesForMode(mode).findIndex((s) => s.key === key);
}

// ---------- facts 아웃라인 (speed redesign §6 — AI 0콜, 매 턴 즉시 반응) ----------

export interface OutlineEntry {
  stage: string;
  label: string;
  items: [string, string][];
}

const OUTLINE_VALUE_MAX = 60; // 항목 값 1줄 요약 — 패널 폭 안에서 잘리지 않게

function clampOutlineValue(value: string): string {
  return value.length > OUTLINE_VALUE_MAX ? value.slice(0, OUTLINE_VALUE_MAX - 1) + "…" : value;
}

function outlineValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" · ");
  return String(value ?? "");
}

// facts를 스테이지 순서로 평탄화 — 확정 항목만, 값은 1줄 요약
export function deriveOutline(
  facts: Record<string, Record<string, unknown>> | null | undefined,
  mode?: string,
): OutlineEntry[] {
  if (!facts) return [];
  const entries: OutlineEntry[] = [];
  for (const stage of stagesForMode(mode)) {
    const stageFacts = facts[stage.key];
    if (!stageFacts) continue;
    const items = Object.entries(stageFacts)
      .filter(([, value]) => outlineValueText(value).trim() !== "")
      .map(([key, value]): [string, string] => [key, clampOutlineValue(outlineValueText(value))]);
    if (items.length > 0) entries.push({ stage: stage.key, label: stage.label, items });
  }
  return entries;
}

// activities facts에서 열거형 값을 찾아 시퀀스 미리보기(최대 8) — 배열 우선, 구분자 문자열 폴백
export function deriveSequencePreview(
  facts: Record<string, Record<string, unknown>> | null | undefined,
): string[] {
  const activityFacts = facts?.["activities"];
  if (!activityFacts) return [];
  for (const value of Object.values(activityFacts)) {
    if (Array.isArray(value) && value.length >= 2) {
      return value.map(String).slice(0, 8);
    }
  }
  for (const value of Object.values(activityFacts)) {
    if (typeof value !== "string") continue;
    for (const sep of ["→", "·", ","]) {
      const parts = value.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.every((p) => p.length <= 40)) {
        return parts.slice(0, 8);
      }
    }
  }
  return [];
}

// ---------- params 표 (수집 → 확정 → 결정적 반영, speed redesign 후속) ----------

export const PARAM_TABLE_KEYS = [
  "duration", "touch_time", "cost_krw", "cost_usd", "headcount", "annual_count", "fte",
] as const;

export interface ParamsTableRow {
  activity: string;
  values: Record<string, string>;
  // 작업본 노드 타입 — SP 필드 게이팅용(deriveParamsEditorRows만 채움, 미지정=process 취급)
  nodeType?: string;
}

// facts.params.params_table → 표 행 — 확인된 필드만, 빈 행 제거
export function deriveParamsTable(
  facts: Record<string, Record<string, unknown>> | null | undefined,
): ParamsTableRow[] {
  const table = facts?.["params"]?.["params_table"];
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  return Object.entries(table as Record<string, unknown>)
    .filter(([, values]) => values && typeof values === "object" && !Array.isArray(values))
    .map(([activity, values]) => ({
      activity,
      values: Object.fromEntries(
        Object.entries(values as Record<string, unknown>)
          .filter(([key, value]) =>
            (PARAM_TABLE_KEYS as readonly string[]).includes(key) &&
            String(value ?? "").trim() !== "")
          .map(([key, value]): [string, string] => [key, String(value)]),
      ),
    }))
    .filter((row) => Object.keys(row.values).length > 0);
}

// params 편집 표의 행 — 수집분만이 아니라 **작업본의 모든 활동**을 나열해 어느 노드든
// 채팅 없이 값을 넣을 수 있게 한다. 맵에 없는 수집 항목(제목 불일치)은 뒤에 유지 (2026-07-30).
export function deriveParamsEditorRows(
  graph: WorkingGraph | null | undefined,
  facts: Record<string, Record<string, unknown>> | null | undefined,
): ParamsTableRow[] {
  const collected = new Map(deriveParamsTable(facts).map((row) => [row.activity, row.values]));
  const rows: ParamsTableRow[] = [];
  const seen = new Set<string>();
  for (const node of graph?.nodes ?? []) {
    if (node.node_type === "start" || node.node_type === "end") continue;
    const title = (node.title ?? "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    rows.push({ activity: title, values: collected.get(title) ?? {}, nodeType: node.node_type });
  }
  for (const [activity, values] of collected) {
    if (!seen.has(activity)) rows.push({ activity, values });
  }
  return rows;
}

export interface GraphDiffKeys {
  added: Set<string>;
  changed: Set<string>;
}

// 제안 안의 현재 작업본 대비 diff — 새 제목=added, 같은 제목·내용(설명/attributes) 변경=changed.
// 안끼리 비교(distinctiveNodeKeys)를 대체 — 안들이 비슷하면 아무것도 표시되지 않던 문제 (2026-07-30).
export function diffFromCurrentKeys(
  graph: WorkingGraph,
  current: WorkingGraph | null | undefined,
): GraphDiffKeys {
  const contentOf = (node: WorkingGraph["nodes"][number]): string =>
    JSON.stringify([
      (node.description ?? "").trim(),
      Object.entries(node.attributes ?? {})
        .filter(([, value]) => String(value ?? "").trim() !== "")
        .map(([key, value]) => [key, String(value).trim()])
        .sort(),
    ]);
  const currentByTitle = new Map(
    (current?.nodes ?? []).map((node) => [node.title.trim(), contentOf(node)]),
  );
  const added = new Set<string>();
  const changed = new Set<string>();
  for (const node of graph.nodes) {
    const existing = currentByTitle.get(node.title.trim());
    if (existing === undefined) added.add(node.key);
    else if (existing !== contentOf(node)) changed.add(node.key);
  }
  return { added, changed };
}

export function choiceOptionsOf(messages: InterviewMessage[]): ChoiceOption[] | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "consultant" || last.kind !== "choices") return null;
  const options = (last.payload as { options?: ChoiceOption[] } | null)?.options;
  return options && options.length > 0 ? options : null;
}

export function addedNodeKeys(
  prev: WorkingGraph | null,
  next: WorkingGraph | null,
): Set<string> {
  if (!prev || !next) return new Set(); // 첫 그래프는 전체가 신규 — 하이라이트 안 함
  const before = new Set(prev.nodes.map((n) => n.key));
  return new Set(next.nodes.filter((n) => !before.has(n.key)).map((n) => n.key));
}

export function layoutWorkingGraph(
  graph: WorkingGraph | null,
  added: Set<string>,
  changed?: Set<string>,
): { nodes: AppNode[]; edges: Edge[] } {
  if (!graph || graph.nodes.length === 0) return { nodes: [], edges: [] };
  const nodes: AppNode[] = graph.nodes.map((n) => {
    const nodeType = normalizeNodeType(n.node_type);
    return {
      id: n.key,
      type: "process",
      position: { x: 0, y: 0 },
      width: nodeSizeOf(nodeType).w,
      height: nodeSizeOf(nodeType).h,
      data: {
        label: n.title,
        description: n.description,
        nodeType,
        color: "",
        assignee: "",
        department: "",
        system: "",
        duration: "",
        groupIds: [],
        hasChildren: false,
        sideHandles: true,
        diffStatus: added.has(n.key)
          ? ("added" as const)
          : changed?.has(n.key)
            ? ("changed" as const)
            : undefined,
      },
    } as AppNode;
  });
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
  }));
  return autoLayoutFlow(nodes, edges, "LR");
}


/** 포커스 노드에 닿는 엣지 강조 — 선택 링과 같은 액센트로 입출 흐름을 드러낸다 (2026-07-30).
 *  keys가 비면 원본 그대로(레이아웃 메모 재사용). zIndex로 이웃 엣지 위로 올린다. */
export function highlightConnectedEdges(edges: Edge[], keys: ReadonlySet<string>): Edge[] {
  if (keys.size === 0) return edges;
  return edges.map((e) =>
    keys.has(e.source) || keys.has(e.target)
      ? {
          ...e,
          style: { ...e.style, stroke: "var(--color-accent)", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-accent)" },
          zIndex: 1,
        }
      : e,
  );
}


// BE orchestrator._graph_signature와 동형 — 설명·attributes 차이는 무시(화면상 같아 보이는
// 그래프는 같은 서명). 프리뷰 카메라 리셋 게이팅용 (hardening T12).
export function getGraphSignature(graph: WorkingGraph | null): string {
  if (!graph) return "";
  const titles = new Map(graph.nodes.map((n) => [n.key, (n.title ?? "").trim()]));
  const nodes = graph.nodes
    .map((n) => `${n.node_type}|${(n.title ?? "").trim()}|${n.group_key ?? ""}`)
    .sort();
  const edges = graph.edges
    .map((e) => `${titles.get(e.source) ?? ""}>${titles.get(e.target) ?? ""}|${(e.label ?? "").trim()}`)
    .sort();
  return `${nodes.join(";")}#${edges.join(";")}`;
}

// 패스트트랙 문구 — BE 인사 보기(_FAST_TRACK_OPTION)·인터뷰어 룰 15와 글자 단위 동일(단일 소스는
// 여기, design 2026-07-29 §3). 인터뷰어가 다른 문구를 내면 클릭은 일반 턴으로 흘러간다(무해).
export const FAST_TRACK_START_LABELS = ["문서로 바로 그리기", "Draw from a document"];
export const FAST_TRACK_CONFIRM_LABELS = ["이대로 그리기", "Draw it as proposed"];
export const FAST_TRACK_NORMAL_LABELS = ["일반 인터뷰로 진행", "Continue the full interview"];
export const FAST_TRACK_SCOPE_MESSAGE: Record<string, string> = {
  ko: "이 문서로 프로세스 맵을 그리고 싶어요. 이름·목적·범위를 먼저 제안해 주세요.",
  en: "I'd like to draw the process map from this document. Please propose the name, purpose, and scope first.",
};

// Draw 확인 다이얼로그용 마크다운 서머리 — 아웃라인 항목을 스테이지별 불릿으로 (2026-07-30)
export function buildDrawSummary(entries: OutlineEntry[]): string {
  if (entries.length === 0) {
    return "_No details collected yet - the map will be drawn from the conversation so far._";
  }
  return entries
    .map((entry) => `**${entry.label}**\n${entry.items.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`)
    .join("\n\n");
}
