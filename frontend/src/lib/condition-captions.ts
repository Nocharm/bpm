// 시작·종료 조건 캡션(노드 밖 위=시작·아래=종료) — 표시 판정과 예약 높이의 단일 소스.
// 렌더(process-node)와 표시 간격 보정(height-shift)이 같은 판정을 쓴다 (사용자 결정 2026-10-13: LR·TB 모두 위·아래 고정).
import { hasBpmAttributes, type AppNode } from "@/lib/canvas";
import type { NodeDisplayToggle } from "@/lib/node-actions";

// 캡션 한 줄이 차지하는 높이(px) — 줄높이 16(leading-4) + 노드와의 간격 3 + 여유 1. process-node 캡션 클래스와 동기화
export const CONDITION_CAPTION_H = 20;

export interface ConditionCaptions {
  start: string;
  end: string;
}

export interface CaptionExtents {
  above: number;
  below: number;
}

export const NO_CAPTION_EXTENTS: CaptionExtents = { above: 0, below: 0 };

export interface ConditionCaption {
  text: string;
  // 비교 화면에서 대상 버전에 없는(지워진) 조건 — 이전 값을 취소선으로 보여 준다
  removed: boolean;
}

// 여러 줄 조건은 캡션 한 줄에 " / "로 이어 붙인다 — 전문은 툴팁
function formatCaptionText(raw: string | null | undefined): string {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" / ");
}

/** 한쪽 조건 캡션 — 현재 값, 없으면 비교 화면의 지워진 이전 값(removed). 토글 꺼짐·시작/끝 노드·빈 값은 null. */
export function getConditionCaption(
  data: AppNode["data"],
  side: "start" | "end",
  displayFields: readonly NodeDisplayToggle[],
): ConditionCaption | null {
  if (!displayFields.includes("conditions")) return null;
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const key = side === "start" ? "start_condition" : "end_condition";
  const current = formatCaptionText(
    isSubprocess ? (side === "start" ? data.spStartCondition : data.spEndCondition) : data[key],
  );
  if (current !== "") return { text: current, removed: false };
  const before = formatCaptionText(data.conditionDiffs?.[key]?.before);
  return before !== "" ? { text: before, removed: true } : null;
}

/** 노드에 그릴 조건 캡션 — Conditions 토글이 꺼졌거나 BPM 속성이 없는 노드(시작·끝)는 null. SP는 링크 맵 지정값. */
export function getConditionCaptions(
  data: AppNode["data"],
  displayFields: readonly NodeDisplayToggle[],
): ConditionCaptions | null {
  const start = getConditionCaption(data, "start", displayFields)?.text ?? "";
  const end = getConditionCaption(data, "end", displayFields)?.text ?? "";
  if (start === "" && end === "") return null;
  return { start, end };
}

/** height-shift가 노드 위·아래로 더 확보할 높이 — 캡션이 있는 변만 CONDITION_CAPTION_H. */
export function getConditionCaptionExtents(
  node: AppNode,
  displayFields: readonly NodeDisplayToggle[],
): CaptionExtents {
  const captions = getConditionCaptions(node.data, displayFields);
  if (captions === null) return NO_CAPTION_EXTENTS;
  return {
    above: captions.start !== "" ? CONDITION_CAPTION_H : 0,
    below: captions.end !== "" ? CONDITION_CAPTION_H : 0,
  };
}
