// 플레이스홀더 연결 낙관 참조 — 드롭·연결 직후 서버 refs 도착 전에도 임시로 쓰는 SubprocessRef 스텁 생성 (design 2026-08-28 §10.1).
import type { SubprocessRef } from "./api";

// 낙관 참조 — 드롭·연결 직후 서버 refs 도착 전에도 외부 L6 색·출처 배지를 즉시 그리기 위한
// 표시 전용 스텁. 실제 refs(rootGraph)가 도착하면 병합 순서상 덮인다 (2026-08-30 #4)
export interface OptimisticRefMeta {
  name: string;
  categoryId: number;
  categoryPath: string | null;
  designated: boolean;
}

export function makeOptimisticRef(meta: OptimisticRefMeta): SubprocessRef {
  return {
    designated: meta.designated,
    name: meta.name,
    category_id: meta.categoryId,
    category_path: meta.categoryPath,
    department: null,
    assignee: null,
    assignee_role: null,
    system: null,
    duration: null,
    cost_krw: null,
    cost_usd: null,
    headcount: null,
    touch_time: null,
    input: null,
    output: null,
    input_forms: null,
    output_forms: null,
    input_ids: null,
    output_ids: null,
    start_condition: null,
    end_condition: null,
    frequency_fallback: null,
    gmp: null,
    url: null,
    url_label: null,
    sp_description: null,
  };
}
