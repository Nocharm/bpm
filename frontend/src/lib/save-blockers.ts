// 저장·승인 요청을 막는 체크리스트 미충족 문구 — 에디터와 맵 설정 버전 패널이 같은 판정을 쓴다 (리뷰 2026-10-19 F-4).
// 설정 패널의 제출·셀프 게시가 이 검사를 거치지 않아 출력 규칙을 어긴 맵이 게시됐다. 서버도 제출 때 같은 출력 규칙을 본다.
import type { Graph } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";
import { getSaveCheckStates } from "@/components/save-checklist";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function listSaveBlockers(
  states: ReturnType<typeof getSaveCheckStates>,
  isFrameworkMap: boolean,
  t: Translate,
): string[] {
  const blockers: string[] = [];
  // 연계 캔버스는 start·대표끝이 없는 게 정상 — 두 조건은 일반 맵에만 (2026-08-28 개선)
  if (!isFrameworkMap && !states.start) blockers.push(t("save.checkOneStart"));
  if (!isFrameworkMap && !states.primaryEnd) blockers.push(t("save.checkPrimaryEnd"));
  if (!states.endUnique) blockers.push(t("save.checkUniqueEnd"));
  if (!states.singleOutput) blockers.push(t("save.checkSingleOutput"));
  return blockers;
}

// 저장된 그래프(API 모양) 기준 — 에디터 밖(설정 패널)에서 제출 전에 쓴다
export function listGraphSaveBlockers(graph: Graph, t: Translate): string[] {
  if (graph.nodes.length === 0) return [];
  const states = getSaveCheckStates(
    graph.nodes.map((node) => ({
      id: node.id,
      nodeType: node.node_type,
      label: node.title,
      parallelOutputs: node.parallel_outputs,
    })),
    graph.edges.map((edge) => ({
      source: edge.source_node_id,
      sourceHandle: edge.source_handle,
      gateway: edge.gateway ?? null,
    })),
  );
  return listSaveBlockers(states, false, t);
}
