"""직원 → 조직 경로 해석 단일화 — departments 부모 체인 1순위, org_l1~l5 폴백.

설계: docs/design/2026-08-11-departments-org-basis-design.md §2.
departments가 빈 환경(로컬 sqlite·테스트)은 전원 폴백 → 현행 동작과 동일(불변식).
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.org import org_path
from app.models import Department, Employee

# 체인 상향 최대 깊이 — HR 계약상 6레벨, 여유분 포함. 초과는 사이클 취급 → 폴백.
_MAX_DEPTH = 15

# by_code 값: (name, parent_dept_code)
DeptEntry = tuple[str, str | None]


@dataclass(frozen=True)
class DeptIndex:
    by_code: dict[str, DeptEntry] = field(default_factory=dict)
    # 영문명 → 한글명. 동명 충돌은 dept_code 오름차순 첫 행 우선(결정적).
    name_ko_by_name: dict[str, str] = field(default_factory=dict)


async def load_dept_index(session: AsyncSession) -> DeptIndex:
    """departments 전체 1회 로드 — 요청당 한 번 부르고 재사용한다."""
    rows = (await session.scalars(select(Department).order_by(Department.dept_code))).all()
    by_code: dict[str, DeptEntry] = {}
    name_ko: dict[str, str] = {}
    for d in rows:
        by_code[d.dept_code] = (d.name or "", d.parent_dept_code)
        if d.name and d.name_ko and d.name not in name_ko:
            name_ko[d.name] = d.name_ko
    return DeptIndex(by_code=by_code, name_ko_by_name=name_ko)


def resolve_org_path(emp: Employee, index: DeptIndex) -> str:
    """dept_code → 부모 체인 경로(루트→리프). 코드 부재·스테일·사이클·전체 빈 이름이면 org 컬럼 폴백."""
    code = emp.dept_code
    if code and code in index.by_code:
        names_leaf_to_root: list[str] = []
        visited: set[str] = set()
        cur: str | None = code
        while cur is not None and cur in index.by_code:
            if cur in visited or len(visited) >= _MAX_DEPTH:
                names_leaf_to_root = []  # 사이클/과깊이 → 폴백
                break
            visited.add(cur)
            name, parent = index.by_code[cur]
            if name:
                names_leaf_to_root.append(name)
            cur = parent
        if names_leaf_to_root:
            return "/".join(reversed(names_leaf_to_root))
    return org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)


def resolve_org_prefixes(path: str) -> list[str]:
    """"A/B/C" → ["A", "A/B", "A/B/C"]. 빈 문자열은 []."""
    if not path:
        return []
    segments = path.split("/")
    return ["/".join(segments[: i + 1]) for i in range(len(segments))]
