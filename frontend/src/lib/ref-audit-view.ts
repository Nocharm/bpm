// 고아 참조 히어로 순수 로직 — 숫자 3개·범위 칩·결과 칩 라벨·그림 위 경우 8종 표. 컴포넌트는 렌더만 한다 (design 2026-10-23 §9).
import { FilePlus2, Lock, Stamp, type LucideIcon } from "lucide-react";

import type { RefAuditData, RefAuditScope, RefCard, RefOutcome, RefSource } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  OUTCOME_META,
  OUTCOME_ORDER,
  buildRingGradient,
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

function toPercent(value: number, total: number): number {
  return Math.round((value / total) * 10000) / 100;
}

function atPoint(x: number, y: number): { x: number; y: number } {
  return { x: toPercent(x, HERO_VIEWBOX.width), y: toPercent(y, HERO_VIEWBOX.height) };
}

function atChipCorner(chip: (typeof SETTINGS_CHIPS)[number]): { x: number; y: number } {
  return atPoint(chip.x + chip.w, SETTINGS_CHIP_Y);
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
    id: "map_owner", ...atChipCorner(SETTINGS_CHIPS[0]), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.map_owner.label", whereKey: "refAudit.case.map_owner.where", whoKey: "refAudit.who.owner",
    replace: true, remove: false, note: { icon: Lock, key: "refAudit.case.map_owner.note" },
  },
  {
    id: "map_approver", ...atChipCorner(SETTINGS_CHIPS[1]), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.map_approver.label", whereKey: "refAudit.case.map_approver.where", whoKey: "refAudit.who.owner",
    replace: true, remove: true, note: { icon: Lock, key: "refAudit.case.map_approver.note" },
  },
  {
    id: "map_collab", ...atChipCorner(SETTINGS_CHIPS[2]), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.map_collab.label", whereKey: "refAudit.case.map_collab.where", whoKey: "refAudit.who.editor",
    replace: true, remove: "people", note: { icon: Stamp, key: "refAudit.case.map_collab.note" },
  },
  {
    id: "owning_dept", ...atChipCorner(SETTINGS_CHIPS[3]), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.owning_dept.label", whereKey: "refAudit.case.owning_dept.where", whoKey: "refAudit.who.owner",
    replace: true, remove: false,
  },
  {
    id: "node_dept", ...atPoint(584, 106), tipV: "down", tipH: "center",
    labelKey: "refAudit.case.node_dept.label", whereKey: "refAudit.case.node_dept.where", whoKey: "refAudit.who.editor",
    replace: true, remove: "assignee", note: { icon: FilePlus2, key: "refAudit.case.node_dept.note" },
  },
  {
    id: "sp_dept", ...atPoint(736, 106), tipV: "down", tipH: "end",
    labelKey: "refAudit.case.sp_dept.label", whereKey: "refAudit.case.sp_dept.where", whoKey: "refAudit.who.owner",
    replace: true, remove: "assignee",
  },
  {
    id: "group_member", ...atPoint(524, 206), tipV: "up", tipH: "center",
    labelKey: "refAudit.case.group_member.label", whereKey: "refAudit.case.group_member.where", whoKey: "refAudit.who.groupAdmin",
    replace: true, remove: "people",
  },
  {
    id: "category_perm", ...atPoint(752, 206), tipV: "up", tipH: "end",
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
