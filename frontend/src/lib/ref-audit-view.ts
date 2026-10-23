// 고아 참조 화면 순수 로직 — 히어로(숫자·범위 칩·경우 8종)·카드·상세 창(줄 판정·미리보기 병합·적용 묶음·토스트). 컴포넌트는 렌더만 한다 (design 2026-10-23 §9).
import { FilePlus2, Lock, Stamp, type LucideIcon } from "lucide-react";

import type {
  RefApplyBody,
  RefApplyResult,
  RefAuditData,
  RefAuditScope,
  RefCard,
  RefCardLine,
  RefOutcome,
  RefPreviewLine,
  RefSkipReason,
  RefSource,
  RefTarget,
  RefVersionStatus,
} from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  OUTCOME_META,
  OUTCOME_ORDER,
  REMOVE_BLOCKED,
  buildRingGradient,
  forecastOutcomes,
  isLineCheckable,
  isPendingOnly,
  summarizeMapRows,
  tallyCard,
  type Bucket,
  type CardTally,
  type MapRow,
} from "@/lib/ref-audit";

export interface HeroStats {
  departments: number; // 부서 카드 수
  users: number;       // 사용자 카드 수
  fixPlaces: number;   // 고칠 곳 = 모든 카드의 fix 버킷 곳 수 합(알림·잠김·게시 대기 제외)
}

export type ScopeChipKind = "maps" | "groups" | "categories";

export interface ScopeChip {
  kind: ScopeChipKind;
  count: number;
}

/** 히어로 숫자 3개 — 첫 스캔 전(null)은 전부 0. */
export function getHeroStats(data: RefAuditData | null): HeroStats {
  if (!data) return { departments: 0, users: 0, fixPlaces: 0 };
  const fixPlaces = [...data.departments, ...data.users].reduce((sum, card) => sum + tallyCard(card).fix, 0);
  return { departments: data.departments.length, users: data.users.length, fixPlaces };
}

/** 범위 칩 — 0인 범위는 숨기고 맵·그룹·카테고리 순서를 고정한다. */
export function getScopeChips(scope: RefAuditScope | null | undefined): ScopeChip[] {
  if (!scope) return [];
  const chips: ScopeChip[] = [
    { kind: "maps", count: scope.maps },
    { kind: "groups", count: scope.groups },
    { kind: "categories", count: scope.categories },
  ];
  return chips.filter((chip) => chip.count > 0);
}

/** 결과 칩 라벨 키 — 알림은 받는 사람 역할(오너·점유자)이 있으면 그에 맞춰 부른다. */
export function getOutcomeLabelKey(outcome: RefOutcome, role?: "owner" | "holder"): MessageKey {
  if (outcome === "notify" && role === "owner") return "refAudit.notify.owner";
  if (outcome === "notify" && role === "holder") return "refAudit.notify.holder";
  return OUTCOME_META[outcome].labelKey;
}

/** 히어로 범례 — 결과 칩 7종, 적용 예고와 같은 순서. */
export const REF_AUDIT_LEGEND: readonly RefOutcome[] = OUTCOME_ORDER;

/** 범례 칩에 올리면 뜨는 한 줄 설명 키. */
export const OUTCOME_TIP_KEY: Record<RefOutcome, MessageKey> = {
  direct: "refAudit.legend.direct",
  checkout: "refAudit.legend.checkout",
  new_draft: "refAudit.legend.new_draft",
  approval: "refAudit.legend.approval",
  notify: "refAudit.legend.notify",
  locked: "refAudit.legend.locked",
  pending: "refAudit.legend.pending",
};

// ── 설명 그림 기하(viewBox 좌표) ─────────────────────────────────────────────

export const HERO_VIEWBOX = { width: 760, height: 260 } as const;

/** 그림 속 맵 설정 칩 줄 — 경우 버튼이 칩의 오른쪽 위 모서리에 붙으므로 SVG와 버튼 위치가 이 표를 같이 쓴다. 칩 폭은 en·ko 글자 폭 중 넓은 쪽에 맞춘다. */
export const SETTINGS_CHIP_Y = 48;
export const SETTINGS_CHIP_H = 24;
export const SETTINGS_CHIPS = [
  { id: "owner", x: 332, w: 70 },
  { id: "approver", x: 407, w: 106 },
  { id: "collab", x: 518, w: 96 },
  { id: "owningDept", x: 619, w: 126 },
] as const;

/** 그림 속 캡션을 두 줄로 — 가운데에 가장 가까운 공백에서 나눈다(공백이 없으면 한 줄). 좁은 틈에 긴 영어 캡션이 선을 넘지 않게. */
export function splitCaption(text: string): [string, string] {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? [text, ""] : [text.slice(0, best), text.slice(best + 1)];
}

function getPercent(value: number, total: number): number {
  return Math.round((value / total) * 10000) / 100;
}

function getPointPercent(x: number, y: number): { x: number; y: number } {
  return { x: getPercent(x, HERO_VIEWBOX.width), y: getPercent(y, HERO_VIEWBOX.height) };
}

function getChipCornerPercent(chip: (typeof SETTINGS_CHIPS)[number]): { x: number; y: number } {
  return getPointPercent(chip.x + chip.w, SETTINGS_CHIP_Y);
}

// ── 경우 8종 ────────────────────────────────────────────────────────────────

/** 제거 가능 범위 — true=전부, false=불가, people=사람만(부서는 대체만), assignee=담당자만(부서는 대체만). */
export type CaseRemove = true | false | "people" | "assignee";

export interface RefAuditCase {
  id: RefSource;            // data-id `ref-case-<id>`, 아이콘은 SOURCE_ICON[id]
  x: number;                // 그림 위 위치(%)
  y: number;
  tipV: "down" | "up";      // 설명창이 버튼 아래/위
  tipH: "center" | "end";   // 버튼 가운데 정렬 / 버튼 오른쪽 끝에 맞춰 왼쪽으로 펼침(오른쪽 끝 버튼용)
  labelKey: MessageKey;
  whereKey: MessageKey;     // 어디서 고치나
  whoKey: MessageKey;       // 누가 고칠 수 있나
  replace: boolean;
  remove: CaseRemove;
  note?: { icon: LucideIcon; key: MessageKey }; // 주의 한 줄
}

/** 그림 위 경우별 호버 도움말 8종 — 설계 §5 소스별 규칙 표를 한 줄로 줄인 것. */
export const REF_AUDIT_CASES: readonly RefAuditCase[] = [
  {
    id: "map_owner", ...getChipCornerPercent(SETTINGS_CHIPS[0]), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.map_owner.label", whereKey: "refAudit.case.map_owner.where", whoKey: "refAudit.who.owner",
    replace: true, remove: false, note: { icon: Lock, key: "refAudit.case.map_owner.note" },
  },
  {
    id: "map_approver", ...getChipCornerPercent(SETTINGS_CHIPS[1]), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.map_approver.label", whereKey: "refAudit.case.map_approver.where", whoKey: "refAudit.who.owner",
    replace: true, remove: true, note: { icon: Lock, key: "refAudit.case.map_approver.note" },
  },
  {
    id: "map_collab", ...getChipCornerPercent(SETTINGS_CHIPS[2]), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.map_collab.label", whereKey: "refAudit.case.map_collab.where", whoKey: "refAudit.who.editor",
    replace: true, remove: "people", note: { icon: Stamp, key: "refAudit.case.map_collab.note" },
  },
  {
    id: "owning_dept", ...getChipCornerPercent(SETTINGS_CHIPS[3]), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.owning_dept.label", whereKey: "refAudit.case.owning_dept.where", whoKey: "refAudit.who.owner",
    replace: true, remove: false,
  },
  {
    id: "node_dept", ...getPointPercent(584, 106), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.node_dept.label", whereKey: "refAudit.case.node_dept.where", whoKey: "refAudit.who.editor",
    replace: true, remove: "assignee", note: { icon: FilePlus2, key: "refAudit.case.node_dept.note" },
  },
  {
    id: "sp_dept", ...getPointPercent(736, 106), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.sp_dept.label", whereKey: "refAudit.case.sp_dept.where", whoKey: "refAudit.who.owner",
    replace: true, remove: "assignee",
  },
  {
    id: "group_member", ...getPointPercent(524, 206), tipV: "up", tipH: "center",
    labelKey: "refAudit.case.group_member.label", whereKey: "refAudit.case.group_member.where", whoKey: "refAudit.who.groupAdmin",
    replace: true, remove: "people",
  },
  {
    id: "category_perm", ...getPointPercent(752, 206), tipV: "up", tipH: "end",
    labelKey: "refAudit.case.category_perm.label", whereKey: "refAudit.case.category_perm.where", whoKey: "refAudit.who.categoryAdmin",
    replace: true, remove: true,
  },
];

// ── 부서·사용자 카드 ─────────────────────────────────────────────────────────

const BUCKET_ORDER: readonly Bucket[] = ["fix", "notify", "lock", "pend"];

export const BUCKET_LABEL_KEY: Record<Bucket, MessageKey> = {
  fix: "refAudit.foot.fix",
  notify: "refAudit.foot.notify",
  lock: "refAudit.foot.lock",
  pend: "refAudit.foot.pend",
};

export interface BarSegment {
  bucket: Bucket;
  weight: number; // 곳 수 — 막대 조각의 flex 비율
}

export interface CardFootItem {
  bucket: Bucket;
  labelKey: MessageKey;
  count: number;
}

export type MapRowKind = "map" | "group" | "category" | "more";

/** 맵 줄 아이콘 갈래 — summarizeMapRows의 key 접두(`map:`·`group:`·`category:`)와 접은 줄을 가른다. */
export function getMapRowKind(row: MapRow): MapRowKind {
  if (row.isMore) return "more";
  if (row.key.startsWith("group:")) return "group";
  if (row.key.startsWith("category:")) return "category";
  return "map";
}

function getBarSegments(tally: CardTally): BarSegment[] {
  return BUCKET_ORDER.filter((bucket) => tally[bucket] > 0).map((bucket) => ({ bucket, weight: tally[bucket] }));
}

function getFootItems(tally: CardTally): CardFootItem[] {
  return BUCKET_ORDER.filter((bucket) => tally[bucket] > 0).map((bucket) => ({
    bucket,
    labelKey: BUCKET_LABEL_KEY[bucket],
    count: tally[bucket],
  }));
}

/** 카드 오른쪽 위 숫자 — 곳 수만 담고 단위 글자는 붙이지 않는다. 게시 대기만 남았으면 숫자 대신 표식(null). */
function getCountText(tally: CardTally): string | null {
  return isPendingOnly(tally) ? null : String(tally.places);
}

export interface DeptCardView {
  mapRows: MapRow[];    // 걸린 맵 최대 2줄(3개 이상이면 둘째 줄이 "외 N개 맵")
  places: number;
  countText: string | null;
  isPendingOnly: boolean;
  bar: BarSegment[];
  foot: CardFootItem[];
  parentPath: string;   // 상위 경로("본부 › 부서 1"), 없으면 ""
}

/** 부서 카드 한 장에 그릴 값 — formatMore는 "외 N개 맵" 문구(번역)를 호출부가 정한다. */
export function getDeptCardView(card: RefCard, formatMore?: (rest: number) => string): DeptCardView {
  const tally = tallyCard(card);
  return {
    mapRows: summarizeMapRows(card, formatMore),
    places: tally.places,
    countText: getCountText(tally),
    isPendingOnly: isPendingOnly(tally),
    bar: getBarSegments(tally),
    foot: getFootItems(tally),
    parentPath: card.sub,
  };
}

export interface UserCardView {
  initial: string;
  ringGradient: string;
  places: number;
  countText: string | null;
  isPendingOnly: boolean;
  foot: CardFootItem[];
  sub: string;                // 로그인, 없으면 ""
  subKey: MessageKey | null;  // 로그인이 없으면 "이름만 남음" 문구 키
}

/** 사용자 카드 한 장에 그릴 값. 이니셜은 이름 첫 글자(서로게이트 쌍 안전, 라틴은 대문자). */
export function getUserCardView(card: RefCard): UserCardView {
  const tally = tallyCard(card);
  const firstChar = Array.from(card.label.trim())[0];
  return {
    initial: firstChar ? firstChar.toUpperCase() : "?",
    ringGradient: buildRingGradient(tally),
    places: tally.places,
    countText: getCountText(tally),
    isPendingOnly: isPendingOnly(tally),
    foot: getFootItems(tally),
    sub: card.sub,
    subKey: card.sub ? null : "refAudit.nameOnly",
  };
}

// ── 상세 창 ─────────────────────────────────────────────────────────────────

export type RefMode = RefApplyBody["mode"];

type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** 서버 RefApplyIn.targets 상한 — 미리보기·적용 본문 하나에 담는 줄 수. 바꾸면 백엔드 스키마와 같이 옮긴다. */
export const REF_BATCH_SIZE = 500;

const NODE_SOURCES: ReadonlySet<RefSource> = new Set<RefSource>(["node_dept", "node_assignee"]);

// 설정 줄의 내용 칸 — 그 값이 놓인 자리(히어로 경우 설명의 "어디"와 같은 문구)
const WHERE_KEY: Record<RefSource, MessageKey> = {
  map_owner: "refAudit.case.map_owner.where",
  map_approver: "refAudit.case.map_approver.where",
  map_grant: "refAudit.case.map_collab.where",
  map_collab: "refAudit.case.map_collab.where",
  owning_dept: "refAudit.case.owning_dept.where",
  sp_dept: "refAudit.case.sp_dept.where",
  sp_assignee: "refAudit.case.sp_dept.where",
  node_dept: "refAudit.case.node_dept.where",
  node_assignee: "refAudit.case.node_dept.where",
  group_member: "refAudit.case.group_member.where",
  group_user: "refAudit.case.group_member.where",
  category_perm: "refAudit.case.category_perm.where",
};

const REASON_KEY: Record<NonNullable<RefCardLine["reason"]>, MessageKey> = {
  in_workflow: "refAudit.reason.in_workflow",
  request_pending: "refAudit.reason.request_pending",
  owner_left: "refAudit.reason.owner_left",
  in_approval: "refAudit.reason.in_approval",
  framework: "refAudit.reason.framework",
  not_eligible: "refAudit.reason.not_eligible",
  group_inactive: "refAudit.reason.group_inactive",
};

const WARNING_KEY: Record<NonNullable<RefCardLine["warning"]>, MessageKey> = {
  no_access: "refAudit.warning.no_access",
  no_new_grant: "refAudit.warning.no_new_grant",
};

/** 적용이 건너뛴 이유 라벨 — 잠김 사유는 줄 메모와 같은 문구를 쓰되, 안내 문장이 붙은 in_workflow만 토스트용 짧은 라벨. */
export const SKIP_REASON_KEY: Record<RefSkipReason, MessageKey> = {
  ...REASON_KEY,
  in_workflow: "refAudit.skip.in_workflow",
  pending: "refAudit.skip.pending",
  out_of_scope: "refAudit.skip.out_of_scope",
  already_changed: "refAudit.skip.already_changed",
};

/** 줄 키 — 합친 카드엔 같은 target_id가 from_value마다 따로 있어 둘을 함께 쓴다. */
export function getLineKey(line: RefTarget): string {
  return `${line.target_id}|${line.from_value}`;
}

/** 미리보기 판정을 줄에 덮는다. 응답에 없는 줄(이미 바뀜·범위 밖)은 스캔 판정을 그대로 둔다. */
export function mergePreview(lines: RefCardLine[], previewLines: RefPreviewLine[]): RefCardLine[] {
  const byKey = new Map(previewLines.map((preview) => [getLineKey(preview), preview]));
  return lines.map((ln) => {
    const preview = byKey.get(getLineKey(ln));
    if (!preview) return ln;
    return {
      ...ln,
      outcome: preview.outcome,
      reason: preview.reason ?? null,
      notify_to: preview.notify_to ?? null,
      warning: preview.warning ?? null,
    };
  });
}

export interface LineView {
  key: string;
  checkable: boolean;
  outcome: RefOutcome;      // 칩에 보일 결과 — 제거 모드의 제거 금지 줄은 잠김으로 보인다
  detailKey: MessageKey;    // 내용 칸: 노드 줄은 노드 수, 설정 줄은 놓인 자리
  detailCount?: number;
  reasonKey?: MessageKey;
  warningKey?: MessageKey;
  reloadNote: boolean;      // 내 점유 Draft에 바로 쓰는 노드 줄 — 열어 둔 에디터는 새로 고침(설계 §10)
  recipient?: string;       // 알림 줄의 받는 사람 이름
  role?: "owner" | "holder";
}

function isRemoveBlocked(line: RefCardLine, mode: RefMode): boolean {
  return mode === "remove" && REMOVE_BLOCKED.has(line.source);
}

/** 상세 창 한 줄에 그릴 값 — 체크 가능 여부·칩 결과·내용·짧은 메모·알림 수신자. */
export function getLineView(line: RefCardLine, mode: RefMode): LineView {
  const key = getLineKey(line);
  const isNode = NODE_SOURCES.has(line.source);
  const detail: Pick<LineView, "detailKey" | "detailCount"> = isNode
    ? { detailKey: "refAudit.line.nodes", detailCount: line.count }
    : { detailKey: WHERE_KEY[line.source] };
  // 서버가 제거 금지 소스의 제거를 422로 막으므로 그 줄은 고를 수 없게 잠가 둔다
  if (isRemoveBlocked(line, mode)) {
    return { key, checkable: false, outcome: "locked", ...detail, reasonKey: "refAudit.cannotRemove", reloadNote: false };
  }
  const notifyTo = line.outcome === "notify" ? line.notify_to : null;
  return {
    key,
    checkable: isLineCheckable(line.outcome),
    outcome: line.outcome,
    ...detail,
    reasonKey: line.reason ? REASON_KEY[line.reason] : undefined,
    warningKey: line.warning ? WARNING_KEY[line.warning] : undefined,
    reloadNote: isNode && line.outcome === "direct",
    recipient: notifyTo?.name,
    role: notifyTo?.role,
  };
}

/** 체크된 줄 — 체크할 수 있는 줄 전부에서 사용자가 해제한 줄만 뺀다(판정이 바뀌어도 해제 기록은 남는다). */
export function getCheckedKeys(lines: RefCardLine[], mode: RefMode, uncheckedKeys: ReadonlySet<string>): Set<string> {
  const checked = new Set<string>();
  for (const ln of lines) {
    const view = getLineView(ln, mode);
    if (view.checkable && !uncheckedKeys.has(view.key)) checked.add(view.key);
  }
  return checked;
}

function listCheckedLines(lines: RefCardLine[], mode: RefMode, checkedKeys: ReadonlySet<string>): RefCardLine[] {
  return lines.filter((ln) => checkedKeys.has(getLineKey(ln)) && getLineView(ln, mode).checkable);
}

/** "적용하면" 예고 — 체크한 줄의 결과별 곳 수와 합계. */
export function getForecast(
  lines: RefCardLine[],
  mode: RefMode,
  checkedKeys: ReadonlySet<string>,
): { outcomes: Map<RefOutcome, number>; total: number } {
  const checked = listCheckedLines(lines, mode, checkedKeys);
  return { outcomes: forecastOutcomes(checked), total: checked.reduce((sum, ln) => sum + ln.count, 0) };
}

function listUniqueTargets(lines: RefCardLine[]): RefTarget[] {
  const targets = new Map<string, RefTarget>();
  for (const ln of lines) targets.set(getLineKey(ln), { target_id: ln.target_id, from_value: ln.from_value });
  return [...targets.values()];
}

function buildBodies(kind: RefCard["kind"], mode: RefMode, toValue: string, targets: RefTarget[]): RefApplyBody[] {
  const bodies: RefApplyBody[] = [];
  for (let start = 0; start < targets.length; start += REF_BATCH_SIZE) {
    bodies.push({
      kind,
      mode,
      ...(mode === "replace" ? { to_value: toValue } : {}),
      targets: targets.slice(start, start + REF_BATCH_SIZE),
    });
  }
  return bodies;
}

/**
 * 미리보기 본문 — 체크와 상관없이 카드의 모든 줄(잠김·게시 대기 포함)을 다시 판정받는다.
 * 대체인데 아직 대상을 안 골랐으면 없음(스캔 판정을 쓴다). 제거 모드는 제거 금지 소스를 뺀다(서버가 422로 거부).
 */
export function buildPreviewBatches(
  kind: RefCard["kind"],
  lines: RefCardLine[],
  mode: RefMode,
  toValue: string,
): RefApplyBody[] {
  if (mode === "replace" && !toValue) return [];
  return buildBodies(kind, mode, toValue, listUniqueTargets(lines.filter((ln) => !isRemoveBlocked(ln, mode))));
}

/** 적용 본문 — 체크했고 지금도 체크할 수 있는 줄만, 서버 상한 단위로 나눠 차례로 보낸다. */
export function buildApplyBatches(
  kind: RefCard["kind"],
  lines: RefCardLine[],
  checkedKeys: ReadonlySet<string>,
  mode: RefMode,
  toValue: string,
): RefApplyBody[] {
  return buildBodies(kind, mode, toValue, listUniqueTargets(listCheckedLines(lines, mode, checkedKeys)));
}

/** 체크한 노드 줄 중 내 점유 Draft에 바로 쓰는 줄이 있나 — 적용 확인에 에디터 새로 고침 안내를 붙인다. */
export function shouldWarnOpenEditor(lines: RefCardLine[], checkedKeys: ReadonlySet<string>): boolean {
  return lines.some((ln) => checkedKeys.has(getLineKey(ln)) && NODE_SOURCES.has(ln.source) && ln.outcome === "direct");
}

export interface DialogGroup {
  key: string;
  kind: "map" | "group" | "category" | "other";
  id: number | null;
  label: string;
  href: string | null;      // 맵은 에디터, 그룹은 그룹 페이지, 카테고리는 링크 없음
  role: "editor" | "owner" | null;
  versionLabel: string | null;
  versionStatus: RefVersionStatus | null;
  lines: { line: RefCardLine; index: number }[]; // index = 카드 안 순번(data-id `ref-line-${index}`)
}

function startDialogGroup(line: RefCardLine): Omit<DialogGroup, "lines"> {
  const base = { role: null, versionLabel: null, versionStatus: null };
  if (line.map_id != null) {
    return {
      ...base, key: `map:${line.map_id}`, kind: "map", id: line.map_id,
      label: line.map_name ?? `#${line.map_id}`, href: `/maps/${line.map_id}`,
    };
  }
  if (line.group_id != null) {
    return {
      ...base, key: `group:${line.group_id}`, kind: "group", id: line.group_id,
      label: line.group_name ?? `#${line.group_id}`, href: `/groups/${line.group_id}`,
    };
  }
  if (line.category_id != null) {
    return {
      ...base, key: `category:${line.category_id}`, kind: "category", id: line.category_id,
      label: line.category_name ?? `#${line.category_id}`, href: null,
    };
  }
  return { ...base, key: "other", kind: "other", id: null, label: "", href: null };
}

/** 줄을 맵·그룹·카테고리별로 묶는다(처음 나온 순서). 맵 머리의 역할·버전은 그 맵 줄에서 가져온다. */
export function groupDialogLines(lines: RefCardLine[]): DialogGroup[] {
  const groups = new Map<string, DialogGroup>();
  lines.forEach((line, index) => {
    const start = startDialogGroup(line);
    let group = groups.get(start.key);
    if (!group) {
      group = { ...start, lines: [] };
      groups.set(start.key, group);
    }
    group.lines.push({ line, index });
    group.role ??= line.map_role ?? null;
    if (group.versionLabel == null && line.version_label) {
      group.versionLabel = line.version_label;
      group.versionStatus = line.version_status ?? null;
    }
  });
  return [...groups.values()];
}

/** 상세 창 머리 — 걸린 맵 수(그룹·카테고리 제외)와 곳 수. */
export function getDialogMeta(card: RefCard): { maps: number; places: number } {
  const mapIds = new Set(card.lines.flatMap((ln) => (ln.map_id != null ? [ln.map_id] : [])));
  return { maps: mapIds.size, places: tallyCard(card).places };
}

/** 제거 모드는 사람 카드만 — 부서는 대체만 한다(설계 §5). */
export function canRemoveCard(card: RefCard): boolean {
  return card.kind === "user";
}

/** 적용 버튼 — 대체는 악센트 "바꾸기", 제거는 빨간 "지우기". */
export function getApplyButton(mode: RefMode): { labelKey: MessageKey; tone: "accent" | "error" } {
  return mode === "remove"
    ? { labelKey: "refAudit.dlg.applyRemove", tone: "error" }
    : { labelKey: "refAudit.dlg.applyReplace", tone: "accent" };
}

export interface ApplyGateInput {
  total: number;            // 체크한 곳 수
  mode: RefMode;
  toValue: string;          // 대체 대상 값 - 비면 아직 안 고름
  isPreviewCurrent: boolean; // 지금 (모드, 대상) 조합의 미리보기가 도착해 줄에 덮여 있나
  isPreviewing: boolean;
  isApplying: boolean;
}

/** 적용 버튼을 켤 수 있나 — 대상(또는 제거 모드)이 정해지고 그 조합의 미리보기가 도착해야 한다. 미리보기가 실패했거나 낡았으면 막는다(스캔 판정만 믿고 적용하지 않는다). */
export function canApplySelection({ total, mode, toValue, isPreviewCurrent, isPreviewing, isApplying }: ApplyGateInput): boolean {
  const hasTarget = mode === "remove" || toValue !== "";
  return total > 0 && hasTarget && isPreviewCurrent && !isPreviewing && !isApplying;
}

/** 적용 결과 토스트 — 묶음 결과를 합쳐 "N곳 반영 · M곳 게시 필요 · K명 알림 · L건 승인 요청", 0인 항목은 뺀다. */
export function formatAppliedToast(results: RefApplyResult[], t: TranslateFn): string {
  let applied = 0;
  let publish = 0;
  let notified = 0;
  let approvals = 0;
  const skipped = new Map<RefSkipReason, number>();
  for (const result of results) {
    applied += (result.places.direct ?? 0) + (result.places.checkout ?? 0);
    publish += result.places.new_draft ?? 0;
    notified += result.notified;
    approvals += result.approval_requests;
    for (const skip of result.skipped) skipped.set(skip.reason, (skipped.get(skip.reason) ?? 0) + 1);
  }
  const parts: string[] = [];
  if (applied > 0) parts.push(t("refAudit.toast.applied", { n: applied }));
  if (publish > 0) parts.push(t("refAudit.toast.publish", { n: publish }));
  if (notified > 0) parts.push(t("refAudit.toast.notified", { n: notified }));
  if (approvals > 0) parts.push(t("refAudit.toast.approvals", { n: approvals }));
  const skippedTotal = [...skipped.values()].reduce((sum, n) => sum + n, 0);
  if (skippedTotal > 0) {
    const reasons = [...skipped].map(([reason, n]) => `${t(SKIP_REASON_KEY[reason])} ${n}`).join(", ");
    parts.push(`${t("refAudit.toast.skipped", { n: skippedTotal })} (${reasons})`);
  }
  return parts.length > 0 ? parts.join(" · ") : t("refAudit.toast.nothing");
}
