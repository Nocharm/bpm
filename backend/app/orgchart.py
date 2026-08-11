"""직원 → 조직 경로 해석 단일화 — departments 부모 체인 1순위, org_l1~l5 폴백.

설계: docs/design/2026-08-11-departments-org-basis-design.md §2.
departments가 빈 환경(로컬 sqlite·테스트)은 전원 폴백 → 현행 동작과 동일(불변식).
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.org import org_path
from app.models import Department, Employee
from app.settings import settings

# 체인 상향 최대 깊이 — HR 계약상 6레벨, 여유분 포함. 초과는 사이클 취급 → 폴백.
_MAX_DEPTH = 15

# 부서명 내 "/" 치환 문자 — 경로 구분자와 충돌 방지(U+FF0F 전각 슬래시). AX/PI Department 등 실부서명 존재.
_SEGMENT_SLASH = "／"


def sanitize_org_segment(name: str) -> str:
    """경로 세그먼트용 부서명 — 이름 속 "/"를 전각 슬래시로 치환해 split/프리픽스 파손 방지."""
    return name.replace("/", _SEGMENT_SLASH)

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
        # 한글명 키는 새니타이즈 — 리프 세그먼트(새니타이즈된 경로에서 옴) 조회와 일치해야 한다
        name = sanitize_org_segment(d.name or "")
        if name and d.name_ko and name not in name_ko:
            name_ko[name] = d.name_ko
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
                names_leaf_to_root.append(sanitize_org_segment(name))
            cur = parent
        # cur is None = 루트까지 닿음. cur가 남아 있으면 부모 코드가 미러에 없는 단절 체인 —
        # 부분 경로는 트림 후 루트로 떠서 인원 있는 고아 노드가 되므로 통째로 폴백 (2026-08 9910 적발)
        if names_leaf_to_root and cur is None:
            names = list(reversed(names_leaf_to_root))
            # 최상위 N레벨 제외 — 법인·사업부급 범용 레벨은 분류에서 뺀다. 체인이 그보다 짧으면 리프만.
            trim = settings.org_trim_levels
            if trim > 0:
                names = names[trim:] if len(names) > trim else names[-1:]
            return "/".join(names)
    # 폴백도 세그먼트 새니타이즈 — org 컬럼 원본에 "/"가 있으면 동일하게 파손되므로
    def _s(v: str | None) -> str | None:
        return sanitize_org_segment(v) if v else v

    return org_path(
        _s(emp.org_l1), _s(emp.org_l2), _s(emp.org_l3), _s(emp.org_l4), _s(emp.org_l5),
        _s(emp.department) or "",
    )


def resolve_org_prefixes(path: str) -> list[str]:
    """"A/B/C" → ["A", "A/B", "A/B/C"]. 빈 문자열은 []."""
    if not path:
        return []
    segments = path.split("/")
    return ["/".join(segments[: i + 1]) for i in range(len(segments))]


async def load_valid_org_prefixes(session: AsyncSession, *, active_only: bool = False) -> set[str]:
    """현 조직 유효 경로 프리픽스 합집합 — 직원 resolved 경로 기준.

    피커(directory)·오우닝 부서 검증(maps)·dept-remap(admin)이 같은 집합을 봐야
    "피커에서 고른 값이 검증에서 거부"되는 불일치가 안 생긴다 (2026-08 9910 검증에서 적발).
    active_only=True면 퇴직자만 남은 부서를 제외 — 선택지·remap 대상용. 오우닝 *검증*은
    기본(전 직원) 유지 — 비활성 직원이 받치는 기존 부서(conftest 앵커 등)를 깨지 않게 관대하게.
    """
    index = await load_dept_index(session)
    stmt = select(Employee)
    if active_only:
        stmt = stmt.where(Employee.active.is_(True))
    employees = (await session.scalars(stmt)).all()
    prefixes: set[str] = set()
    for emp in employees:
        prefixes.update(resolve_org_prefixes(resolve_org_path(emp, index)))
    return prefixes
