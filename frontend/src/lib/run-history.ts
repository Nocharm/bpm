// 실행 이력 묶기(좌측 사이드바 실행 탭, components/run/run-history-panel) — 최근 순은 그대로 두고, 이어진 같은 날·같은 단계 줄을
// 한 묶음으로 모아 단계 이름을 묶음 머리에 한 번만 쓰고, 묶음 안에서 바로 위 줄과 같은 사람이면 이름을 생략한다(사용자 요청 2026-11-05,
// 같은 글자가 줄마다 되풀이되어 읽기 어려웠다). 노드가 없는 줄(실행 중단·다시 열기·자동 중단)은 단계 없는 묶음이다.
// 시각은 왼쪽 세로선 옆에 쓰고, 바로 위 줄과 같은 분이면 묶음을 넘어서도 다시 쓰지 않는다(사용자 요청 2026-11-05).

import type { RunHistoryItem } from "@/lib/api";
import { toRunNodeKey } from "@/lib/run-view";

export interface RunHistoryEntry {
  item: RunHistoryItem;
  // 묶음 안 바로 위 줄과 같은 사람 — 이름을 다시 쓰지 않는다
  isSameActor: boolean;
  // 목록에서 바로 위 줄과 같은 분(날짜 포함) — 시각을 다시 쓰지 않는다
  isSameMinute: boolean;
}

export interface RunHistoryGroup {
  // 묶음 첫 줄 기준 고유 키(목록 key·data-id)
  key: string;
  // KST 날짜(YYYY-MM-DD)
  day: string;
  // 앞 묶음과 날이 달라 날짜 구분 줄을 보일 묶음 — 첫 묶음도 참
  isNewDay: boolean;
  // 단계 노드 키(임베드 id 꼴), 노드 없는 줄이면 null
  stepKey: string | null;
  entries: RunHistoryEntry[];
}

/** 줄의 단계 노드 키 — 노드 없는 이력(중단·다시 열기)은 null. */
export function getRunHistoryStepKey(item: RunHistoryItem): string | null {
  return item.node_id === null ? null : toRunNodeKey(item.scope_path, item.node_id);
}

/**
 * 최근 순 이력 → 연속 묶음. getDay는 시각 → 날짜 문자열, getMinute는 시각 → 날짜를 포함한 분 문자열(화면은 KST).
 * 순서는 바꾸지 않는다.
 */
export function groupRunHistory(
  items: readonly RunHistoryItem[],
  getDay: (iso: string) => string,
  getMinute: (iso: string) => string,
): RunHistoryGroup[] {
  const groups: RunHistoryGroup[] = [];
  let previousMinute: string | null = null;
  for (const item of items) {
    const day = getDay(item.created_at);
    const minute = getMinute(item.created_at);
    const isSameMinute = minute === previousMinute;
    previousMinute = minute;
    const stepKey = getRunHistoryStepKey(item);
    const last = groups.at(-1);
    if (last !== undefined && last.day === day && last.stepKey === stepKey) {
      const previous = last.entries[last.entries.length - 1].item;
      last.entries.push({ item, isSameActor: previous.actor === item.actor, isSameMinute });
      continue;
    }
    groups.push({
      key: `${item.kind}-${item.id}`,
      day,
      isNewDay: last === undefined || last.day !== day,
      stepKey,
      entries: [{ item, isSameActor: false, isSameMinute }],
    });
  }
  return groups;
}
