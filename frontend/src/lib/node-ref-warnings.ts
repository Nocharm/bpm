// 노드 조직 참조 점검 — 조직도에 없는 부서·담당자, 열람권한 없는 담당자, 담당자 부서 드리프트.
// 판정 소스는 /directory(active 전 직원)라 설정 > Orphaned refs 감사(app/ref_audit.load_valid_sets)와
// 같은 집합을 본다 — 캔버스 경고와 감사 목록이 서로 다른 답을 내놓지 않게 하는 계약이다.
// 종전 드리프트 경고는 eligible(맵 열람권한자)만 봐서 비공개 맵의 재직자를 미등재로 오판했다 (2026-09-10).

import type { DirectoryDept, DirectoryUser } from "@/lib/api";
import { parseAssignees } from "@/lib/assignee";

/** 판정 소스 3종. 셋 다 도착한 뒤에만 만든다 — 로드 전 판정은 전 노드를 경고로 물들인다. */
export interface NodeRefCheck {
  // 유효 부서 리프명 — 조직 경로의 모든 세그먼트 ∪ 직원 department (백엔드 dept_leaves와 동형)
  deptLeaves: ReadonlySet<string>;
  // 담당자 이름(영문 name·한글명) → 말단 부서. 없으면 재직자 명단에 없는 이름
  deptByPerson: ReadonlyMap<string, string>;
  // 이 맵 열람권한(viewer+) 보유자 이름 — 재직 중이나 맵을 못 보는 담당자 판별용
  eligibleNames: ReadonlySet<string>;
}

export type NodeWarningKind =
  | "deptOrphan" // 부서가 조직도에 없음
  | "assigneeOrphan" // 담당자가 재직자 명단에 없음
  | "assigneeNoAccess" // 재직 중이나 이 맵 열람권한 없음
  | "assigneeDrift"; // 담당자의 현재 부서가 노드 부서와 다름

export interface NodeWarning {
  kind: NodeWarningKind;
  // 문제가 된 값 — 부서명 또는 담당자 이름
  value: string;
  // assigneeDrift 전용 — 담당자의 현재 부서
  personDept?: string;
}

/** 유효 부서 리프명 — 조직 경로의 모든 세그먼트 ∪ 직원 department. 백엔드 dept_leaves와 동형. */
export function buildDeptLeaves(
  users: Iterable<DirectoryUser>,
  departments: readonly DirectoryDept[],
): Set<string> {
  const leaves = new Set<string>();
  for (const dept of departments) {
    for (const segment of dept.id.split("/")) {
      if (segment !== "") leaves.add(segment);
    }
  }
  for (const user of users) {
    if (user.department) leaves.add(user.department);
  }
  return leaves;
}

export function buildNodeRefCheck(
  users: Iterable<DirectoryUser>,
  departments: readonly DirectoryDept[],
  eligibleNames: ReadonlySet<string>,
): NodeRefCheck {
  const deptLeaves = buildDeptLeaves(users, departments);
  const deptByPerson = new Map<string, string>();
  for (const user of users) {
    // 저장값은 영문 name이지만 한글명으로 들어온 값도 같은 사람으로 해석한다(AssigneePills와 대칭)
    if (!deptByPerson.has(user.name)) deptByPerson.set(user.name, user.department ?? "");
    if (user.korean_name && !deptByPerson.has(user.korean_name)) {
      deptByPerson.set(user.korean_name, user.department ?? "");
    }
  }
  return { deptLeaves, deptByPerson, eligibleNames };
}

/** 노드 1건의 경고 목록 — 부서 먼저, 그 다음 담당자 순. 문제 없으면 빈 배열. */
export function collectNodeWarnings(
  department: string | null | undefined,
  assignee: string | null | undefined,
  check: NodeRefCheck,
): NodeWarning[] {
  const warnings: NodeWarning[] = [];
  const dept = (department ?? "").trim();
  if (dept !== "" && !check.deptLeaves.has(dept)) {
    warnings.push({ kind: "deptOrphan", value: dept });
  }
  for (const name of parseAssignees(assignee ?? "")) {
    const personDept = check.deptByPerson.get(name);
    if (personDept === undefined) {
      warnings.push({ kind: "assigneeOrphan", value: name });
    } else if (!check.eligibleNames.has(name)) {
      warnings.push({ kind: "assigneeNoAccess", value: name });
    } else if (dept !== "" && personDept !== dept) {
      // 노드 부서가 비어 있으면 비교 대상이 없다 — 드리프트가 아니라 미지정
      warnings.push({ kind: "assigneeDrift", value: name, personDept });
    }
  }
  return warnings;
}

/** 담당자 쪽 경고만 있는지 — 속성 줄 아이콘 교체 판정용. */
export function hasAssigneeWarning(warnings: readonly NodeWarning[]): boolean {
  return warnings.some((w) => w.kind !== "deptOrphan");
}
