// 업무 체계 카테고리 캐스케이드 셀렉트 — 선택 체인 순수 로직(depth별 선택 id 배열).
// depth에서 재선택 시 그보다 깊은 선택은 리셋된다 — 하위 옵션은 새 부모의 자식으로 다시 로드돼야
// 하므로 잔존하면 부모-자식이 어긋난 조합이 남는다. fetch·상태 보관은 호출부(모달 컴포넌트) 책임.
export function pickCascadeLevel(chain: number[], depth: number, categoryId: number): number[] {
  return [...chain.slice(0, depth), categoryId];
}
