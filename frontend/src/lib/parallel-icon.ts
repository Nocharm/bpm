// 병렬 출구 아이콘 — 반 박자 엇갈린 화살표 두 개("동시 출발, 각자 진행", 사용자 선정 2026-10-02 시안 J).
// Lucide 규격(24 그리드·stroke)이라 메뉴의 LucideIcon 슬롯·노드 호버 배지·끝 선택 모달에 그대로 쓴다.
import { createLucideIcon } from "lucide-react";

export const ParallelExitIcon = createLucideIcon("parallel-exit", [
  ["path", { d: "M3 9h11", key: "upper-shaft" }],
  ["path", { d: "m11 6 3 3-3 3", key: "upper-head" }],
  ["path", { d: "M9 16h12", key: "lower-shaft" }],
  ["path", { d: "m18 13 3 3-3 3", key: "lower-head" }],
]);
