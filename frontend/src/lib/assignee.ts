// 담당자/부서 통일 로직 — 순수 함수(부작용 없음). 인스펙터·노드모달·그룹벌크 3곳 공용.
// 담당자는 콤마+공백 구분 복수 이름, 모두 같은 부서. 부서는 단일.

type Person = { name: string; department: string };

export function parseAssignees(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAssignees(names: string[]): string {
  return names.join(", ");
}

export function deptOf(name: string, users: Person[]): string | null {
  return users.find((u) => u.name === name)?.department ?? null;
}

// 부서 비면 그 인원 부서로 설정; 부서 있으면 같은 부서 인원만 추가(다르면 무시). 중복 제거.
export function addAssignee(
  department: string,
  assignees: string[],
  name: string,
  users: Person[],
): { department: string; assignees: string[] } {
  const personDept = deptOf(name, users);
  if (assignees.includes(name)) {
    return { department, assignees };
  }
  if (department === "") {
    return { department: personDept ?? "", assignees: [name] };
  }
  if (personDept !== null && personDept !== department) {
    return { department, assignees }; // 교차부서 — 무시(입력에서 차단하지만 안전망)
  }
  return { department, assignees: [...assignees, name] };
}

// 현재 부서가 노드 부서와 다르거나 디렉터리에서 사라진 담당자 = 경고 대상(드리프트).
export function driftedAssignees(
  department: string,
  assignees: string[],
  users: Person[],
): string[] {
  return assignees.filter((name) => {
    const d = deptOf(name, users);
    return d === null || d !== department;
  });
}
