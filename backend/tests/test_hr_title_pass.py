"""AD title+position 패스 테스트 — title/position 갱신, 이름·조직·active 미터치.

HR sync가 title을 안 덮는 회귀 + EDW position 매핑(employeeNumber=empId)·소거 가드 포함.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.ad.client import RawUser
from app.db import SessionLocal
from app.hr.client import RawHrPosition
from app.models import Employee
from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee


@pytest.fixture(autouse=True)
def _reset_positions() -> None:
    """session-scope 공유 DB 오염 방지 — 이 모듈의 매 테스트 전 기존 position을 전부 비운다.

    erasure/unmatched 카운트 단언이 다른 테스트가 남긴 position 보유자에 흔들리지 않도록.
    """
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(update(Employee).values(position=None))
            await session.commit()

    asyncio.run(_run())


def _mock_ldap_titles(monkeypatch, raws: list) -> None:
    from app.ad import client as ldap_client

    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)


def _position_row(emp_id: str, position: str, **overrides) -> RawHrPosition:
    base = dict(emp_id=emp_id, dept_code=None, name=None, position=position)
    base.update(overrides)
    return RawHrPosition(**base)


def _run_refresh(positions: list[RawHrPosition]) -> tuple[int, int, int]:
    """카운트 3튜플만 반환 — 진단 샘플은 _run_refresh_full로."""
    return _run_refresh_full(positions)[:3]


def _run_refresh_full(positions: list[RawHrPosition]) -> tuple[int, int, int, list[str]]:
    from app.ad.service import refresh_titles_and_positions

    async def _run() -> tuple[int, int, int, list[str]]:
        async with SessionLocal() as session:
            return await refresh_titles_and_positions(session, positions)

    return asyncio.run(_run())


def test_refresh_titles_and_positions_title_only(client: TestClient, monkeypatch) -> None:
    """회귀: 기존 title 갱신 단언 유지 — 개명(refresh_titles_and_positions)·튜플 반환만 반영."""
    _seed_employee("title.user", source="hr", name="HR Name", title="Old", org_l1="HR Div")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("title.user", "AD Display", "Principal", "OU=Elsewhere,DC=corp", 0x200, None, []),
         RawUser("no.row", "Ghost", "Lead", "OU=X,DC=corp", 0x200, None, [])],
    )
    assert _run_refresh([]) == (1, 0, 0)
    emp = _get_employee("title.user")
    assert emp.title == "Principal"
    assert emp.name == "HR Name" and emp.org_l1 == "HR Div"  # title 외 미터치


def test_position_matches_by_employee_number(client: TestClient, monkeypatch) -> None:
    _seed_employee("pos.user", source="hr", name="Pos User")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("pos.user", "AD Display", "", "OU=X,DC=corp", 0x200, None, [], employee_number="100")],
    )
    assert _run_refresh([_position_row("100", "Team Lead")]) == (0, 1, 0)
    assert _get_employee("pos.user").position == "Team Lead"


def test_position_duplicate_employee_number_unmatched(client: TestClient, monkeypatch) -> None:
    """같은 employeeNumber를 가진 AD 유저가 둘이면 오매칭 방지를 위해 그 사번은 매핑 불가."""
    _seed_employee("dup.a", source="hr", name="A")
    _seed_employee("dup.b", source="hr", name="B")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("dup.a", "A", "", "OU=X,DC=corp", 0x200, None, [], employee_number="200"),
         RawUser("dup.b", "B", "", "OU=X,DC=corp", 0x200, None, [], employee_number="200")],
    )
    assert _run_refresh([_position_row("200", "Team Lead")]) == (0, 0, 1)
    assert _get_employee("dup.a").position is None
    assert _get_employee("dup.b").position is None


def test_position_unresolved_row_leaves_matched_employee_alone(client: TestClient, monkeypatch) -> None:
    """어떤 employeeNumber와도 불일치하는 row는 unmatched로만 세고, 이미 매칭된 다른 직원 값은 안 건드림."""
    _seed_employee("keep.user", source="hr", name="Keep", position="Team Lead")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("keep.user", "K", "", "OU=X,DC=corp", 0x200, None, [], employee_number="300")],
    )
    positions = [_position_row("300", "Team Lead"), _position_row("999", "Ghost Title")]
    assert _run_refresh(positions) == (0, 0, 1)  # 300은 값 변화 없음(재확인만), 999는 unmatched
    assert _get_employee("keep.user").position == "Team Lead"


def test_position_erased_when_holder_missing_from_feed(client: TestClient, monkeypatch) -> None:
    """이번 목록에 없는 기존 보유자는 NULL 소거(승진·이동 반영)."""
    _seed_employee("active.user", source="hr", name="Active")
    _seed_employee("stale.user", source="hr", name="Stale", position="Old Lead")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("active.user", "A", "", "OU=X,DC=corp", 0x200, None, [], employee_number="410"),
         RawUser("stale.user", "S", "", "OU=X,DC=corp", 0x200, None, [], employee_number="420")],
    )
    result = _run_refresh([_position_row("410", "New Lead")])
    assert result == (0, 2, 0)  # active.user 갱신 1 + stale.user 소거 1
    assert _get_employee("active.user").position == "New Lead"
    assert _get_employee("stale.user").position is None


def test_position_empty_feed_skips_erasure(client: TestClient, monkeypatch) -> None:
    """positions가 빈 리스트면 소거 스킵 — 빈 피드 전멸 방어."""
    _seed_employee("stale.user", source="hr", name="Stale", position="Old Lead")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("stale.user", "S", "", "OU=X,DC=corp", 0x200, None, [], employee_number="420")],
    )
    assert _run_refresh([]) == (0, 0, 0)
    assert _get_employee("stale.user").position == "Old Lead"


def test_position_all_unmatched_still_erases_existing_holders(client: TestClient, monkeypatch) -> None:
    """극단 케이스 고정 — AD 사번 맵이 살아있는데(employeeNumber 일부 존재) 매칭이 0건이어도
    소거는 실행된다(설계 §4-2, 브리프 채택). AD가 employeeNumber를 아예 안 주는 경우는
    test_position_empno_feed_empty_skips_erasure로 별도 방어.
    """
    _seed_employee("stale.user", source="hr", name="Stale", position="Old Lead")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("stale.user", "S", "", "OU=X,DC=corp", 0x200, None, [], employee_number="420")],
    )
    result = _run_refresh([_position_row("999", "Ghost Lead")])  # "999"는 "420"과 불일치
    assert result == (0, 1, 1)  # 소거 1(pos_refreshed) + unmatched 1
    assert _get_employee("stale.user").position is None


def test_position_empno_feed_empty_skips_erasure(client: TestClient, monkeypatch) -> None:
    """EDW는 정상(positions 1행+)인데 AD가 employeeNumber를 전혀 안 주면(empno_to_sam 전멸)
    매칭 전멸을 전원 소거로 오인하지 않고 스킵한다 — 기존 보유자 유지 + unmatched=전체.
    """
    _seed_employee("stale.user", source="hr", name="Stale", position="Old Lead")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("stale.user", "S", "", "OU=X,DC=corp", 0x200, None, [])],  # employee_number 없음
    )
    result = _run_refresh([_position_row("420", "New Lead"), _position_row("421", "Other Lead")])
    assert result == (0, 0, 2)  # 소거 없음 + unmatched 전체
    assert _get_employee("stale.user").position == "Old Lead"


def test_full_sync_runs_title_and_position_pass(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("combo.user")])
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("combo.user", "X", "Senior", "OU=Y,DC=corp", 0x200, None, [], employee_number="900")],
    )
    monkeypatch.setattr(settings, "n8n_position_url", "http://hr.local/webhook/position")

    from app.hr import client as hr_client

    async def fake_positions() -> list[RawHrPosition]:
        return [_position_row("900", "Team Lead")]

    monkeypatch.setattr(hr_client, "fetch_positions", fake_positions)
    summary = _run_sync()
    assert summary.title_refreshed == 1
    assert summary.position_refreshed == 1
    assert summary.position_unmatched == 0
    emp = _get_employee("combo.user")
    assert emp.title == "Senior"
    assert emp.position == "Team Lead"


def test_full_sync_survives_edw_fetch_failure_title_only(client: TestClient, monkeypatch) -> None:
    """EDW fetch 실패 시 title만 갱신되고 기존 position 보유자는 소거되지 않는다(positions=[] → 소거 스킵, 설계 §4-2).

    stale.user는 source=local로 시드 — HR 피드에 없어도 sync_all의 managed(ad/hr) 행 삭제 대상이 아니라서
    position 소거 스킵을 순수하게 검증할 수 있다(managed 삭제와 뒤섞이지 않음).
    """
    _seed_employee("stale.user", source="local", name="Stale", position="Old Lead")
    _mock_hr(monkeypatch, [_hr_row("combo2.user")])
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("combo2.user", "X", "Senior", "OU=Y,DC=corp", 0x200, None, [], employee_number="901")],
    )
    monkeypatch.setattr(settings, "n8n_position_url", "http://hr.local/webhook/position")

    from app.hr import client as hr_client

    async def failing_positions() -> list[RawHrPosition]:
        raise RuntimeError("EDW webhook down")

    monkeypatch.setattr(hr_client, "fetch_positions", failing_positions)
    summary = _run_sync()
    assert summary.title_refreshed == 1
    assert summary.position_refreshed == 0
    assert summary.position_unmatched == 0
    assert _get_employee("combo2.user").title == "Senior"
    assert _get_employee("stale.user").position == "Old Lead"  # 소거 안 됨


def test_full_sync_skips_position_fetch_when_disabled(client: TestClient, monkeypatch) -> None:
    """position_enabled=False(N8N_POSITION_URL 미설정)면 fetch_positions 자체가 호출되지 않는다."""
    _mock_hr(monkeypatch, [_hr_row("combo3.user")])
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("combo3.user", "X", "Senior", "OU=Y,DC=corp", 0x200, None, [], employee_number="902")],
    )
    monkeypatch.setattr(settings, "n8n_position_url", "")  # 명시적으로 비활성

    from app.hr import client as hr_client

    calls: list[None] = []

    async def spy_positions() -> list[RawHrPosition]:
        calls.append(None)
        return []

    monkeypatch.setattr(hr_client, "fetch_positions", spy_positions)
    summary = _run_sync()
    assert calls == []  # 호출 안 됨
    assert summary.title_refreshed == 1
    assert summary.position_refreshed == 0
    assert summary.position_unmatched == 0


def test_position_unmatched_sample_reports_emp_ids(client: TestClient, monkeypatch) -> None:
    """미매칭 EMPID 샘플(≤10) — 사번 포맷 불일치를 요약만 보고 진단할 수 있어야 한다."""
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("sample.user", "S", "", "OU=X,DC=corp", 0x200, None, [], employee_number="700")],
    )
    _seed_employee("sample.user", source="hr", name="Sample")
    result = _run_refresh_full([_position_row("000700", "팀장"), _position_row("700", "팀장")])
    # "000700"은 미매칭(zero-padding 재현) — 샘플에 원문 그대로 담긴다
    assert result[2] == 1
    assert result[3] == ["000700"]
