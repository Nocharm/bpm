// 부서 조직 레벨 아이콘 — org_path 말단 세그먼트로 레벨을 추정해 아이콘을 고른다.
// map-detail-card.tsx에서 추출(순수 이동, HM-3) — 오우닝 부서 피커 조직도 브라우즈(dept-browse)에서도 재사용.

import { Building, Building2, House, Landmark, Puzzle } from "lucide-react";

// 부서 org_path("A/B/C")의 말단 세그먼트만 / leaf segment of a dept org_path (HM-3).
export function deptLeaf(orgPath: string): string {
  const parts = orgPath.split("/");
  return parts[parts.length - 1] || orgPath;
}

// 조직 레벨 순위(낮을수록 위): 센터 > 담당(Department) > 팀 > 그룹 > 파트. 이름 접미사로 판별(KO/EN). (HM-3)
export function deptLevelRank(leaf: string): number {
  const s = leaf.toLowerCase();
  if (s.includes("센터") || s.includes("center")) return 0;
  if (s.includes("팀") || s.includes("team")) return 2;
  if (s.includes("그룹") || s.includes("group")) return 3;
  if (s.includes("파트") || s.includes("part")) return 4;
  return 1; // 담당(Department) / 그 외 기본
}

// 조직 레벨별 아이콘 — 센터/담당/팀/그룹/파트 (deptLevelRank 순서) (HM)
const LEVEL_ICONS = [Landmark, Building2, Building, House, Puzzle];

export function DeptLevelIcon({ leaf, size = 14 }: { leaf: string; size?: number }) {
  const Icon = LEVEL_ICONS[deptLevelRank(leaf)] ?? Building2;
  return <Icon size={size} strokeWidth={1.5} />;
}
