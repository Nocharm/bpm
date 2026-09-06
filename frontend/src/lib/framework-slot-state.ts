// L5 캔버스 subprocess 노드의 슬롯 상태 파생 — refs(라이브)와 캔버스 L5 id로만 결정 (spec 2026-09-06 §6.2·§7.1)
import type { SubprocessRef } from "./api";

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
