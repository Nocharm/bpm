"""퇴사자(AD 프룬) 정리 — 승인 정족수 제외·pending 재평가·점유 자동 해제 (2026-07-09)."""

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Employee, MapVersion, Notification
from app.settings import settings

OWNER = {"X-Dev-User": "owner.kim"}
LEE = {"X-Dev-User": "user.lee"}


def _seed_ad_employee(login_id: str, name: str = "") -> None:
    """active=True source='ad' 직원 행 시드 — 프룬 대상 승인자/점유자용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id)
                session.add(emp)
            emp.source = "ad"
            emp.active = True
            emp.name = name or login_id
            await session.commit()

    asyncio.run(_run())


def _mock_ldap(monkeypatch, raws: list) -> None:
    from app.ad import client as ldap_client
    from app.ad import service

    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(service, "_last_full_sync_at", None)
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)


def _keepalive_raw():
    """프룬 가드(valid_ids 비면 스킵) 통과용 더미 스캔 유저."""
    from app.ad.client import RawUser

    return RawUser("fresh.keep", "Keep Alive", "사원", "OU=TeamA,DC=corp", 0x200, None, [])


def _create_map_with_version(client: TestClient, name: str) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": name}, headers=OWNER).json()
    return created["id"], created["versions"][0]["id"]


def _version_row(version_id: int) -> MapVersion:
    async def _run() -> MapVersion:
        async with SessionLocal() as session:
            return await session.get(MapVersion, version_id)

    return asyncio.run(_run())


def _notifications(version_id: int, type_: str) -> list[Notification]:
    async def _run() -> list[Notification]:
        async with SessionLocal() as session:
            return list(
                (
                    await session.scalars(
                        select(Notification).where(
                            Notification.version_id == version_id,
                            Notification.type == type_,
                        )
                    )
                ).all()
            )

    return asyncio.run(_run())


def test_departed_approver_excluded_from_quorum(client: TestClient) -> None:
    """employees 행 없는(=프룬된) 승인자는 정족수에서 제외 — 산 승인자만으로 Approved 전이."""
    map_id, vid = _create_map_with_version(client, "T quorum excludes departed")
    # ghost.gone: 직원 행 자체가 없음 (이미 프룬된 퇴사자)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["user.lee", "ghost.gone"]}, headers=OWNER)
    client.post(f"/api/versions/{vid}/checkout", json={}, headers=LEE)
    assert client.post(f"/api/versions/{vid}/submit", headers=LEE).status_code == 200

    res = client.post(f"/api/versions/{vid}/approve", headers=LEE)
    assert res.status_code == 200
    assert res.json()["status"] == "approved"  # ghost 제외 → user.lee 단독 정족수

    # workflow 응답의 승인자 목록에서도 유령 제외
    wf = client.get(f"/api/versions/{vid}/workflow", headers=LEE).json()
    assert wf["approvers"] == ["user.lee"]


def test_sync_releases_checkout_of_purged_holder(client: TestClient, monkeypatch) -> None:
    """AD 프룬이 점유자 행을 지우면 해당 점유도 자동 해제."""
    _seed_ad_employee("holder.gone")
    map_id, vid = _create_map_with_version(client, "T holder auto release")
    client.post(f"/api/versions/{vid}/checkout", json={}, headers={"X-Dev-User": "holder.gone"})
    assert _version_row(vid).checked_out_by == "holder.gone"

    _mock_ldap(monkeypatch, [_keepalive_raw()])  # holder.gone은 스캔에 없음 → 프룬
    res = client.post("/api/employees/sync", headers=OWNER)
    assert res.status_code == 200
    assert res.json()["purged"] >= 1

    v = _version_row(vid)
    assert v.checked_out_by is None
    assert v.checked_out_at is None


def test_sync_cancels_pending_when_sole_approver_purged(client: TestClient, monkeypatch) -> None:
    """유일 승인자 퇴사 → pending 취소(draft 복귀·제출자 점유 재부여) + 오너·제출자 알림."""
    _seed_ad_employee("sole.gone")
    map_id, vid = _create_map_with_version(client, "T sole approver cancel")
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["sole.gone"]}, headers=OWNER)
    client.post(f"/api/versions/{vid}/checkout", json={}, headers=LEE)
    assert client.post(f"/api/versions/{vid}/submit", headers=LEE).status_code == 200

    _mock_ldap(monkeypatch, [_keepalive_raw()])
    assert client.post("/api/employees/sync", headers=OWNER).status_code == 200

    v = _version_row(vid)
    assert v.status == "draft"  # 승인 플로우 취소
    assert v.checked_out_by == "user.lee"  # 제출자(생존)에게 점유 재부여

    notes = _notifications(vid, "approval_cancelled")
    assert {n.recipient for n in notes} == {"owner.kim", "user.lee"}


def test_sync_completes_pending_when_departed_was_last_blocker(
    client: TestClient, monkeypatch
) -> None:
    """산 승인자 전원 승인 상태에서 마지막 미승인자(퇴사)가 프룬되면 자동 Approved + 제출자 알림."""
    _seed_ad_employee("blocker.gone")
    map_id, vid = _create_map_with_version(client, "T blocker purge completes")
    client.put(
        f"/api/maps/{map_id}/approvers",
        json={"user_ids": ["user.lee", "blocker.gone"]},
        headers=OWNER,
    )
    client.post(f"/api/versions/{vid}/checkout", json={}, headers=LEE)
    assert client.post(f"/api/versions/{vid}/submit", headers=LEE).status_code == 200
    res = client.post(f"/api/versions/{vid}/approve", headers=LEE)
    assert res.json()["status"] == "pending"  # blocker.gone 행이 살아있는 동안은 1/2

    _mock_ldap(monkeypatch, [_keepalive_raw()])
    assert client.post("/api/employees/sync", headers=OWNER).status_code == 200

    v = _version_row(vid)
    assert v.status == "approved"
    approved_notes = _notifications(vid, "approved")
    assert any(n.recipient == "user.lee" for n in approved_notes)
