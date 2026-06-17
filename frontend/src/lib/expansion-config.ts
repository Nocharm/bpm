// 인라인 하위 프로세스 펼침 상한. 추후 /admin 서버값으로 교체 가능한 단일 seam — 하드코딩 금지(spec D3).

export interface ExpansionLimits {
  /** 동시 펼침으로 캔버스에 추가되는 인라인 자식 노드 총수 상한 */
  maxNodes: number;
  /** 펼침 중첩 깊이 상한 */
  maxDepth: number;
}

export const EXPANSION_LIMITS: ExpansionLimits = {
  maxNodes: 300,
  maxDepth: 5,
};
