// 스크롤 위치로 "지금 읽는 구역"을 고르는 순수 판정 — 맵 설정 좌측 내비 강조가 쓴다.

export interface SectionTop {
  id: string;
  /** 스크롤 컨테이너 위쪽 변 기준 구역 머리의 위치(px). 위로 지나갔으면 음수. */
  top: number;
}

/** 구역 머리가 이 선(px)을 지나면 그 구역을 읽는 중으로 본다. 구역 사이 여백보다 커야 클릭 직후에도 맞는다. */
export const SECTION_SPY_LINE = 96;

/**
 * 판정 선을 지난 마지막 구역을 고른다. 맨 아래까지 내려왔으면 마지막 구역이다
 * (아래쪽 짧은 구역은 선까지 올라오지 못한다).
 */
export function pickActiveSection(sections: SectionTop[], isAtBottom: boolean): string | null {
  if (sections.length === 0) {
    return null;
  }
  if (isAtBottom) {
    return sections[sections.length - 1].id;
  }
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top <= SECTION_SPY_LINE) {
      active = section.id;
    }
  }
  return active;
}
