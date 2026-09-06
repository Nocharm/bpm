// L5 캔버스 subprocess 노드의 슬롯 상태 파생 — refs(라이브)와 캔버스 L5 id로만 결정 (spec 2026-09-06 §6.2·§7.1)
import type { SubprocessRef, SlotChangeAction } from "./api";
import type { MessageKey } from "./i18n-messages";

export type SlotState =
  | "placeholder" // linkedMapId 없음(미등록)
  | "unknown" // refs 미수신
  | "deleted" // 링크 맵 휴지통/영구삭제
  | "superseded" // 살아 있지만 슬롯을 넘김(retired_to_map_id)
  | "unassigned" // 살아 있고 체계 밖(category_id NULL)
  | "contained" // 이 캔버스 L5 소속
  | "external"; // 다른 L5 소속

export function deriveSlotState(
  ref: SubprocessRef | undefined,
  linkedMapId: number | null | undefined,
  canvasCategoryId: number | null,
): SlotState {
  if (linkedMapId == null) return "placeholder";
  if (!ref) return "unknown";
  if (ref.deleted) return "deleted";
  if (ref.superseded) return "superseded";
  if (ref.category_id == null) return "unassigned";
  if (canvasCategoryId != null && ref.category_id === canvasCategoryId) return "contained";
  return "external";
}

// "최근 이양" 배지 기간(일) — FE 단일 소스 (spec §7.1)
export const RECENT_HANDOVER_DAYS = 14;

export function isRecentHandover(succeededAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!succeededAt) return false;
  const at = Date.parse(succeededAt);
  if (!Number.isFinite(at) || at > now) return false;
  return now - at <= RECENT_HANDOVER_DAYS * 86_400_000;
}

// 슬롯 변경 액션 → i18n 라벨 키 — 승인 큐/대기 패널/인박스 3표면 공용 (Track C Task 3)
export const SLOT_ACTION_KEY: Record<SlotChangeAction, MessageKey> = {
  assign: "slot.action.assign",
  unassign: "slot.action.unassign",
  move: "slot.action.move",
  replace: "slot.action.replace",
  delete: "slot.action.delete",
};

export function isSlotAction(value: unknown): value is SlotChangeAction {
  return typeof value === "string" && value in SLOT_ACTION_KEY;
}

// 우상단 호버 패널 표시 여부 — "정보가 있을 때"만 뜨게: 이양(succeededAt) 또는 변경(changedAt) 이력이
// 있을 때만 true. "Map updated"만 있는 경우는 정보로 치지 않는다(사용자 요청 2026-09-06).
// 파라미터는 L5NodeInfo의 구조적 부분집합만 받아 components/ ↔ lib/ 순환 임포트를 피한다.
export function hasSlotHistory(
  info: { succeededAt: string | null; changedAt: string | null } | null,
): boolean {
  return info !== null && (Boolean(info.succeededAt) || Boolean(info.changedAt));
}
