"""orgchart 경로 해석 단위 테스트 — 체인·폴백·가드."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

import pytest

from app.db import SessionLocal
from app.models import Department, Employee
from app.orgchart import DeptIndex, load_dept_index, resolve_org_path, resolve_org_prefixes

T = TypeVar("T")


def _seed(coro_factory: Callable[[Any], Coroutine[Any, Any, T]]) -> T:
    """비동기 SessionLocal 작업을 동기 테스트에서 실행 — test_sp_params._seed 미러.

    conftest에 raw AsyncSession 픽스처가 없어(anyio 미설정) 기존 코드베이스 컨벤션을 그대로 씀.
    """

    async def _run() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


@pytest.fixture
def session() -> Callable[[Callable[[Any], Coroutine[Any, Any, T]]], T]:
    """DB 직접 조작용 — load_dept_index를 실제 세션으로 검증."""
    return _seed


def _dept(code: str, name: str, parent: str | None = None, name_ko: str = "") -> Department:
    return Department(dept_code=code, name=name, name_ko=name_ko, parent_dept_code=parent, level=0)


def _emp(login_id: str = "u.one", dept_code: str | None = None, **org: str) -> Employee:
    return Employee(
        login_id=login_id, name="U One", dept_code=dept_code,
        org_l1=org.get("org_l1"), org_l2=org.get("org_l2"), org_l3=org.get("org_l3"),
        org_l4=org.get("org_l4"), org_l5=org.get("org_l5"),
        department=org.get("department", ""),
    )


def _index(*depts: Department) -> DeptIndex:
    """세션 없이 인덱스 직조립 — load_dept_index와 같은 형태."""
    return DeptIndex(
        by_code={d.dept_code: (d.name, d.parent_dept_code) for d in depts},
        name_ko_by_name={d.name: d.name_ko for d in sorted(depts, key=lambda x: x.dept_code) if d.name and d.name_ko},
    )


def _generic_tops() -> tuple[Department, Department]:
    """HR 조직 최상위 2레벨(법인·사업부급) — settings.org_trim_levels가 해석 시 제외."""
    return _dept("D0a", "Corp Holding"), _dept("D0b", "Bio Business", "D0a")


def test_chain_resolves_root_to_leaf_with_top_levels_trimmed() -> None:
    idx = _index(
        *_generic_tops(),
        _dept("D1", "Alpha Division", "D0b"),
        _dept("D2", "Beta Office", "D1"),
        _dept("D3", "Gamma Team", "D2"),
    )
    emp = _emp(dept_code="D3", org_l1="Stale Root", department="Stale Leaf")
    assert resolve_org_path(emp, idx) == "Alpha Division/Beta Office/Gamma Team"


def test_trim_keeps_leaf_when_chain_short() -> None:
    """체인이 트림 레벨 이하로 짧으면 리프만 남긴다 — 범용 레벨 직속 직원 엣지."""
    idx = _index(*_generic_tops())
    emp = _emp(dept_code="D0b")
    assert resolve_org_path(emp, idx) == "Bio Business"


def test_trim_applies_only_to_chain_not_fallback() -> None:
    """트림은 체인 해석 전용 — org 컬럼 폴백은 원본 그대로."""
    idx = _index()
    emp = _emp(dept_code=None, org_l1="Corp Holding", org_l2="Bio Business", org_l3="Alpha", department="Alpha")
    assert resolve_org_path(emp, idx) == "Corp Holding/Bio Business/Alpha"


def test_fallback_when_dept_code_missing_or_stale() -> None:
    idx = _index(_dept("D1", "Alpha Division"))
    legacy = _emp(dept_code=None, org_l1="A", org_l2="B", department="B")
    stale = _emp(dept_code="ZZZ", org_l1="A", org_l2="B", department="B")
    assert resolve_org_path(legacy, idx) == "A/B"
    assert resolve_org_path(stale, idx) == "A/B"


def test_fallback_when_departments_empty() -> None:
    idx = _index()
    emp = _emp(dept_code="D3", org_l1="A", org_l2="B", department="B")
    assert resolve_org_path(emp, idx) == "A/B"


def test_cycle_guard_falls_back() -> None:
    idx = _index(_dept("D1", "Alpha", "D2"), _dept("D2", "Beta", "D1"))
    emp = _emp(dept_code="D1", org_l1="A", department="A")
    assert resolve_org_path(emp, idx) == "A"


def test_empty_name_segment_skipped() -> None:
    idx = _index(
        *_generic_tops(),
        _dept("D1", "Alpha", "D0b"),
        _dept("D2", "", "D1"),
        _dept("D3", "Gamma", "D2"),
    )
    emp = _emp(dept_code="D3")
    assert resolve_org_path(emp, idx) == "Alpha/Gamma"


def test_all_names_empty_falls_back() -> None:
    idx = _index(_dept("D1", ""), _dept("D2", "", "D1"))
    emp = _emp(dept_code="D2", org_l1="A", department="A")
    assert resolve_org_path(emp, idx) == "A"


def test_prefixes() -> None:
    assert resolve_org_prefixes("A/B/C") == ["A", "A/B", "A/B/C"]
    assert resolve_org_prefixes("") == []


def test_load_dept_index_name_collision_first_code_wins(
    session: Callable[[Callable[[Any], Coroutine[Any, Any, Any]]], Any],
) -> None:
    # ORGT- 접두 — 다른 테스트 파일의 dept_code(D9 등)와 공유 sqlite DB에서 충돌 방지.
    async def _seed_depts(db_session: Any) -> None:
        db_session.add_all([
            Department(dept_code="ORGT-B2", name="Same Name Orgchart Test", name_ko="나중", parent_dept_code=None, level=0),
            Department(dept_code="ORGT-A1", name="Same Name Orgchart Test", name_ko="먼저", parent_dept_code=None, level=0),
        ])

    session(_seed_depts)
    idx = session(load_dept_index)
    assert idx.name_ko_by_name["Same Name Orgchart Test"] == "먼저"
