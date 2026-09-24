// 플랜 카드 목록의 FE 전용 키·순서 계산 — FLIP(useFlipOrder)이 카드를 index가 아닌 clientId로 추적한다. 전송 전에 키를 벗긴다 (2026-09-23).

import type { FwPlanCard } from "./api";
import { genId } from "./id";

export interface KeyedCard extends FwPlanCard {
  clientId: string;
}

export function withClientIds(cards: FwPlanCard[]): KeyedCard[] {
  return cards.map((card) => ({ ...card, clientId: genId() }));
}

export function stripClientIds(cards: KeyedCard[]): FwPlanCard[] {
  return cards.map((card) => {
    const { clientId: _clientId, ...rest } = card;
    void _clientId;
    return rest;
  });
}

// 범위 밖이면 같은 참조를 돌려준다 — 호출부가 리렌더 없이 무시할 수 있게
export function swapCards(cards: KeyedCard[], i: number, delta: 1 | -1): KeyedCard[] {
  const j = i + delta;
  if (j < 0 || j >= cards.length) return cards;
  const next = [...cards];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// 드래그 이동 — from 항목을 뽑아 to 자리에 끼운다(사이 항목은 한 칸씩 밀림). 범위 밖·제자리는 같은 참조
export function moveCard(cards: KeyedCard[], from: number, to: number): KeyedCard[] {
  if (from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return cards;
  const next = [...cards];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function orderKeyOf(cards: KeyedCard[]): string {
  return cards.map((card) => card.clientId).join("|");
}

// ── 단계(stage) — depends_on(선행 카드 이름)에서 계산한다. 계획 화면이 행(단계)으로 그리는 근거(2026-09-24).
// 단계 = 1 + max(선행 단계). 선행이 없거나 목록에 없는 이름만 가리키면 0. 순환은 방문 중인 카드를 선행으로 치지 않아 끊는다.

export function computeStages(cards: KeyedCard[]): Map<string, number> {
  const byName = new Map<string, KeyedCard>();
  for (const card of cards) {
    const name = card.name.trim();
    if (name && !byName.has(name)) byName.set(name, card);
  }
  const stages = new Map<string, number>();
  const visiting = new Set<string>();
  const stageOf = (card: KeyedCard): number => {
    const known = stages.get(card.clientId);
    if (known !== undefined) return known;
    if (visiting.has(card.clientId)) return 0;
    visiting.add(card.clientId);
    let stage = 0;
    for (const dep of card.depends_on) {
      const target = byName.get(dep.trim());
      if (!target || target.clientId === card.clientId) continue;
      stage = Math.max(stage, stageOf(target) + 1);
    }
    visiting.delete(card.clientId);
    stages.set(card.clientId, stage);
    return stage;
  };
  for (const card of cards) stageOf(card);
  return stages;
}

/** 단계별 카드 묶음(배열 순서 유지) — 빈 단계는 생기지 않는다(계산된 단계를 촘촘히 다시 번호 매김). */
export function groupByStage(cards: KeyedCard[]): KeyedCard[][] {
  const stages = computeStages(cards);
  const distinct = [...new Set(cards.map((card) => stages.get(card.clientId) ?? 0))].sort((a, b) => a - b);
  return distinct.map((stage) => cards.filter((card) => stages.get(card.clientId) === stage));
}

/** 배열을 단계 순으로 안정 정렬 — 잠금 시 seq가 단계 순서를 따르게. 같은 단계 안 순서는 그대로. */
export function sortByStage(cards: KeyedCard[]): KeyedCard[] {
  const stages = computeStages(cards);
  return [...cards].sort((a, b) => (stages.get(a.clientId) ?? 0) - (stages.get(b.clientId) ?? 0));
}

/**
 * 카드를 다른 단계로 — 선행을 그 앞 단계의 카드 전부로 바꾼다(0단계면 없음, 마지막+1이면 새 단계).
 * 옮긴 카드를 선행으로 두던 카드는 그대로 둔다(그 카드의 단계는 다시 계산된다). 같은 단계면 같은 참조.
 */
export function moveCardToStage(cards: KeyedCard[], clientId: string, stageIndex: number): KeyedCard[] {
  const groups = groupByStage(cards);
  const current = groups.findIndex((group) => group.some((card) => card.clientId === clientId));
  if (current < 0 || stageIndex < 0 || stageIndex > groups.length || stageIndex === current) return cards;
  const target = stageIndex === 0 ? [] : groups[stageIndex - 1].filter((card) => card.clientId !== clientId).map((card) => card.name.trim()).filter(Boolean);
  const moved = cards.map((card) => (card.clientId === clientId ? { ...card, depends_on: target } : card));
  // 옮긴 카드는 새 단계의 끝으로 — 배열 순서가 곧 같은 단계 안 표시 순서
  const me = moved.find((card) => card.clientId === clientId);
  if (!me) return cards;
  return sortByStage([...moved.filter((card) => card.clientId !== clientId), me]);
}

/** 같은 단계 안에서 표시 순서 이동(to = 그 단계 안 인덱스). 다른 단계로는 moveCardToStage. */
export function reorderWithinStage(cards: KeyedCard[], clientId: string, to: number): KeyedCard[] {
  const groups = groupByStage(cards);
  const group = groups.find((g) => g.some((card) => card.clientId === clientId));
  if (!group) return cards;
  const from = group.findIndex((card) => card.clientId === clientId);
  const clamped = Math.max(0, Math.min(group.length - 1, to));
  if (from === clamped) return cards;
  const reordered = [...group];
  const [item] = reordered.splice(from, 1);
  reordered.splice(clamped, 0, item);
  // 단계 묶음을 다시 이어 붙인다 — 다른 단계는 손대지 않는다
  return groups.flatMap((g) => (g === group ? reordered : g));
}

/** 카드 이름이 바뀌면 그 이름을 가리키던 선행 참조도 따라간다(depends_on은 이름이 키). */
export function renameDependency(cards: KeyedCard[], oldName: string, newName: string): KeyedCard[] {
  const from = oldName.trim();
  if (!from || from === newName.trim() || !cards.some((card) => card.depends_on.includes(from))) return cards;
  return cards.map((card) => (card.depends_on.includes(from)
    ? { ...card, depends_on: card.depends_on.map((dep) => (dep === from ? newName.trim() : dep)).filter(Boolean) }
    : card));
}
