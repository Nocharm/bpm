// 플랜 카드 목록의 FE 전용 키·단계 모델 — FLIP(useFlipOrder)이 카드를 index가 아닌 clientId로 추적한다. 전송 전에 키를 벗긴다 (2026-09-23).
// 단계(stage)는 카드에 명시적으로 둔다(2026-09-28): 드래그는 그 카드 하나만 옮기고 다른 카드는 자리를 지킨다.
// depends_on은 "직전 행의 비어 있지 않은 부분집합"이라는 불변식으로 저장하므로(0단계는 빈 배열),
// 재로드 때 computeStages가 같은 행을 되돌려 준다. 무효해진 선행은 직전 행 전부로 리셋한다.

import type { FwPlanCard } from "./api";
import { genId } from "./id";

export interface KeyedCard extends FwPlanCard {
  clientId: string;
  stage: number;
}

export function withClientIds(cards: FwPlanCard[]): KeyedCard[] {
  const keyed = cards.map((card) => ({ ...card, clientId: genId(), stage: 0 }));
  const stages = computeStages(keyed);
  return keyed.map((card) => ({ ...card, stage: stages.get(card.clientId) ?? 0 }));
}

export function stripClientIds(cards: KeyedCard[]): FwPlanCard[] {
  return cards.map((card) => {
    const { clientId: _clientId, stage: _stage, ...rest } = card;
    void _clientId;
    void _stage;
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

// ── depends_on(선행 카드 이름) → 단계. 서버에서 온 카드의 첫 배치와 잠금 정렬의 근거.
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

/** 단계별 카드 묶음(배열 순서 유지). index = 단계. 비어 있는 단계는 빈 배열로 남는다(접힘은 collapseEmptyStages). */
export function groupByStage(cards: KeyedCard[]): KeyedCard[][] {
  const last = cards.reduce((max, card) => Math.max(max, card.stage), -1);
  const groups: KeyedCard[][] = Array.from({ length: last + 1 }, () => []);
  for (const card of cards) groups[card.stage].push(card);
  return groups;
}

export function hasEmptyStage(cards: KeyedCard[]): boolean {
  return groupByStage(cards).some((group) => group.length === 0);
}

/** 빈 단계를 걷어 번호를 촘촘히 — 아래 행들이 한 단계씩 당겨진다. 빈 단계가 없으면 같은 참조. */
export function collapseEmptyStages(cards: KeyedCard[]): KeyedCard[] {
  const groups = groupByStage(cards);
  if (!groups.some((group) => group.length === 0)) return cards;
  const renumber = new Map<number, number>();
  let next = 0;
  groups.forEach((group, stage) => {
    if (group.length > 0) renumber.set(stage, next++);
  });
  return cards.map((card) => ({ ...card, stage: renumber.get(card.stage) ?? card.stage }));
}

function namesOf(group: KeyedCard[] | undefined, except?: string): string[] {
  return (group ?? []).filter((card) => card.clientId !== except).map((card) => card.name.trim()).filter(Boolean);
}

/**
 * 선행 불변식 적용 — 0단계는 빈 배열, 그 외는 직전 행의 비어 있지 않은 부분집합. 어긋난 카드만 직전 행 전부로 리셋한다.
 * 직전 행이 비어 있으면(접기 전 잠깐) 그대로 둔다 — 접힌 뒤 다시 돌린다. 바뀐 카드가 없으면 같은 참조.
 */
export function normalizeDependencies(cards: KeyedCard[]): KeyedCard[] {
  const groups = groupByStage(cards);
  let changed = false;
  const next = cards.map((card) => {
    if (card.stage === 0) {
      if (card.depends_on.length === 0) return card;
      changed = true;
      return { ...card, depends_on: [] };
    }
    const previous = namesOf(groups[card.stage - 1], card.clientId);
    if (previous.length === 0) return card;
    const allowed = new Set(previous);
    const kept = card.depends_on.map((dep) => dep.trim()).filter((dep) => allowed.has(dep));
    if (kept.length > 0 && kept.length === card.depends_on.length) return card;
    changed = true;
    return { ...card, depends_on: kept.length > 0 ? kept : previous };
  });
  return changed ? next : cards;
}

/** 잠금 전 정리 — 빈 단계를 접고 선행을 불변식에 맞춘다. 저장·전송 직전에 한 번 돌린다. */
export function settleCards(cards: KeyedCard[]): KeyedCard[] {
  return normalizeDependencies(collapseEmptyStages(cards));
}

/** 배열을 단계 순으로 안정 정렬 — 잠금 시 seq가 단계 순서를 따르게. 같은 단계 안 순서는 그대로. */
export function sortByStage(cards: KeyedCard[]): KeyedCard[] {
  return [...cards].sort((a, b) => a.stage - b.stage);
}

/**
 * 카드를 다른 단계로 — 그 카드만 옮기고 선행은 직전 행 전부로 바꾼다(0단계면 없음, 마지막+1이면 새 단계).
 * 다른 카드의 단계는 손대지 않는다(무효해진 선행은 normalizeDependencies가 잡는다). 같은 단계면 같은 참조.
 * 마지막 행에 혼자 있는 카드를 새 단계로 옮기는 것도 제자리다(접히면 같은 자리로 돌아온다).
 */
export function moveCardToStage(cards: KeyedCard[], clientId: string, stageIndex: number): KeyedCard[] {
  const me = cards.find((card) => card.clientId === clientId);
  if (!me) return cards;
  const groups = groupByStage(cards);
  if (stageIndex < 0 || stageIndex > groups.length || stageIndex === me.stage) return cards;
  if (stageIndex === groups.length && me.stage === groups.length - 1 && groups[me.stage].length === 1) return cards;
  const moved: KeyedCard = { ...me, stage: stageIndex, depends_on: stageIndex === 0 ? [] : namesOf(groups[stageIndex - 1], clientId) };
  // 옮긴 카드는 새 단계의 끝으로 — 배열 순서가 곧 같은 단계 안 표시 순서
  return normalizeDependencies([...cards.filter((card) => card.clientId !== clientId), moved]);
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

/** 새 카드 — 그 단계의 끝에, 선행은 직전 행 전부. */
export function addCardAtStage(cards: KeyedCard[], card: FwPlanCard, clientId: string, stage: number): KeyedCard[] {
  const groups = groupByStage(cards);
  return [...cards, { ...card, clientId, stage, depends_on: stage === 0 ? [] : namesOf(groups[stage - 1]) }];
}

/** 선행 카드 지정(우클릭 메뉴) — 직전 행 카드만, 비어 있지 않게. 어긋난 요청은 같은 참조. */
export function setPredecessors(cards: KeyedCard[], clientId: string, names: string[]): KeyedCard[] {
  const me = cards.find((card) => card.clientId === clientId);
  if (!me || me.stage === 0) return cards;
  const allowed = new Set(namesOf(groupByStage(cards)[me.stage - 1], clientId));
  const next = names.map((name) => name.trim()).filter((name) => allowed.has(name));
  if (next.length === 0) return cards;
  return cards.map((card) => (card.clientId === clientId ? { ...card, depends_on: next } : card));
}

/** 카드 이름이 바뀌면 그 이름을 가리키던 선행 참조도 따라간다(depends_on은 이름이 키). */
export function renameDependency(cards: KeyedCard[], oldName: string, newName: string): KeyedCard[] {
  const from = oldName.trim();
  if (!from || from === newName.trim() || !cards.some((card) => card.depends_on.includes(from))) return cards;
  return cards.map((card) => (card.depends_on.includes(from)
    ? { ...card, depends_on: card.depends_on.map((dep) => (dep === from ? newName.trim() : dep)).filter(Boolean) }
    : card));
}

/** 선행 연결 쌍(dep → card) — 직전 행에 있는 선행만. 연결선·호버 강조의 단일 소스. */
export function listDependencyLinks(cards: KeyedCard[]): { from: string; to: string }[] {
  const groups = groupByStage(cards);
  const links: { from: string; to: string }[] = [];
  for (const card of cards) {
    if (card.stage === 0) continue;
    const previous = new Map((groups[card.stage - 1] ?? []).map((c) => [c.name.trim(), c.clientId]));
    for (const dep of card.depends_on) {
      const from = previous.get(dep.trim());
      if (from && from !== card.clientId) links.push({ from, to: card.clientId });
    }
  }
  return links;
}
