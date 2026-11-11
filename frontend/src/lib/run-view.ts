// 실행 체크(Run) 화면 파생 — 실행 상세와 범위별 그래프에서 노드 상태·연결선 종류·진행률을 노드 키로 모은다(렌더 전용).
// 노드 키는 에디터 임베드 id(`embedId`)와 같은 꼴(`{범위}/{노드}`, 최상위는 노드 id)이라 displayNodes·styledEdges가
// 노드·연결선 id로 바로 찾는다. 상태 계산은 lib/run-graph. 설계: 2026-11-04-run-check-design.md §4.3.

import { MarkerType, type Edge } from "@xyflow/react";

import { getApiErrorDetail, type FlatNode, type GraphEdge, type RunDetail, type RunSummaryInfo } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  countRunProgress,
  deriveRunStatuses,
  getRunEdgeKind,
  toRunGraph,
  type RunEdgeKind,
  type RunGraph,
  type RunNodeStatus,
  type RunScopeState,
} from "@/lib/run-graph";
import { EMBED_SEP, embedId } from "@/lib/subprocess-embed";

type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface RunView {
  statusByKey: Map<string, RunNodeStatus>;
  edgeKindByKey: Map<string, RunEdgeKind>;
  progress: { done: number; total: number };
}

export function toRunNodeKey(scopePath: string, nodeId: string): string {
  return scopePath ? embedId(scopePath, nodeId) : nodeId;
}

/** 노드 키 → 범위 경로 + 노드 id(마지막 구분자 기준). 구분자가 없으면 최상위. */
export function splitRunNodeKey(key: string): { scopePath: string; nodeId: string } {
  const cut = key.lastIndexOf(EMBED_SEP);
  return cut < 0 ? { scopePath: "", nodeId: key } : { scopePath: key.slice(0, cut), nodeId: key.slice(cut + EMBED_SEP.length) };
}

function createEmptyScopeState(closed: boolean): RunScopeState {
  return { manual: {}, choice: {}, exit: {}, closed };
}

/**
 * 모든 범위를 닫고 읽는 실행 — 중단은 남은 단계가 건너뜀이고, 요약은 상태·범위 행을 지운 뒤라 기록 없이 열면
 * 새 실행처럼 첫 단계가 열려 보인다(흐르는 점·동작 없이 닫힌 실행으로 읽는다).
 */
function isRunClosedForView(detail: RunDetail): boolean {
  return detail.status === "stopped" || detail.status === "summarized";
}

/** 상태 행·고정 범위 → 범위별 엔진 입력. 최상위(`""`)는 늘 있다. 중단·요약된 실행은 모든 범위가 닫혀 남은 단계가 건너뜀. */
export function buildRunScopeStates(detail: RunDetail): Map<string, RunScopeState> {
  const isClosedRun = isRunClosedForView(detail);
  const states = new Map<string, RunScopeState>([["", createEmptyScopeState(isClosedRun)]]);
  const ensureState = (scopePath: string): RunScopeState => {
    const found = states.get(scopePath);
    if (found) return found;
    const created = createEmptyScopeState(isClosedRun);
    states.set(scopePath, created);
    return created;
  };
  for (const scope of detail.scopes) {
    ensureState(scope.scope_path).closed = scope.closed || isClosedRun;
  }
  for (const row of detail.states) {
    const state = ensureState(row.scope_path);
    state.manual[row.node_id] = row.status;
    if (row.chosen_edge_id !== null) state.choice[row.node_id] = row.chosen_edge_id;
    if (row.exit_key !== null) state.exit[row.node_id] = row.exit_key;
  }
  return states;
}

function getScopeDepth(scopePath: string): number {
  return scopePath === "" ? 0 : scopePath.split(EMBED_SEP).length;
}

/**
 * 실행이 아직 고정하지 않은 하위 범위(펼쳐서 보기만 한 하위 맵)의 상태 — 기록이 없다. 호스트를 들어가지 않고
 * 바로 완료했으면 남은 단계는 건너뜀이다(BE `_assert_hosts_reachable`과 같은 판정).
 * 범위 경로는 바깥 범위에서 호스트의 노드 키와 같다.
 */
function buildUnpinnedScopeState(scopePath: string, statusByKey: ReadonlyMap<string, RunNodeStatus>, isClosedRun: boolean): RunScopeState {
  return createEmptyScopeState(isClosedRun || statusByKey.get(scopePath) === "done");
}

// 막힌 호스트 상태 → 그 하위 범위의 연결선 종류(R22) — 대기면 앞이 안 끝남, 건너뜀이면 건너뜀(흐르는 점 없음)
const BLOCKED_EDGE_KIND: Readonly<Record<"waiting" | "skipped", RunEdgeKind>> = { waiting: "fut", skipped: "skip" };

/** 하위 범위의 호스트가 대기·건너뜀이면 그 상태(서버도 그 아래 동작을 409로 막는다), 아니면 null. 최상위는 늘 null. */
function getBlockedHostStatus(scopePath: string, statusByKey: ReadonlyMap<string, RunNodeStatus>): "waiting" | "skipped" | null {
  if (scopePath === "") return null;
  const host = statusByKey.get(scopePath);
  return host === "waiting" || host === "skipped" ? host : null;
}

/** 범위 경로 → 그래프(최상위 `""`)에서 노드 상태·연결선 종류를 노드 키로. 그래프가 아직 없는 범위는 건너뛴다. */
export function buildRunView(detail: RunDetail, graphs: ReadonlyMap<string, RunGraph>): RunView {
  const states = buildRunScopeStates(detail);
  const isClosedRun = isRunClosedForView(detail);
  const statusByKey = new Map<string, RunNodeStatus>();
  const edgeKindByKey = new Map<string, RunEdgeKind>();
  let progress = detail.progress;
  // 바깥 범위부터 — 고정 안 된 하위 범위는 호스트 상태를 먼저 알아야 한다
  const ordered = [...graphs].sort(
    ([a], [b]) => getScopeDepth(a) - getScopeDepth(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [scopePath, graph] of ordered) {
    const state = states.get(scopePath) ?? buildUnpinnedScopeState(scopePath, statusByKey, isClosedRun);
    const statuses = deriveRunStatuses(graph, state);
    // 호스트가 대기·건너뜀인 하위 맵은 기록과 무관하게 시작 노드 말고 전부 그 상태로 읽힌다(R22). 바깥부터 돌아서
    // 손자 맵은 이미 대기·건너뜀이 된 하위 호스트를 보고 같은 규칙을 탄다
    const blocked = getBlockedHostStatus(scopePath, statusByKey);
    const nodeTypeById = new Map(graph.nodes.map((node) => [node.id, node.nodeType]));
    for (const [nodeId, status] of Object.entries(statuses)) {
      const shown = blocked !== null && nodeTypeById.get(nodeId) !== "start" ? blocked : status;
      statusByKey.set(toRunNodeKey(scopePath, nodeId), shown);
    }
    for (const edge of graph.edges) {
      const kind = blocked !== null ? BLOCKED_EDGE_KIND[blocked] : getRunEdgeKind(graph, state, statuses, edge);
      edgeKindByKey.set(toRunNodeKey(scopePath, edge.id), kind);
    }
    if (scopePath === "") progress = countRunProgress(graph, state);
  }
  return { statusByKey, edgeKindByKey, progress };
}

function stripScopePrefix(scopePath: string, id: string): string {
  const prefix = scopePath + EMBED_SEP;
  return scopePath && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function appendTo<V>(groups: Map<string, V[]>, key: string, value: V): void {
  const group = groups.get(key);
  if (group) group.push(value);
  else groups.set(key, [value]);
}

/**
 * 에디터 합성 트리(fullGraph: 루트 + 펼친 하위 맵, 임베드 id `{호스트}/{원래 id}`) → 범위별 실행 그래프(원래 id).
 * 하위 범위의 그래프는 합성 트리가 끼운 것(실행이 고정한 버전이 있으면 그것)을 그대로 쓴다.
 */
export function splitRunScopeGraphs(composite: {
  nodes: readonly FlatNode[];
  edges: readonly GraphEdge[];
}): Map<string, RunGraph> {
  const scopeOfNode = new Map<string, string>();
  const nodesByScope = new Map<string, FlatNode[]>();
  for (const node of composite.nodes) {
    const scopePath = node.parent_node_id ?? "";
    scopeOfNode.set(node.id, scopePath);
    appendTo(nodesByScope, scopePath, { ...node, id: stripScopePrefix(scopePath, node.id) });
  }
  const edgesByScope = new Map<string, GraphEdge[]>();
  for (const edge of composite.edges) {
    const scopePath = scopeOfNode.get(edge.source_node_id);
    if (scopePath === undefined) continue; // 출발이 합성 트리에 없는 연결선 — 실행 계산에서도 빠진다
    appendTo(edgesByScope, scopePath, {
      ...edge,
      id: stripScopePrefix(scopePath, edge.id),
      source_node_id: stripScopePrefix(scopePath, edge.source_node_id),
      target_node_id: stripScopePrefix(scopePath, edge.target_node_id),
    });
  }
  return new Map(
    [...nodesByScope].map(([scopePath, nodes]) => [
      scopePath,
      toRunGraph({ nodes, edges: edgesByScope.get(scopePath) ?? [], groups: [] }),
    ]),
  );
}

// 연결선 종류별 선 — 목업 buildEdgePalette() 공식을 globals.css 토큰으로 옮긴 것. 굵은 선은 지나온·지금·문제 길.
// 캔버스(applyRunEdgeKind)와 범례 견본(components/run/run-legend)이 같이 쓴다
export const RUN_EDGE_LOOK: Readonly<Record<RunEdgeKind, { stroke: string; strokeWidth: number }>> = {
  past: { stroke: "var(--color-run-done)", strokeWidth: 2 },
  now: { stroke: "var(--color-run-edge-now-base)", strokeWidth: 2 },
  prob: { stroke: "var(--color-run-problem)", strokeWidth: 2 },
  fut: { stroke: "var(--color-run-edge-fut)", strokeWidth: 1.5 },
  skip: { stroke: "var(--color-run-edge-skip)", strokeWidth: 1.5 },
};

// 실행 모드 캔버스 워터마크 글자 크기(px) — 게시 워터마크(120px)를 넘지 않고, 긴 이름은 한 줄에 들어가게 줄인다(하한 44px).
// 한글은 라틴보다 넓어 글자 폭을 따로 센다. 캔버스는 넘치는 부분을 잘라 낸다(overflow hidden)
const RUN_WATERMARK_MAX_PX = 120;
const RUN_WATERMARK_MIN_PX = 44;
const RUN_WATERMARK_SPAN_PX = 1100; // 기울인 한 줄이 차지할 너비 기준 — 보통 캔버스 폭(1,100~1,300px)

/** 워터마크에 싣는 이름 글자 수 상한 — 넘으면 앞부분에 말줄임. 전체 이름은 위 Run 막대에 있다. */
export const RUN_WATERMARK_MAX_CHARS = 20;

/** 워터마크 문구 — 긴 이름은 앞 20자만(하한 글자 크기로도 한 줄에 못 들어가 조각나 노드를 덮던 문제). */
export function getRunWatermarkText(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= RUN_WATERMARK_MAX_CHARS) return chars.join("");
  return `${chars.slice(0, RUN_WATERMARK_MAX_CHARS).join("").trimEnd()}…`;
}

/** 실행 이름 워터마크 글자 크기 — 넓은 글자(한글·한자) 1, 나머지 0.6 폭으로 세어 기준 너비에 맞춘다.
 * spanPx는 실제 캔버스 폭(양쪽 패널이 열리면 기준 너비보다 좁다) — 기준 너비를 넘겨 키우지는 않는다. */
export function getRunWatermarkFontSize(name: string, spanPx: number = RUN_WATERMARK_SPAN_PX): number {
  let ems = 0;
  for (const ch of name) ems += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.6;
  if (ems === 0) return RUN_WATERMARK_MAX_PX;
  return Math.round(Math.min(RUN_WATERMARK_MAX_PX, Math.max(RUN_WATERMARK_MIN_PX, Math.min(spanPx, RUN_WATERMARK_SPAN_PX) / ems)));
}

/** 갈래 버튼에 올리거나 포커스한 동안의 미리보기 — 같은 노드의 갈래 연결선 키 전부와 그중 지금 가리키는 것(노드 키 꼴). */
export interface RunBranchPreview {
  siblingKeys: ReadonlySet<string>;
  activeKeys: ReadonlySet<string>;
}

/**
 * 갈래 미리보기 — 가리킨 갈래 선만 지금 갈 길처럼(악센트 + 흐르는 점) 살리고 같은 노드의 다른 갈래는 흐리게 끈다
 * (`data.runPreview`, multiline-edge가 선·라벨을 흐린다). 갈래가 아닌 연결선은 그대로. applyRunEdgeKind 뒤에 쓴다.
 */
export function applyRunBranchPreview(edge: Edge, preview: RunBranchPreview | null): Edge {
  if (preview === null || !preview.siblingKeys.has(edge.id)) return edge;
  if (!preview.activeKeys.has(edge.id)) {
    return { ...edge, data: { ...edge.data, runFlow: false, runPreview: "off" } };
  }
  const stroke = RUN_EDGE_LOOK.now.stroke;
  return {
    ...edge,
    style: { ...edge.style, stroke, strokeWidth: 2.5, strokeDasharray: undefined, opacity: 1 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
    data: { ...edge.data, runFlow: true, runPreview: "on" },
  };
}

/**
 * 실행 모드 연결선 모양 — 종류별 선·화살표 색, 지금 갈 길만 `data.runFlow`(흐르는 점, multiline-edge). 편집 화면의
 * 행진 점선(animated)은 끈다. 종류가 없는 연결선(펼침 게이트웨이 등)은 그대로 둔다.
 */
export function applyRunEdgeKind(edge: Edge, kind: RunEdgeKind | undefined): Edge {
  if (kind === undefined) return edge;
  const look = RUN_EDGE_LOOK[kind];
  return {
    ...edge,
    animated: false,
    style: {
      ...edge.style,
      stroke: look.stroke,
      strokeWidth: look.strokeWidth,
      ...(kind === "skip" ? { strokeDasharray: "4 4", opacity: 0.5 } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: look.stroke },
    data: { ...edge.data, runFlow: kind === "now" },
  };
}

// 서버 실행 에러 detail(영어 고정 문구, BE app/run_service.py ERR_*) → i18n. 전방일치
const RUN_ERROR_KEYS: [string, MessageKey][] = [
  ["action not allowed in this state", "run.err.stale"],
  ["open solo run limit reached", "run.err.soloCap"],
  ["open shared run limit reached", "run.err.sharedCap"],
  ["keep limit reached", "run.err.keepCap"],
  ["cannot view the subprocess map", "run.err.subAccess"],
  ["subprocess map has no published version", "run.err.subNotPublished"],
  ["subprocess map is unavailable", "run.err.subUnavailable"],
  ["run is not open", "run.err.notOpen"],
  // 하위 맵 기록이 있는 하위프로세스 취소 — 확인 후 cascade로 다시 보내는 흐름은 버튼 줄(Task 12)이 맡는다
  ["subprocess has progress", "run.err.subProgress"],
  ["only participants can change this run", "run.err.participantOnly"],
  ["only the starter can do this", "run.err.starterOnly"],
  ["summarized runs cannot be changed", "run.err.summarized"],
  ["node is not actionable", "run.err.notActionable"],
  ["comment not found", "run.err.commentNotFound"],
  ["only the author can change this comment", "run.err.authorOnly"],
];
const TOUCHED_AFTER_PREFIX = "later steps already changed: ";
// 자리값이 든 서버 문구 — BE ERR_PARTICIPANT_ACCESS("participant {login} cannot view this map")·load_visible_run 404
const PARTICIPANT_ACCESS_PATTERN = /^participant (.+) cannot view this map$/;
const RUN_NOT_FOUND_PATTERN = /^run \d+ not found$/;

// 실행할 수 있는 버전 — 게시본과 지난 게시본만(design §4.1). 업무 체계 캔버스는 실행 대상이 아니다(BE ERR_FRAMEWORK)
const RUNNABLE_VERSION_STATUSES: ReadonlySet<string> = new Set(["published", "expired"]);

/**
 * 헤더 Run 메뉴의 모양 — start=이 버전에서 새 Run, goPublished=Draft·결재 중·거절이라 게시본으로 보내는 메뉴,
 * noPublished=Run할 버전이 아직 없어 꺼짐, framework=업무 체계 캔버스라 꺼짐(사용자 결정 2026-11-09: Draft에서 막지 말고 게시본으로 안내).
 */
export type RunMenuMode = "start" | "goPublished" | "noPublished" | "framework";

export function getRunMenuMode(status: string, isFrameworkMap: boolean, hasRunnableVersion: boolean): RunMenuMode {
  if (isFrameworkMap) return "framework";
  if (RUNNABLE_VERSION_STATUSES.has(status)) return "start";
  return hasRunnableVersion ? "goPublished" : "noPublished";
}

/** "게시본으로 가기"가 갈 버전 — 지금 게시본, 없으면 가장 최근의 지난 게시본(versions는 최신 먼저). 없으면 null. */
export function findRunnableVersionId(versions: readonly { id: number; status: string }[]): number | null {
  return (versions.find((v) => v.status === "published") ?? versions.find((v) => RUNNABLE_VERSION_STATUSES.has(v.status)))?.id ?? null;
}

/** 헤더 Run 버튼이 꺼지는 이유(툴팁 문구 키) — 켜져 있으면(새 Run·게시본으로 가기) null. */
export function getRunMenuDisabledReason(mode: RunMenuMode): MessageKey | null {
  if (mode === "framework") return "run.menu.disabledFramework";
  return mode === "noPublished" ? "run.menu.disabledNoPublished" : null;
}

/** 새 실행이 열린 실행 상한(409)에 막혔는지 — 개인(사람당)·공유(맵당) 중 어느 쪽인지. 다른 에러면 null. */
export function getRunCapKind(err: unknown): "solo" | "shared" | null {
  const detail = getApiErrorDetail(err);
  if (detail.startsWith("open solo run limit reached")) return "solo";
  if (detail.startsWith("open shared run limit reached")) return "shared";
  return null;
}

/** 하위 맵 기록이 있는 하위프로세스 취소(409) — 버튼 줄이 "하위 맵 기록도 모두 취소돼요" 확인을 띄우고 cascade로 다시 보낸다(R5). */
export function isRunSubProgressError(err: unknown): boolean {
  return getApiErrorDetail(err).startsWith("subprocess has progress");
}

/**
 * 뒤 단계가 이미 진행된 완료 취소(409)의 첫 막은 단계 이름 — 아니면 null. 버튼 줄이 뒤 단계 취소 확인을 띄우고
 * downstream으로 다시 보낸다(화면이 못 본 뒤 단계: 다른 참여자가 방금 손댐·못 보는 하위 범위).
 */
export function getRunTouchedAfterTitle(err: unknown): string | null {
  const detail = getApiErrorDetail(err);
  return detail.startsWith(TOUCHED_AFTER_PREFIX) ? detail.slice(TOUCHED_AFTER_PREFIX.length) : null;
}

export function humanizeRunError(err: unknown, t: TFunc): string {
  const detail = getApiErrorDetail(err);
  if (detail.startsWith(TOUCHED_AFTER_PREFIX)) {
    return t("run.err.touchedAfter", { title: detail.slice(TOUCHED_AFTER_PREFIX.length) });
  }
  const participant = PARTICIPANT_ACCESS_PATTERN.exec(detail);
  if (participant) return t("run.err.participantAccess", { login: participant[1] });
  if (RUN_NOT_FOUND_PATTERN.test(detail)) return t("run.err.notFound");
  const hit = RUN_ERROR_KEYS.find(([prefix]) => detail.startsWith(prefix));
  return hit ? t(hit[1]) : humanizeApiError(err, t);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 끝난 실행이 요약만 남기까지 남은 날(올림) — 지났으면 0(밤 정리 잡이 곧 처리), 날짜가 없거나 읽을 수 없으면 null. */
export function formatSummaryCountdown(summarizeAfter: string | null, now: Date): number | null {
  if (summarizeAfter === null) return null;
  const at = Date.parse(summarizeAfter);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / DAY_MS));
}

// 실행 기간은 KST 달력 날짜 기준 — 브라우저 시간대와 무관하게 서버가 세는 "며칠"과 같다
const KST_YMD_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

interface KstYmd {
  year: number;
  month: number;
  day: number;
}

function getKstYmd(iso: string): KstYmd {
  const parts = Object.fromEntries(KST_YMD_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function formatMonthDay(ymd: KstYmd, t: TFunc): string {
  return t("run.list.periodDay", { m: ymd.month, d: ymd.day });
}

/** 끝난 날 한 줄 표기("9월 12일", en "9/12") — KST. */
export function formatRunDay(iso: string, t: TFunc): string {
  return formatMonthDay(getKstYmd(iso), t);
}

/** 실행 기간 — 같은 날이면 "9월 21일 하루", 아니면 "9월 12일~14일(3일)"(달이 다르면 "9월 30일~10월 2일(3일)"), KST 달력 날짜 기준. */
export function formatRunPeriod(startedAt: string, endedAt: string, t: TFunc): string {
  const start = getKstYmd(startedAt);
  const end = getKstYmd(endedAt);
  const days = Math.round((Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / DAY_MS) + 1;
  // 끝이 시작보다 앞서는 값(시계 어긋남)도 하루로 접는다
  if (days <= 1) return t("run.list.periodOne", { start: formatMonthDay(start, t) });
  const isSameMonth = start.year === end.year && start.month === end.month;
  return t("run.list.periodRange", {
    start: formatMonthDay(start, t),
    end: isSameMonth ? t("run.list.periodDayOnly", { d: end.day }) : formatMonthDay(end, t),
    n: days,
  });
}

/** 요약된 실행의 부제 조각 — 기간 · 버전 · 문제 단계 수(있을 때만). 모든 실행 창의 요약 줄과 실행 바가 같이 쓴다. */
export function formatRunSummaryParts(summary: RunSummaryInfo, t: TFunc): string[] {
  const versionMarker = summary.version_number !== null ? `v${summary.version_number}` : summary.version_label;
  const parts = [formatRunPeriod(summary.started_at, summary.ended_at, t), versionMarker];
  if (summary.problem_steps > 0) parts.push(t("run.list.problemSteps", { n: summary.problem_steps }));
  return parts;
}

/** 실행 숫자 설정 입력 초안(문자열 그대로 — 입력 중 빈 칸을 허용). */
export interface RunLimitsDraft {
  warn: string;
  stop: string;
  summary: string;
  openSolo: string;
  openShared: string;
  keepShared: string;
  keepSolo: string;
}

// 서버 범위(schemas.AppSettingsUpdate)와 같다 — 일수 1~3650, 상한 1~1000
const RUN_DAYS_RANGE = { lo: 1, hi: 3650 };
const RUN_CAP_RANGE = { lo: 1, hi: 1000 };

function isIntInRange(raw: string, range: { lo: number; hi: number }): boolean {
  if (raw.trim() === "") return false;
  const value = Number(raw);
  return Number.isInteger(value) && value >= range.lo && value <= range.hi;
}

/** 저장 전 검사 — 범위 밖 정수이거나 자동 중단 일수가 방치 알림 일수 이하면 안내 문구 키, 통과면 null. */
export function validateRunLimits(draft: RunLimitsDraft): MessageKey | null {
  const days = [draft.warn, draft.stop, draft.summary];
  const caps = [draft.openSolo, draft.openShared, draft.keepShared, draft.keepSolo];
  if (!days.every((raw) => isIntInRange(raw, RUN_DAYS_RANGE))) return "run.admin.invalidNumber";
  if (!caps.every((raw) => isIntInRange(raw, RUN_CAP_RANGE))) return "run.admin.invalidNumber";
  // 서버는 stop을 warn+1로 올려 쓰지만, 관리자가 입력한 값과 실제 동작이 어긋나지 않게 입력 단계에서 막는다
  if (Number(draft.stop) <= Number(draft.warn)) return "run.admin.stopAfterWarn";
  return null;
}
