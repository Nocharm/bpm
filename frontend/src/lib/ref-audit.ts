// 고아 참조 카드 순수 로직 — 결과 버킷·카드 집계·정렬·맵 줄 요약·링 비율·적용 예고. 컴포넌트는 렌더만 한다.
import {
  BellRing,
  Building2,
  Check,
  ClipboardCheck,
  Crown,
  FilePlus2,
  FolderTree,
  Group,
  Hourglass,
  Layers,
  Lock,
  PencilLine,
  Stamp,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { RefCard, RefOutcome, RefSource } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

/** 결과를 화면 집계 네 갈래로 묶는다 — fix=직접 고침, notify=알림, lock=잠김, pend=게시 대기. */
export type Bucket = "fix" | "notify" | "lock" | "pend";

export interface CardTally extends Record<Bucket, number> {
  places: number; // 곳 수 전체(count 합)
}

type OutcomeTone = "ok" | "accent" | "warn" | "mute" | "pend";

export interface OutcomeMeta {
  labelKey: MessageKey;
  icon: LucideIcon;
  tone: OutcomeTone;
}

export interface MapRow {
  key: string;
  label: string;
  count: number;
  isGroup: boolean; // 맵이 아닌 줄(유저 그룹·카테고리)
  isMore: boolean;  // "외 N개"로 합친 줄
}

// 서버 REMOVE_BLOCKED와 같은 집합 — 지울 수 없는 소스(오너·주관 부서·SP 부서)
export const REMOVE_BLOCKED: ReadonlySet<RefSource> = new Set<RefSource>(["map_owner", "owning_dept", "sp_dept"]);

// 결과 표시 순서 — 적용 예고 칩·히어로 범례가 이 순서를 따른다
export const OUTCOME_ORDER: readonly RefOutcome[] = [
  "direct", "checkout", "new_draft", "approval", "notify", "locked", "pending",
];

export const OUTCOME_META: Record<RefOutcome, OutcomeMeta> = {
  direct: { labelKey: "refAudit.outcome.direct", icon: Check, tone: "ok" },
  checkout: { labelKey: "refAudit.outcome.checkout", icon: PencilLine, tone: "ok" },
  new_draft: { labelKey: "refAudit.outcome.new_draft", icon: FilePlus2, tone: "accent" },
  approval: { labelKey: "refAudit.outcome.approval", icon: ClipboardCheck, tone: "accent" },
  notify: { labelKey: "refAudit.outcome.notify", icon: BellRing, tone: "warn" },
  locked: { labelKey: "refAudit.outcome.locked", icon: Lock, tone: "mute" },
  pending: { labelKey: "refAudit.outcome.pending", icon: Hourglass, tone: "pend" },
};

export const SOURCE_ICON: Record<RefSource, LucideIcon> = {
  map_owner: Crown,
  map_approver: Stamp,
  map_grant: Users,
  map_collab: Users,
  owning_dept: Building2,
  sp_dept: Layers,
  sp_assignee: Layers,
  node_dept: Workflow,
  node_assignee: Workflow,
  group_member: Group,
  group_user: Group,
  category_perm: FolderTree,
};

export const SOURCE_LABEL_KEY: Record<RefSource, MessageKey> = {
  map_grant: "refAudit.source.map_grant",
  group_member: "refAudit.source.group_member",
  owning_dept: "refAudit.source.owning_dept",
  sp_dept: "refAudit.source.sp_dept",
  node_dept: "refAudit.source.node_dept",
  map_owner: "refAudit.source.map_owner",
  map_collab: "refAudit.source.map_collab",
  map_approver: "refAudit.source.map_approver",
  group_user: "refAudit.source.group_user",
  category_perm: "refAudit.source.category_perm",
  sp_assignee: "refAudit.source.sp_assignee",
  node_assignee: "refAudit.source.node_assignee",
};

// 링 구간 색 — 토큰 변수만(악센트 테마를 따라간다). 순서가 곧 링의 시계 방향 순서
const RING_SEGMENTS: readonly { bucket: Bucket; color: string }[] = [
  { bucket: "fix", color: "var(--color-added)" },
  { bucket: "notify", color: "var(--color-warn)" },
  { bucket: "lock", color: "var(--color-border-strong)" },
  { bucket: "pend", color: "var(--color-accent)" },
];

export function bucketOf(outcome: RefOutcome): Bucket {
  switch (outcome) {
    case "direct":
    case "checkout":
    case "new_draft":
    case "approval":
      return "fix";
    case "notify":
      return "notify";
    case "locked":
      return "lock";
    case "pending":
      return "pend";
  }
}

/** 체크할 수 있는 줄 — 직접 고치거나 알릴 수 있는 결과만(잠김·게시 대기는 할 수 있는 일이 없다). */
export function isLineCheckable(outcome: RefOutcome): boolean {
  const bucket = bucketOf(outcome);
  return bucket === "fix" || bucket === "notify";
}

/** 카드의 버킷별 곳 수(줄의 count 합)와 전체 곳 수. */
export function tallyCard(card: RefCard): CardTally {
  const tally: CardTally = { fix: 0, notify: 0, lock: 0, pend: 0, places: 0 };
  for (const ln of card.lines) {
    tally[bucketOf(ln.outcome)] += ln.count;
    tally.places += ln.count;
  }
  return tally;
}

function isPendingOnly(tally: CardTally): boolean {
  return tally.places > 0 && tally.pend === tally.places;
}

/** 고칠 곳이 많은 카드부터, 전부 게시 대기인 카드는 맨 뒤. 원본 배열은 건드리지 않는다. */
export function sortCards(cards: RefCard[]): RefCard[] {
  return cards
    .map((card) => ({ card, tally: tallyCard(card) }))
    .sort((a, b) => {
      const aPend = isPendingOnly(a.tally);
      const bPend = isPendingOnly(b.tally);
      if (aPend !== bPend) return aPend ? 1 : -1;
      return (
        b.tally.fix - a.tally.fix
        || b.tally.notify - a.tally.notify
        || a.card.label.localeCompare(b.card.label)
      );
    })
    .map(({ card }) => card);
}

/**
 * 카드 가운데에 보일 맵·그룹·카테고리별 곳 수 — 많은 순. 3개 이상이면 1위 + 나머지 합 한 줄.
 * "외 N개" 문구는 번역이 필요해 호출부가 formatMore로 정한다(기본 `+N`).
 */
export function summarizeMapRows(
  card: RefCard,
  formatMore: (rest: number) => string = (rest) => `+${rest}`,
): MapRow[] {
  const byKey = new Map<string, MapRow>();
  for (const ln of card.lines) {
    let row: Omit<MapRow, "count" | "isMore">;
    if (ln.map_id != null) row = { key: `map:${ln.map_id}`, label: ln.map_name ?? `#${ln.map_id}`, isGroup: false };
    else if (ln.group_id != null) row = { key: `group:${ln.group_id}`, label: ln.group_name ?? `#${ln.group_id}`, isGroup: true };
    else if (ln.category_id != null) {
      row = { key: `category:${ln.category_id}`, label: ln.category_name ?? `#${ln.category_id}`, isGroup: true };
    } else row = { key: "other", label: "", isGroup: false };
    const prev = byKey.get(row.key);
    if (prev) prev.count += ln.count;
    else byKey.set(row.key, { ...row, count: ln.count, isMore: false });
  }
  const rows = [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (rows.length <= 2) return rows;
  const rest = rows.slice(1);
  return [
    rows[0],
    {
      key: "more",
      label: formatMore(rest.length),
      count: rest.reduce((sum, r) => sum + r.count, 0),
      isGroup: false,
      isMore: true,
    },
  ];
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 결과 비율 링(conic-gradient) — 0인 구간은 빼고 마지막 구간은 100%로 끝낸다. 전부 0이면 중립 한 색. */
export function buildRingGradient(tally: Pick<CardTally, Bucket>): string {
  const total = tally.fix + tally.notify + tally.lock + tally.pend;
  if (total === 0) return "conic-gradient(var(--color-border-strong) 0% 100%)";
  const active = RING_SEGMENTS.filter((seg) => tally[seg.bucket] > 0);
  const stops: string[] = [];
  let acc = 0;
  let from = 0;
  active.forEach((seg, i) => {
    acc += tally[seg.bucket];
    const to = i === active.length - 1 ? 100 : roundPercent((acc / total) * 100);
    stops.push(`${seg.color} ${from}% ${to}%`);
    from = to;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** 체크한 줄을 적용하면 나올 결과별 곳 수 — 표시 순서는 OUTCOME_ORDER로 고정. */
export function forecastOutcomes(lines: { outcome: RefOutcome; count: number }[]): Map<RefOutcome, number> {
  const sums = new Map<RefOutcome, number>();
  for (const ln of lines) sums.set(ln.outcome, (sums.get(ln.outcome) ?? 0) + ln.count);
  return new Map(
    OUTCOME_ORDER.filter((outcome) => sums.has(outcome)).map((outcome): [RefOutcome, number] => [
      outcome,
      sums.get(outcome) ?? 0,
    ]),
  );
}
