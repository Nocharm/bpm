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
