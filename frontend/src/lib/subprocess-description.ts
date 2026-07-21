// 서브프로세스 노드 설명 합성 — 링크맵 sp_description(베이스, 읽기전용) + 이 맵의 추가분(node.description).
// 노드에는 추가분만 저장한다. 표시 시 베이스와 줄바꿈으로 잇는다(베이스 변경 자동 반영).

export function mergeSubprocessDescription(
  base: string | null | undefined,
  local: string | null | undefined,
): string {
  const b = (base ?? "").trim();
  const l = (local ?? "").trim();
  if (!b) {
    return l;
  }
  if (!l) {
    return b;
  }
  return `${b}\n${l}`;
}
