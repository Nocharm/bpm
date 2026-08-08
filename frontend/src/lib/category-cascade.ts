// 업무 체계 카테고리 캐스케이드 셀렉트 — 선택 체인 순수 로직(depth별 선택 id 배열).
// depth에서 재선택 시 그보다 깊은 선택은 리셋된다 — 하위 옵션은 새 부모의 자식으로 다시 로드돼야
// 하므로 잔존하면 부모-자식이 어긋난 조합이 남는다. fetch·상태 보관은 호출부(모달 컴포넌트) 책임.
export function pickCascadeLevel(chain: number[], depth: number, categoryId: number): number[] {
  return [...chain.slice(0, depth), categoryId];
}

// 기존 연결 카테고리로 캐스케이드 시딩 — 조상 체인(루트→자신) 응답에서 선택 체인 id만 추출 (fix round 1 #2).
export function seedChainIds(chain: { id: number }[]): number[] {
  return chain.map((node) => node.id);
}

// 시딩 시 레벨별 옵션(listCategoryNodes) prefetch에 쓸 parentId 목록 — depth 0은 루트(undefined),
// 이후 depth는 그 앞 depth에서 선택된 id(그 카테고리의 자식들이 이번 depth의 옵션).
export function seedLevelParents(ids: number[]): (number | undefined)[] {
  return ids.map((_, i) => (i === 0 ? undefined : ids[i - 1]));
}
